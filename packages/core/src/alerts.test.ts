import { describe, it, expect } from 'vitest';
import { scanFallingBehind, scanDeadlineRisks, scanDroppedBalls } from './alerts';
import type { WorkStream, Task, Allocation } from './model';

const MON_FRI = [1, 2, 3, 4, 5];

function stream(partial: Partial<WorkStream> & { id: string }): WorkStream {
  return { name: partial.id, weeklyBudgetHours: 10, weight: 0.5, workdays: MON_FRI, active: true, ...partial };
}
function task(partial: Partial<Task> & { id: string }): Task {
  return { streamId: 's1', title: partial.id, source: 'manual', status: 'todo', spentHours: 0, ...partial };
}

describe('scanFallingBehind', () => {
  // 2026-07-15 is a Wednesday: elapsed workdays Mon,Tue,Wed = 3 of 5 -> expected 60% of budget
  const wed = '2026-07-15';

  it('warns when logged is far below the expected pace', () => {
    const s = stream({ id: 's1', weeklyBudgetHours: 10 }); // expected 6.0h by Wed
    const alerts = scanFallingBehind(s, 1, wed, 25); // 1h << 6 * 0.75
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.type).toBe('falling_behind');
    expect(alerts[0]?.streamId).toBe('s1');
  });

  it('stays quiet when on pace', () => {
    const s = stream({ id: 's1', weeklyBudgetHours: 10 });
    expect(scanFallingBehind(s, 6, wed, 25)).toEqual([]);
  });
});

describe('scanDeadlineRisks', () => {
  const today = '2026-07-14';

  it('flags an open dated task in horizon whose stream got zero allocation', () => {
    const tasks = [task({ id: 't1', streamId: 's2', deadline: '2026-07-15', estimateHours: 4 })];
    const allocation: Allocation = {
      date: today,
      capacityHours: 8,
      lines: [{ streamId: 's1', targetHours: 5, tasks: [] }], // s2 absent -> zero
      overcommitted: false,
    };
    const alerts = scanDeadlineRisks(tasks, allocation, today, 5);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'deadline_risk', severity: 'critical', taskId: 't1' });
  });

  it('does not flag when the stream has a positive allocation', () => {
    const tasks = [task({ id: 't1', streamId: 's1', deadline: '2026-07-15', estimateHours: 4 })];
    const allocation: Allocation = {
      date: today,
      capacityHours: 8,
      lines: [{ streamId: 's1', targetHours: 5, tasks: [] }],
      overcommitted: false,
    };
    expect(scanDeadlineRisks(tasks, allocation, today, 5)).toEqual([]);
  });
});

describe('scanDroppedBalls', () => {
  const today = '2026-07-14';

  it('flags open tasks waiting longer than the threshold', () => {
    const tasks = [
      task({ id: 'old', waitingSince: '2026-07-10' }), // 4 days
      task({ id: 'fresh', waitingSince: '2026-07-13' }), // 1 day
      task({ id: 'done', waitingSince: '2026-07-01', status: 'done' }),
    ];
    const alerts = scanDroppedBalls(tasks, today, 2);
    expect(alerts.map((a) => a.taskId)).toEqual(['old']);
    expect(alerts[0]?.type).toBe('dropped_ball');
  });
});

describe('scanFallingBehind edge cases', () => {
  it('returns nothing when the stream has no workdays this week', () => {
    const s = stream({ id: 's1', workdays: [], weeklyBudgetHours: 10 });
    expect(scanFallingBehind(s, 0, '2026-07-15', 25)).toEqual([]);
  });

  it('stays quiet exactly at the floor boundary', () => {
    // Wed 2026-07-15, budget 10 -> expected 6, floor = 6 * 0.75 = 4.5
    const s = stream({ id: 's1', weeklyBudgetHours: 10 });
    expect(scanFallingBehind(s, 4.5, '2026-07-15', 25)).toEqual([]);
  });
});

describe('scanDeadlineRisks edge cases', () => {
  it('does not flag an overdue task (deadline before today)', () => {
    const tasks = [task({ id: 't1', streamId: 's2', deadline: '2026-07-10', estimateHours: 4 })];
    const allocation: Allocation = {
      date: '2026-07-14',
      capacityHours: 8,
      lines: [{ streamId: 's1', targetHours: 5, tasks: [] }],
      overcommitted: false,
    };
    expect(scanDeadlineRisks(tasks, allocation, '2026-07-14', 5)).toEqual([]);
  });
});
