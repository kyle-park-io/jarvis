import type { WorkStream, Task, TimeLog, AllocationLine, Allocation, Alert } from './model';
import { countRemainingWorkdays } from './dates';
import { rankTasks } from './rank';
import { deadlinePressure } from './pressure';
import { scanFallingBehind, scanDeadlineRisks, scanDroppedBalls } from './alerts';

export interface AllocateInput {
  date: string;
  streams: WorkStream[];
  tasks: Task[];
  weekLogs: TimeLog[];
  committedHoursToday: number;
  dailyCapacityHours: number;
  deadlineHorizonDays: number;
  fallingBehindPct?: number; // default 25
  droppedBallDays?: number; // default 2
}

export interface AllocateResult {
  allocation: Allocation;
  alerts: Alert[];
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface RawLine {
  stream: WorkStream;
  target: number;
  tasks: Task[];
  logged: number;
}

export function allocate(input: AllocateInput): AllocateResult {
  const { date, streams, tasks, weekLogs, committedHoursToday, dailyCapacityHours, deadlineHorizonDays } = input;
  const capacity = Math.max(0, dailyCapacityHours - committedHoursToday);
  const alerts: Alert[] = [];

  const raw: RawLine[] = [];
  for (const s of streams) {
    if (!s.active) continue;
    const logged = weekLogs
      .filter((l) => l.streamId === s.id)
      .reduce((sum, l) => sum + l.hours, 0);
    const remainingWeekly = Math.max(0, s.weeklyBudgetHours - logged);
    const remainingWorkdays = countRemainingWorkdays(date, s.workdays);
    const basePace = remainingWorkdays > 0 ? remainingWeekly / remainingWorkdays : remainingWeekly;
    const pressure = deadlinePressure(s.id, tasks, date, deadlineHorizonDays);
    const target = Math.min(remainingWeekly, Math.max(basePace, pressure));
    raw.push({ stream: s, target, tasks: rankTasks(s.id, tasks), logged });
  }

  const totalTarget = raw.reduce((sum, r) => sum + r.target, 0);
  let overcommitted = false;
  if (totalTarget > capacity && totalTarget > 0) {
    overcommitted = true;
    const scale = capacity / totalTarget;
    for (const r of raw) r.target *= scale;
    alerts.push({
      type: 'overcommit',
      severity: 'warn',
      message: `Today's target ${round1(totalTarget)}h exceeds capacity ${round1(capacity)}h; scaled down.`,
    });
  }

  const lines: AllocationLine[] = raw
    .sort((a, b) => b.target - a.target)
    .map((r) => ({ streamId: r.stream.id, targetHours: round1(r.target), tasks: r.tasks }))
    .filter((l) => l.targetHours > 0);

  const allocation: Allocation = { date, capacityHours: capacity, lines, overcommitted };

  const fallingBehindPct = input.fallingBehindPct ?? 25;
  const droppedBallDays = input.droppedBallDays ?? 2;
  for (const r of raw) {
    alerts.push(...scanFallingBehind(r.stream, r.logged, date, fallingBehindPct));
  }
  alerts.push(...scanDeadlineRisks(tasks, allocation, date, deadlineHorizonDays));
  alerts.push(...scanDroppedBalls(tasks, date, droppedBallDays));

  return { allocation, alerts };
}
