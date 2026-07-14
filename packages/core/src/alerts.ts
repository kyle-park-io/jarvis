import type { WorkStream, Task, Alert, Allocation } from './model';
import { workdaysInWeek, workdaysElapsed, daysUntil } from './dates';

export function scanFallingBehind(
  stream: WorkStream,
  loggedThisWeek: number,
  today: string,
  thresholdPct: number,
): Alert[] {
  const total = workdaysInWeek(today, stream.workdays);
  if (total === 0) return [];
  const elapsed = workdaysElapsed(today, stream.workdays);
  const expected = stream.weeklyBudgetHours * (elapsed / total);
  const floor = expected * (1 - thresholdPct / 100);
  if (loggedThisWeek < floor) {
    return [
      {
        type: 'falling_behind',
        severity: 'warn',
        streamId: stream.id,
        message: `${stream.name} is behind pace: ${loggedThisWeek}h logged vs ~${Math.round(expected)}h expected by today.`,
      },
    ];
  }
  return [];
}

export function scanDeadlineRisks(
  tasks: Task[],
  allocation: Allocation,
  today: string,
  horizonDays: number,
): Alert[] {
  const allocated = new Set(allocation.lines.filter((l) => l.targetHours > 0).map((l) => l.streamId));
  const alerts: Alert[] = [];
  for (const t of tasks) {
    if (t.status === 'done') continue;
    if (!t.deadline) continue;
    const d = daysUntil(today, t.deadline);
    if (d < 0 || d > horizonDays) continue;
    if (allocated.has(t.streamId)) continue;
    alerts.push({
      type: 'deadline_risk',
      severity: 'critical',
      streamId: t.streamId,
      taskId: t.id,
      message: `"${t.title}" is due in ${d}d but its stream has no time allocated today.`,
    });
  }
  return alerts;
}

export function scanDroppedBalls(tasks: Task[], today: string, droppedBallDays: number): Alert[] {
  const alerts: Alert[] = [];
  for (const t of tasks) {
    if (t.status === 'done') continue;
    if (!t.waitingSince) continue;
    if (daysUntil(t.waitingSince, today) > droppedBallDays) {
      alerts.push({
        type: 'dropped_ball',
        severity: 'warn',
        streamId: t.streamId,
        taskId: t.id,
        message: `"${t.title}" has been waiting since ${t.waitingSince}.`,
      });
    }
  }
  return alerts;
}
