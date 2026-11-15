import { createProvider } from '../provider/server.mjs';
import { receiveCurrent } from '../src/domain.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'collection-'));
const provider = await createProvider();
const control = change => fetch(provider.base + '/_control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) });
try {
  const first = await receiveCurrent(provider.base, directory);
  await control({ generation: 2, mode: 'publishing' });
  const second = await receiveCurrent(provider.base, directory);
  await control({ mode: 'normal' });
  const third = await receiveCurrent(provider.base, directory);
  console.log(JSON.stringify({ service: 'maven', runs: { first, second, third }, requests: provider.audit }, null, 2));
} finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
