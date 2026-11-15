// 解析厂商领取单与快照元数据，把一组坐标展开成同一次构建的成套领取计划。

export function parseOrder(text) {
  let order;
  try { order = JSON.parse(text); }
  catch { throw new Error('领取单不是有效 JSON'); }
  for (const field of ['groupId', 'artifactId', 'version', 'metadata']) {
    if (typeof order?.[field] !== 'string' || !order[field]) throw new Error(`领取单缺少 ${field}`);
  }
  if (!order.metadata.startsWith('/')) throw new Error('领取单元数据地址无效');
  if (!Array.isArray(order.required)) throw new Error('领取单缺少必需附件列表');
  const seen = new Set();
  const normalize = list => list.map(item => {
    if (typeof item?.extension !== 'string' || !item.extension) throw new Error('领取单附件缺少扩展名');
    if (item.classifier !== undefined && typeof item.classifier !== 'string') throw new Error('领取单附件分类无效');
    return { classifier: item.classifier ?? '', extension: item.extension };
  }).filter(item => {
    const key = `${item.classifier}:${item.extension}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const required = normalize(order.required);
  const optional = normalize(Array.isArray(order.optional) ? order.optional : []);
  return { groupId: order.groupId, artifactId: order.artifactId, version: order.version, metadata: order.metadata, required, optional };
}

export function parseSnapshotVersions(xml) {
  const versions = [];
  for (const match of String(xml).matchAll(/<snapshotVersion>([\s\S]*?)<\/snapshotVersion>/g)) {
    const block = match[1];
    const field = name => block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
    const extension = field('extension');
    const value = field('value');
    if (!extension || !value) throw new Error('快照元数据缺少扩展名或具体版本');
    versions.push({ classifier: field('classifier') ?? '', extension, value, updated: field('updated') ?? null });
  }
  if (!versions.length) throw new Error('快照元数据没有具体版本');
  return versions;
}

export function planSet(order, xml) {
  const versions = parseSnapshotVersions(xml);
  const directory = order.metadata.slice(0, order.metadata.lastIndexOf('/'));
  const combos = [
    ...order.required.map(combo => ({ ...combo, required: true })),
    ...order.optional.map(combo => ({ ...combo, required: false })),
  ];
  const files = [];
  const undescribed = [];
  for (const combo of combos) {
    const key = `${combo.classifier}:${combo.extension}`;
    const hit = versions.find(version => version.classifier === combo.classifier && version.extension === combo.extension);
    if (!hit) { undescribed.push({ key, ...combo }); continue; }
    // 时间戳快照的具体版本以基础版本（去掉 -SNAPSHOT）为前缀，如 1.2-20261114.090000-1。
    const baseVersion = order.version.endsWith('-SNAPSHOT') ? order.version.slice(0, -'-SNAPSHOT'.length) : order.version;
    const prefix = `${baseVersion}-`;
    const build = hit.value.startsWith(prefix) ? hit.value.slice(prefix.length) : hit.value;
    const name = `${order.artifactId}-${hit.value}${combo.classifier ? `-${combo.classifier}` : ''}.${combo.extension}`;
    files.push({ key, ...combo, value: hit.value, build, name, path: `${directory}/${name}` });
  }
  const requiredBuilds = files.filter(file => file.required).map(file => file.build);
  const consistent = requiredBuilds.length > 0 && requiredBuilds.every(build => build === requiredBuilds[0]);
  const cohort = {
    consistent,
    builds: Object.fromEntries(files.map(file => [file.key, file.build])),
    undescribed: undescribed.map(combo => combo.key),
  };
  return { build: consistent ? requiredBuilds[0] : null, cohort, files, undescribed };
}
