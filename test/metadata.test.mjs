import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrder, parseSnapshotVersions, planSet } from '../src/metadata.mjs';

const ORDER = JSON.stringify({
  groupId: 'local.devices', artifactId: 'protocol', version: '1.2-SNAPSHOT',
  metadata: '/repository/local/devices/protocol/1.2-SNAPSHOT/maven-metadata.xml',
  required: [{ extension: 'zip', classifier: '' }, { extension: 'xml', classifier: 'schema' }],
  optional: [{ extension: 'txt', classifier: 'notes' }],
});

const xmlWith = entries => `<metadata><versioning><snapshotVersions>${entries}</snapshotVersions></versioning></metadata>`;
const entry = (extension, value, classifier) =>
  `<snapshotVersion>${classifier ? `<classifier>${classifier}</classifier>` : ''}<extension>${extension}</extension><value>${value}</value></snapshotVersion>`;

test('领取单校验坐标与附件声明', () => {
  const order = parseOrder(ORDER);
  assert.deepEqual(order.required, [{ classifier: '', extension: 'zip' }, { classifier: 'schema', extension: 'xml' }]);
  assert.deepEqual(order.optional, [{ classifier: 'notes', extension: 'txt' }]);
  assert.throws(() => parseOrder(JSON.stringify({ groupId: 'g' })), /缺少/);
  assert.throws(() => parseOrder('{'), /JSON/);
  assert.throws(() => parseOrder(JSON.stringify({ groupId: 'g', artifactId: 'a', version: '1', metadata: 'relative', required: [] })), /地址无效/);
});

test('快照元数据按分类解析具体版本', () => {
  const versions = parseSnapshotVersions(xmlWith(entry('zip', '1.2-20261114.090000-1') + entry('xml', '1.2-20261114.090000-1', 'schema')));
  assert.equal(versions.length, 2);
  assert.equal(versions[0].classifier, '');
  assert.equal(versions[1].classifier, 'schema');
  assert.throws(() => parseSnapshotVersions('<metadata/>'), /没有具体版本/);
});

test('同一次构建展开为成套领取计划', () => {
  const plan = planSet(parseOrder(ORDER), xmlWith(entry('zip', '1.2-20261114.090000-1') + entry('xml', '1.2-20261114.090000-1', 'schema')));
  assert.equal(plan.cohort.consistent, true);
  assert.equal(plan.build, '20261114.090000-1');
  assert.deepEqual(plan.files.map(file => file.name), ['protocol-1.2-20261114.090000-1.zip', 'protocol-1.2-20261114.090000-1-schema.xml']);
  assert.equal(plan.files[0].path, '/repository/local/devices/protocol/1.2-SNAPSHOT/protocol-1.2-20261114.090000-1.zip');
  assert.deepEqual(plan.undescribed.map(combo => combo.key), ['notes:txt']);
});

test('元数据描述不同构建时判定为不齐', () => {
  const plan = planSet(parseOrder(ORDER), xmlWith(entry('zip', '1.2-20261114.093000-2') + entry('xml', '1.2-20261114.090000-1', 'schema')));
  assert.equal(plan.cohort.consistent, false);
  assert.equal(plan.build, null);
  assert.equal(plan.cohort.builds[':zip'], '20261114.093000-2');
  assert.equal(plan.cohort.builds['schema:xml'], '20261114.090000-1');
});

test('必需附件未被元数据描述时列入待补而非静默忽略', () => {
  const plan = planSet(parseOrder(ORDER), xmlWith(entry('zip', '1.2-20261114.090000-1')));
  assert.equal(plan.cohort.consistent, true);
  assert.deepEqual(plan.cohort.undescribed, ['schema:xml', 'notes:txt']);
  assert.ok(plan.undescribed.some(combo => combo.required && combo.classifier === 'schema'));
});
