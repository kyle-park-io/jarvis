import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pullFolderTasks, folderConnector } from './folder';

describe('pullFolderTasks', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-folder-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeStream(name: string, content: string): void {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }

  it('reads every .md file, using the filename as the stream id', () => {
    writeStream('trading.md', '- [ ] Review PR ~2h\n- [x] Merge');
    writeStream('personal.md', '- [ ] Write blog');
    writeStream('notes.txt', '- [ ] should be ignored (not .md)');

    const tasks = pullFolderTasks(dir);
    // sorted by filename: personal.md before trading.md
    expect(tasks.map((t) => t.id)).toEqual([
      'folder:personal:Write blog',
      'folder:trading:Review PR',
      'folder:trading:Merge',
    ]);
    expect(tasks.find((t) => t.title === 'Review PR')?.estimateHours).toBe(2);
    expect(tasks.find((t) => t.title === 'Merge')?.status).toBe('done');
  });

  it('returns an empty array when the directory does not exist', () => {
    expect(pullFolderTasks(path.join(dir, 'nope'))).toEqual([]);
  });

  it('ignores directories ending in .md and files named exactly ".md"', () => {
    fs.mkdirSync(path.join(dir, 'subdir.md')); // a DIRECTORY ending in .md
    writeStream('.md', '- [ ] orphan'); // a file literally named ".md"
    writeStream('real.md', '- [ ] Real task');
    expect(pullFolderTasks(dir).map((t) => t.id)).toEqual(['folder:real:Real task']);
  });
});

describe('folderConnector', () => {
  it('exposes id "folder" and pulls tasks asynchronously', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-folder-'));
    try {
      fs.writeFileSync(path.join(dir, 's.md'), '- [ ] Task', 'utf8');
      const connector = folderConnector(dir);
      expect(connector.id).toBe('folder');
      const tasks = await connector.pull();
      expect(tasks.map((t) => t.title)).toEqual(['Task']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
