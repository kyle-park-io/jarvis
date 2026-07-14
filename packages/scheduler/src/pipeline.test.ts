import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDataRoot } from '@jarvis/store';
import { folderConnector } from '@jarvis/connectors';
import { runDailyPlan } from './pipeline';

describe('runDailyPlan', () => {
  let dataRoot: string;
  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sched-'));
    ensureDataRoot(dataRoot);
    fs.mkdirSync(path.join(dataRoot, 'streams'));
    fs.writeFileSync(
      path.join(dataRoot, 'config.yaml'),
      `dailyCapacityHours: 8
streams:
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

  it('pulls folder tasks, allocates, and writes the plan file', async () => {
    fs.writeFileSync(path.join(dataRoot, 'streams', 'work.md'), '- [ ] Do work', 'utf8');

    const result = await runDailyPlan({
      dataRoot,
      connectors: [folderConnector(path.join(dataRoot, 'streams'))],
      date: '2026-07-14', // Tuesday, 4 remaining workdays
    });

    // 20h budget / 4 workdays = 5.0h for "work"
    expect(result.allocation.lines[0]?.streamId).toBe('work');
    expect(result.allocation.lines[0]?.targetHours).toBe(5);
    expect(fs.existsSync(result.planPath)).toBe(true);
    const md = fs.readFileSync(result.planPath, 'utf8');
    expect(md).toContain('## Work — 5h');
    expect(md).toContain('- [ ] Do work');
  });
});
