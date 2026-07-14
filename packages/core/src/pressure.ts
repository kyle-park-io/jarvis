import type { Task } from './model';
import { daysUntil } from './dates';

export function deadlinePressure(
  streamId: string,
  tasks: Task[],
  today: string,
  horizonDays: number,
): number {
  let demand = 0;
  for (const t of tasks) {
    if (t.streamId !== streamId) continue;
    if (t.status === 'done') continue;
    if (!t.deadline) continue;
    const d = daysUntil(today, t.deadline);
    if (d < 0 || d > horizonDays) continue;
    const estimate = Math.max(0, (t.estimateHours ?? 0) - t.spentHours);
    demand += estimate / (d + 1); // inclusive spread; d>=0 so denominator >=1
  }
  return demand;
}
