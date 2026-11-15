import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProvider } from '../provider/server.mjs';
import { receiveCurrent } from '../src/domain.mjs';
import { Archive } from '../src/archive.mjs';

async function controlled(provider, change) {
  const response = await fetch(provider.base + '/_control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) });
  assert.equal(response.status, 200);
}

async function setState(directory) {
  const names = (await readdir(join(directory, 'sets'))).filter(name => name.endsWith('.json'));
  assert.equal(names.length, 1);
  return JSON.parse(await readFile(join(directory, 'sets', names[0]), 'utf8'));
}

const byClassifier = (result, classifier) => result.files.find(file => file.classifier === classifier);
const countRequests = (provider, ending) => provider.audit.filter(request => request.path.endsWith(ending)).length;

test('成套领取同一次发布并说明所用发布', async () => {
  const provider = await createProvider();
  const directory = await mkdtemp(join(tmpdir(), 'set-complete-'));
  try {
    const result = await receiveCurrent(provider.base, directory);
    assert.equal(result.complete, true);
    assert.equal(result.retryable, false);
    assert.equal(result.build, '20261114.090000-1');
    assert.equal(result.release, '1.2-20261114.090000-1');
    const main = byClassifier(result, '');
    const schema = byClassifier(result, 'schema');
    const notes = byClassifier(result, 'notes');
    assert.equal(main.status, 'received');
    assert.equal(schema.status, 'received');
    assert.equal(notes.status, 'absent');
    assert.equal(notes.retryable, false);
    const received = result.files.filter(file => file.status === 'received');
    assert.ok(received.length >= 2);
    assert.ok(received.every(file => file.receivedBuild === result.build));
    const archive = new Archive(directory);
    const receipts = await archive.list();
    assert.ok(receipts.some(receipt => receipt.id === result.sources.order));
    assert.ok(receipts.some(receipt => receipt.id === result.sources.metadata));
    assert.ok((await archive.read({ digest: main.digest, size: main.size })).toString('utf8').includes(result.build));
    assert.ok((await archive.read({ digest: schema.digest, size: schema.size })).toString('utf8').includes(result.build));
    assert.ok(!provider.audit.some(request => request.path.includes('notes.txt.sha256')));
  } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});

test('暂缺可重试、可选缺失不抹进度，续领只补未完成文件', async () => {
  const provider = await createProvider();
  const directory = await mkdtemp(join(tmpdir(), 'set-resume-'));
  try {
    await controlled(provider, { mode: 'publishing' });
    const first = await receiveCurrent(provider.base, directory);
    assert.equal(first.complete, false);
    assert.equal(first.retryable, true);
    assert.equal(byClassifier(first, '').status, 'received');
    const schema = byClassifier(first, 'schema');
    assert.equal(schema.status, 'retryable');
    assert.equal(schema.httpStatus, 503);
    const notes = byClassifier(first, 'notes');
    assert.equal(notes.status, 'absent');
    assert.equal(notes.retryable, false);
    const progress = await setState(directory);
    assert.equal(progress.files[':zip'].status, 'received');
    assert.equal(progress.files['schema:xml'].status, 'retryable');
    assert.equal(progress.files['notes:txt'].status, 'absent');
    await controlled(provider, { mode: 'normal' });
    const second = await receiveCurrent(provider.base, directory);
    assert.equal(second.complete, true);
    assert.equal(second.release, '1.2-20261114.090000-1');
    assert.equal(countRequests(provider, '-1.zip'), 1);
    assert.equal(countRequests(provider, '-schema.xml'), 2);
  } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});

test('可选附件已描述但地址不存在记为确实不存在，不影响必需进度', async () => {
  const provider = await createProvider();
  const directory = await mkdtemp(join(tmpdir(), 'set-ghost-'));
  try {
    await controlled(provider, { ghost: true });
    const result = await receiveCurrent(provider.base, directory);
    assert.equal(result.complete, true);
    assert.equal(result.retryable, false);
    const notes = byClassifier(result, 'notes');
    assert.equal(notes.status, 'absent');
    assert.equal(notes.httpStatus, 404);
    assert.equal(notes.retryable, false);
    assert.equal(byClassifier(result, '').status, 'received');
    assert.equal(byClassifier(result, 'schema').status, 'received');
    assert.equal(countRequests(provider, '-notes.txt'), 1);
    assert.ok(!provider.audit.some(request => request.path.includes('notes.txt.sha256')));
    const again = await receiveCurrent(provider.base, directory);
    assert.equal(again.complete, true);
    assert.equal(countRequests(provider, '-1.zip'), 1);
    assert.equal(countRequests(provider, '-schema.xml'), 1);
  } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});

test('元数据描述两次构建时保留不齐而不混装', async () => {
  const provider = await createProvider();
  const directory = await mkdtemp(join(tmpdir(), 'set-cohort-'));
  try {
    const first = await receiveCurrent(provider.base, directory);
    assert.equal(first.complete, true);
    assert.equal(first.build, '20261114.090000-1');
    await controlled(provider, { generation: 2, skew: true });
    const mixed = await receiveCurrent(provider.base, directory);
    assert.equal(mixed.complete, false);
    assert.equal(mixed.retryable, true);
    assert.equal(mixed.cohort.consistent, false);
    assert.equal(mixed.release, null);
    assert.equal(provider.audit.filter(request => request.path.includes('20261114.093000-2')).length, 0);
    assert.equal(byClassifier(mixed, '').status, 'received');
    assert.equal(byClassifier(mixed, '').receivedBuild, '20261114.090000-1');
    await controlled(provider, { skew: false });
    const healed = await receiveCurrent(provider.base, directory);
    assert.equal(healed.complete, true);
    assert.equal(healed.release, '1.2-20261114.093000-2');
    const received = healed.files.filter(file => file.status === 'received');
    assert.ok(received.length >= 2);
    assert.ok(received.every(file => file.receivedBuild === '20261114.093000-2'));
    const progress = await setState(directory);
    assert.equal(progress.build, '20261114.093000-2');
    assert.equal(progress.previous.length, 1);
    assert.equal(progress.previous[0].build, '20261114.090000-1');
    assert.equal(progress.previous[0].files[':zip'].status, 'received');
  } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});
