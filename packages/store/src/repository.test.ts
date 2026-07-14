import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, type DB } from './db';
import { upsertTask, getTasks, addTimeLog, getWeekLogs, syncSourceTasks } from './repository';
import type { Task } from '@jarvis/core';

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    streamId: 's1',
    title: partial.id,
    source: 'manual',
    status: 'todo',
    spentHours: 0,
    ...partial,
  };
}

describe('repository', () => {
  let db: DB;
  beforeEach(() => {
    db = openDatabase(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('round-trips a task through upsert/get, preserving optional fields', () => {
    upsertTask(db, task({ id: 't1', title: 'Ship', estimateHours: 4, deadline: '2026-07-20', waitingSince: '2026-07-10' }));
    const got = getTasks(db);
    expect(got).toEqual([
      {
        id: 't1',
        streamId: 's1',
        title: 'Ship',
        source: 'manual',
        status: 'todo',
        spentHours: 0,
        estimateHours: 4,
        deadline: '2026-07-20',
        waitingSince: '2026-07-10',
      },
    ]);
  });

  it('upsert updates an existing task by id', () => {
    upsertTask(db, task({ id: 't1', status: 'todo' }));
    upsertTask(db, task({ id: 't1', status: 'done', spentHours: 5 }));
    const got = getTasks(db);
    expect(got).toHaveLength(1);
    expect(got[0]?.status).toBe('done');
    expect(got[0]?.spentHours).toBe(5);
  });

  it('omits optional fields that were not set (undefined, not null)', () => {
    upsertTask(db, task({ id: 't2' }));
    const got = getTasks(db)[0];
    expect(got?.estimateHours).toBeUndefined();
    expect(got?.deadline).toBeUndefined();
    expect(got?.waitingSince).toBeUndefined();
    expect(got?.sourceRef).toBeUndefined();
  });

  it('returns only this week\'s time logs (Mon–Sun of the reference date)', () => {
    addTimeLog(db, { date: '2026-07-12', streamId: 's1', hours: 2 }); // Sunday of previous week
    addTimeLog(db, { date: '2026-07-13', streamId: 's1', hours: 3 }); // Monday (in week)
    addTimeLog(db, { date: '2026-07-15', streamId: 's1', taskId: 't1', hours: 1 }); // Wed (in week)
    addTimeLog(db, { date: '2026-07-20', streamId: 's1', hours: 4 }); // next Monday (out)
    const logs = getWeekLogs(db, '2026-07-14'); // Tuesday
    expect(logs).toEqual([
      { date: '2026-07-13', streamId: 's1', taskId: undefined, hours: 3 },
      { date: '2026-07-15', streamId: 's1', taskId: 't1', hours: 1 },
    ]);
  });

  it('round-trips a task with a sourceRef', () => {
    upsertTask(db, task({ id: 't3', sourceRef: 'github:owner/repo#42' }));
    expect(getTasks(db)[0]?.sourceRef).toBe('github:owner/repo#42');
  });

  it('syncSourceTasks upserts present tasks and deletes gone ones of the same source, leaving other sources', () => {
    upsertTask(db, task({ id: 'folder:s:A', title: 'A', source: 'folder' }));
    upsertTask(db, task({ id: 'folder:s:B', title: 'B', source: 'folder' }));
    upsertTask(db, task({ id: 'github:s:1', title: 'gh', source: 'github' }));

    syncSourceTasks(db, 'folder', [
      task({ id: 'folder:s:A', title: 'A2', status: 'done' }), // updated
      task({ id: 'folder:s:C', title: 'C' }), // new
      // B is gone
    ]);

    const got = getTasks(db);
    expect(got.map((t) => t.id).sort()).toEqual(['folder:s:A', 'folder:s:C', 'github:s:1']);
    expect(got.find((t) => t.id === 'folder:s:A')?.title).toBe('A2');
    expect(got.find((t) => t.id === 'folder:s:A')?.status).toBe('done');
  });
});
