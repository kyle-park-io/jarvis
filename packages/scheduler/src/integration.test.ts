import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDataRoot, openDb, getTasks } from '@jarvis/store';
import { folderConnector } from '@jarvis/connectors';
import { runDailyPlan } from './index';

describe('scheduler reconciliation integration', () => {
  let dataRoot: string;
  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sched-int-'));
    ensureDataRoot(dataRoot);
    fs.mkdirSync(path.join(dataRoot, 'streams'));
    fs.writeFileSync(
      path.join(dataRoot, 'config.yaml'),
      `streams:
  - id: work
    name: Work
    weeklyBudgetHours: 20
`,
      'utf8',
    );
  });
  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('deletes a folder task from the store once it is removed from the file', async () => {
    const streamsDir = path.join(dataRoot, 'streams');
    const workFile = path.join(streamsDir, 'work.md');
    const connectors = [folderConnector(streamsDir)];

    fs.writeFileSync(workFile, '- [ ] Alpha\n- [ ] Beta', 'utf8');
    await runDailyPlan({ dataRoot, connectors, date: '2026-07-14' });

    let db = openDb(dataRoot);
    expect(getTasks(db).map((t) => t.title).sort()).toEqual(['Alpha', 'Beta']);
    db.close();

    // Remove "Beta" from the file, re-run.
    fs.writeFileSync(workFile, '- [ ] Alpha', 'utf8');
    await runDailyPlan({ dataRoot, connectors, date: '2026-07-14' });

    db = openDb(dataRoot);
    expect(getTasks(db).map((t) => t.title)).toEqual(['Alpha']); // Beta reconciled away
    db.close();
  });
});
