import { describe, it, expect } from 'vitest';
import { rankTasks } from './rank';
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

describe('rankTasks', () => {
  it('keeps only the stream, drops done, sorts by deadline then estimate', () => {
    const tasks: Task[] = [
      task({ id: 'a', deadline: '2026-07-20', estimateHours: 1 }),
      task({ id: 'b', deadline: '2026-07-16', estimateHours: 2 }),
      task({ id: 'c' }), // no deadline -> last
      task({ id: 'd', deadline: '2026-07-16', estimateHours: 5 }), // same deadline as b, bigger estimate first
      task({ id: 'e', status: 'done', deadline: '2026-07-15' }), // dropped
      task({ id: 'f', streamId: 's2', deadline: '2026-07-15' }), // other stream, dropped
    ];
    expect(rankTasks('s1', tasks).map((t) => t.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('treats a missing estimate as 0 when breaking a deadline tie', () => {
    const tasks = [
      task({ id: 'p', deadline: '2026-07-16' }), // no estimate -> 0
      task({ id: 'q', deadline: '2026-07-16', estimateHours: 1 }),
    ];
    expect(rankTasks('s1', tasks).map((t) => t.id)).toEqual(['q', 'p']);
  });
});
