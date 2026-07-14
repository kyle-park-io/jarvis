import { describe, it, expect } from 'vitest';
import { deadlinePressure } from './pressure';
import type { Task } from './model';

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

describe('deadlinePressure', () => {
  const today = '2026-07-14';

  it('spreads each due task estimate over inclusive days until due', () => {
    // due in 1 day -> daysUntil=1 -> spread over 2 days -> 4/2 = 2
    const tasks = [task({ id: 'a', deadline: '2026-07-15', estimateHours: 4 })];
    expect(deadlinePressure('s1', tasks, today, 5)).toBeCloseTo(2);
  });

  it('sums across tasks and ignores out-of-horizon, done, undated, and other streams', () => {
    const tasks: Task[] = [
      task({ id: 'a', deadline: '2026-07-14', estimateHours: 3 }), // due today -> 3/1 = 3
      task({ id: 'b', deadline: '2026-07-16', estimateHours: 4 }), // in 2 days -> 4/3
      task({ id: 'c', deadline: '2026-08-01', estimateHours: 9 }), // beyond horizon -> 0
      task({ id: 'd', estimateHours: 9 }), // undated -> 0
      task({ id: 'e', deadline: '2026-07-15', estimateHours: 9, status: 'done' }), // done -> 0
      task({ id: 'f', streamId: 's2', deadline: '2026-07-15', estimateHours: 9 }), // other stream
    ];
    expect(deadlinePressure('s1', tasks, today, 5)).toBeCloseTo(3 + 4 / 3);
  });

  it('treats a missing estimate as 0', () => {
    const tasks = [task({ id: 'a', deadline: '2026-07-15' })];
    expect(deadlinePressure('s1', tasks, today, 5)).toBe(0);
  });

  it('excludes past-due tasks (negative daysUntil)', () => {
    const tasks = [task({ id: 'x', deadline: '2026-07-10', estimateHours: 5 })]; // 4 days ago
    expect(deadlinePressure('s1', tasks, today, 5)).toBe(0);
  });

  it('includes a task due exactly at the horizon boundary', () => {
    // today + 5 days = 2026-07-19 -> d = 5 == horizon -> included: 6 / (5 + 1) = 1
    const tasks = [task({ id: 'edge', deadline: '2026-07-19', estimateHours: 6 })];
    expect(deadlinePressure('s1', tasks, today, 5)).toBeCloseTo(1);
  });
});
