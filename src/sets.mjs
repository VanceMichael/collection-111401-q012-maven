import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

// 每个坐标一组进度文件，逐文件原子落盘：暂缺、缺失都不会冲掉已收文件的记录。
export class SetStore {
  constructor(root) { this.directory = join(root, 'sets'); }

  path(key) {
    return join(this.directory, createHash('sha256').update(key).digest('hex') + '.json');
  }

  async load(key) {
    try { return JSON.parse(await readFile(this.path(key), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async save(set) {
    await mkdir(this.directory, { recursive: true });
    const record = { ...set, updated: new Date().toISOString() };
    const target = this.path(set.key);
    const staging = target + '.pending';
    const handle = await open(staging, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(record, null, 2));
      await handle.sync();
    } finally { await handle.close(); }
    await rename(staging, target);
    const directory = await open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return record;
  }
}
