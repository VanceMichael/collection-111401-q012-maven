import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProvider } from '../provider/server.mjs';
import { receiveCurrent } from '../src/domain.mjs';
import { Archive } from '../src/archive.mjs';
import { createHash } from 'node:crypto';

async function controlled(provider, change) {
  const response = await fetch(provider.base + '/_control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) });
  assert.equal(response.status, 200);
}

test('具体构建文件的校验资料匹配原始字节',async()=>{
 const provider=await createProvider();
 try {
  const address=provider.base+'/repository/local/devices/protocol/1.2-SNAPSHOT/protocol-1.2-20261114.090000-1-schema.xml';
  const bytes=Buffer.from(await(await fetch(address)).arrayBuffer());
  assert.equal((await(await fetch(address+'.sha256')).text()).trim(),createHash('sha256').update(bytes).digest('hex'));
 }finally{await provider.close();}
});

test('现有业务入口真实收存来源资料并可重新打开', async () => {
  const provider = await createProvider();
  const directory = await mkdtemp(join(tmpdir(), 'business-'));
  try {
    const result = await receiveCurrent(provider.base, directory);
    assert.ok(result);
    const archive = new Archive(directory);
    const receipts = await archive.list();
    assert.ok(receipts.length > 0);
    for (const receipt of receipts) assert.ok((await archive.read(receipt)).length > 0);
    assert.ok(provider.audit.some(request => !request.path.startsWith('/_')));
  } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});

test('快照元数据提供具体构建和分类', async () => {
 const provider = await createProvider();
 try {
const index=await(await fetch(provider.base+'/repository/metadata')).json();const xml=await(await fetch(provider.base+index.metadata)).text();assert.match(xml,/<classifier>schema<\/classifier>/);assert.match(xml,/20261114.090000-1/);
 } finally { await provider.close(); }
});

test('发布暂缺不同于可选分类不存在', async () => {
 const provider = await createProvider();
 try {
await controlled(provider,{mode:'publishing'});assert.equal((await fetch(provider.base+'/repository/local/devices/protocol/1.2-SNAPSHOT/protocol-1.2-20261114.090000-1-schema.xml')).status,503);assert.equal((await fetch(provider.base+'/repository/local/devices/protocol/1.2-SNAPSHOT/protocol-1.2-20261114.090000-1-notes.txt')).status,404);
 } finally { await provider.close(); }
});

test('可变快照可以更新到另一具体构建', async () => {
 const provider = await createProvider();
 try {
await controlled(provider,{generation:2});assert.match(await(await fetch(provider.base+'/repository/local/devices/protocol/1.2-SNAPSHOT/maven-metadata.xml')).text(),/20261114.093000-2/);
 } finally { await provider.close(); }
});
