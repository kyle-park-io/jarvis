import { allocate, type Allocation, type Alert } from '@jarvis/core';
import { openDb, loadConfig, getTasks, getWeekLogs, syncSourceTasks, writePlan } from '@jarvis/store';
import type { Connector } from '@jarvis/connectors';

export interface RunDailyPlanOptions {
  dataRoot: string;
  connectors: Connector[];
  date: string;
  committedHoursToday?: number;
}

export interface DailyPlanResult {
  allocation: Allocation;
  alerts: Alert[];
  planPath: string;
}

export async function runDailyPlan(options: RunDailyPlanOptions): Promise<DailyPlanResult> {
  const { dataRoot, connectors, date, committedHoursToday = 0 } = options;
  const config = loadConfig(dataRoot);
  const db = openDb(dataRoot);
  try {
    for (const connector of connectors) {
      const tasks = await connector.pull();
      syncSourceTasks(db, connector.id, tasks);
    }

    const { allocation, alerts } = allocate({
      date,
      streams: config.streams,
      tasks: getTasks(db),
      weekLogs: getWeekLogs(db, date),
      committedHoursToday,
      dailyCapacityHours: config.dailyCapacityHours,
      deadlineHorizonDays: config.deadlineHorizonDays,
      fallingBehindPct: config.fallingBehindPct,
      droppedBallDays: config.droppedBallDays,
    });

    const streamNames = Object.fromEntries(config.streams.map((s) => [s.id, s.name]));
    const planPath = writePlan(dataRoot, allocation, alerts, streamNames);
    return { allocation, alerts, planPath };
  } finally {
    db.close();
  }
}
