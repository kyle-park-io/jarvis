import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { folderConnector } from './index';

describe('folder connector integration', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-conn-int-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads real stream files into core Task objects', async () => {
    fs.writeFileSync(
      path.join(dir, 'trading.md'),
      ['# Trading', '', '- [ ] Review PR #482 @2026-07-20 ~4h', '- [x] Merge hotfix'].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'personal.md'), '- [ ] Write blog ~2h', 'utf8');

    const tasks = await folderConnector(dir).pull();
    expect(tasks).toHaveLength(3);

    const review = tasks.find((t) => t.title === 'Review PR #482');
    expect(review).toMatchObject({
      streamId: 'trading',
      source: 'folder',
      status: 'todo',
      deadline: '2026-07-20',
      estimateHours: 4,
    });
    expect(tasks.find((t) => t.title === 'Merge hotfix')?.status).toBe('done');
    expect(tasks.find((t) => t.title === 'Write blog')?.streamId).toBe('personal');
  });
});
