import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allocate } from '@jarvis/core';
import { ensureDataRoot, loadConfig, openDb, upsertTask, getTasks, addTimeLog, getWeekLogs, writePlan } from './index';

describe('store integration: config -> db -> allocate -> plan file', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-int-'));
    ensureDataRoot(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('drives the whole persistence path end to end', () => {
    fs.writeFileSync(
      path.join(dir, 'config.yaml'),
      `dailyCapacityHours: 8
streams:
  - id: work
    name: Work
    weeklyBudgetHours: 20
`,
      'utf8',
    );

    const cfg = loadConfig(dir);
    const db = openDb(dir);
    upsertTask(db, { id: 't1', streamId: 'work', title: 'Review PR', source: 'github', status: 'todo', spentHours: 0 });
    addTimeLog(db, { date: '2026-07-13', streamId: 'work', hours: 4 });

    const { allocation, alerts } = allocate({
      date: '2026-07-14', // Tuesday, 4 remaining workdays
      streams: cfg.streams,
      tasks: getTasks(db),
      weekLogs: getWeekLogs(db, '2026-07-14'),
      committedHoursToday: 0,
      dailyCapacityHours: cfg.dailyCapacityHours,
      deadlineHorizonDays: cfg.deadlineHorizonDays,
      fallingBehindPct: cfg.fallingBehindPct,
      droppedBallDays: cfg.droppedBallDays,
    });

    // remaining 16h over 4 workdays -> 4.0h target for "work"
    expect(allocation.lines[0]?.streamId).toBe('work');
    expect(allocation.lines[0]?.targetHours).toBe(4);

    const streamNames = Object.fromEntries(cfg.streams.map((s) => [s.id, s.name]));
    const file = writePlan(dir, allocation, alerts, streamNames);

    const md = fs.readFileSync(file, 'utf8');
    expect(md).toContain('# Plan — 2026-07-14');
    expect(md).toContain('## Work — 4h');
    expect(md).toContain('- [ ] Review PR');
    db.close();
  });
});
