import { capture, fetchRaw } from './client.mjs';
import { Archive, sha256 } from './archive.mjs';
import { parseOrder, planSet } from './metadata.mjs';
import { SetStore } from './sets.mjs';

export async function receiveCurrent(base, directory) {
  const archive = new Archive(directory);
  const store = new SetStore(directory);
  const orderSource = await capture(`${base}/repository/metadata`, directory);
  const order = parseOrder(orderSource.bytes.toString('utf8'));
  const key = `${order.groupId}:${order.artifactId}:${order.version}`;
  const metadataSource = await capture(base + order.metadata, directory);
  const plan = planSet(order, metadataSource.bytes.toString('utf8'));
  const set = (await store.load(key)) ?? {
    key,
    coordinates: { groupId: order.groupId, artifactId: order.artifactId, version: order.version },
    build: null,
    files: {},
    previous: [],
  };
  set.sources = { order: orderSource.receipt.id, metadata: metadataSource.receipt.id, metadataEtag: metadataSource.receipt.source.etag ?? null };
  set.cohort = plan.cohort;
  if (plan.cohort.consistent) {
    if (set.build && set.build !== plan.build) {
      // 厂商发布了新构建：整组切换，旧构建进度留作历史，绝不两次构建凑一套。
      set.previous = [...(set.previous ?? []), { build: set.build, files: set.files, superseded: new Date().toISOString() }];
      set.files = {};
    }
    set.build = plan.build;
    const known = new Set((await archive.list()).map(receipt => receipt.id));
    for (const file of plan.files) {
      const held = set.files[file.key];
      if (held?.status === 'received' && held.build === file.build && known.has(held.receipt)) continue;
      if (file.build !== plan.build) {
        set.files[file.key] = { name: file.name, required: file.required, status: 'retryable', reason: '元数据把该附件描述为另一构建，未混装' };
      } else {
        set.files[file.key] = { name: file.name, required: file.required, ...(await fetchFile(base, file, archive)), build: file.build };
      }
      await store.save(set);
    }
    for (const combo of plan.undescribed) {
      if (set.files[combo.key]?.status === 'received') continue;
      set.files[combo.key] = { name: null, required: combo.required, status: combo.required ? 'retryable' : 'absent', reason: '快照元数据未描述该附件' };
    }
  }
  await store.save(set);
  return report(set, plan);
}

async function fetchFile(base, file, archive) {
  const url = base + file.path;
  let response;
  try { response = await fetchRaw(url); }
  catch (error) { return { status: 'retryable', reason: `领取异常：${error.message}` }; }
  if (response.status === 404) return { status: 'absent', httpStatus: 404 };
  if (response.status !== 200) return { status: 'retryable', httpStatus: response.status };
  let checksum = null;
  try { checksum = await fetchRaw(`${url}.sha256`); }
  catch (error) { return { status: 'retryable', reason: `校验值领取异常：${error.message}` }; }
  if (checksum.status === 200) {
    const expected = checksum.bytes.toString('utf8').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected) || sha256(response.bytes) !== expected) return { status: 'retryable', reason: '校验不符' };
  } else if (file.required || checksum.status !== 404) {
    // 必需文件必须有校验值；可选文件没有校验值时按未校验收存，其余情况可重试。
    return { status: 'retryable', httpStatus: checksum.status, reason: '校验值暂未可领' };
  }
  const receipt = await archive.save(response.bytes, { url, status: response.status, type: response.type, etag: response.etag });
  return { status: 'received', receipt: receipt.id, digest: receipt.digest, size: receipt.size, verified: checksum?.status === 200 };
}

function report(set, plan) {
  const files = [
    ...plan.files.map(file => fileEntry(file, set.files[file.key])),
    ...plan.undescribed.map(combo => fileEntry({ ...combo, name: null, value: null, build: null }, set.files[combo.key])),
  ];
  const complete = plan.cohort.consistent
    && plan.undescribed.every(combo => !combo.required)
    && plan.files.filter(file => file.required).every(file => {
      const held = set.files[file.key];
      return held?.status === 'received' && held.build === plan.build;
    });
  const values = [...new Set(plan.files.filter(file => file.required).map(file => file.value))];
  return {
    coordinates: [set.coordinates.groupId, set.coordinates.artifactId, set.coordinates.version],
    set: set.key,
    build: set.build,
    release: complete ? (values.length === 1 ? values[0] : { build: plan.build, values }) : null,
    complete,
    retryable: !plan.cohort.consistent || files.some(file => file.retryable),
    cohort: plan.cohort,
    files,
    sources: set.sources,
    metadata: set.sources.metadata,
  };
}

function fileEntry(file, held) {
  const entry = {
    name: file.name, classifier: file.classifier, extension: file.extension, required: file.required,
    value: file.value, build: file.build, status: 'pending',
  };
  if (held) {
    const { build: receivedBuild, name, required, ...rest } = held;
    Object.assign(entry, rest);
    if (receivedBuild !== undefined) entry.receivedBuild = receivedBuild;
  }
  entry.retryable = entry.status === 'pending' || entry.status === 'retryable';
  return entry;
}
