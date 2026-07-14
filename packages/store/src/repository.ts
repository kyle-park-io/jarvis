import type { DB } from './db';
import type { Task, TimeLog } from '@jarvis/core';
import { weekStart, parseISODate, toISODate } from '@jarvis/core';

interface TaskRow {
  id: string;
  stream_id: string;
  title: string;
  source: string;
  source_ref: string | null;
  estimate_hours: number | null;
  deadline: string | null;
  status: string;
  spent_hours: number;
  waiting_since: string | null;
}

interface TimeLogRow {
  date: string;
  stream_id: string;
  task_id: string | null;
  hours: number;
}

const DAY_MS = 86_400_000;

export function upsertTask(db: DB, task: Task): void {
  db.prepare(
    `INSERT INTO tasks
       (id, stream_id, title, source, source_ref, estimate_hours, deadline, status, spent_hours, waiting_since)
     VALUES
       (@id, @streamId, @title, @source, @sourceRef, @estimateHours, @deadline, @status, @spentHours, @waitingSince)
     ON CONFLICT(id) DO UPDATE SET
       stream_id = excluded.stream_id,
       title = excluded.title,
       source = excluded.source,
       source_ref = excluded.source_ref,
       estimate_hours = excluded.estimate_hours,
       deadline = excluded.deadline,
       status = excluded.status,
       spent_hours = excluded.spent_hours,
       waiting_since = excluded.waiting_since`,
  ).run({
    id: task.id,
    streamId: task.streamId,
    title: task.title,
    source: task.source,
    sourceRef: task.sourceRef ?? null,
    estimateHours: task.estimateHours ?? null,
    deadline: task.deadline ?? null,
    status: task.status,
    spentHours: task.spentHours,
    waitingSince: task.waitingSince ?? null,
  });
}

function rowToTask(r: TaskRow): Task {
  const t: Task = {
    id: r.id,
    streamId: r.stream_id,
    title: r.title,
    source: r.source as Task['source'],
    status: r.status as Task['status'],
    spentHours: r.spent_hours,
  };
  if (r.source_ref !== null) t.sourceRef = r.source_ref;
  if (r.estimate_hours !== null) t.estimateHours = r.estimate_hours;
  if (r.deadline !== null) t.deadline = r.deadline;
  if (r.waiting_since !== null) t.waitingSince = r.waiting_since;
  return t;
}

export function getTasks(db: DB): Task[] {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id').all() as TaskRow[];
  return rows.map(rowToTask);
}

export function addTimeLog(db: DB, log: TimeLog): void {
  db.prepare('INSERT INTO time_logs (date, stream_id, task_id, hours) VALUES (?, ?, ?, ?)').run(
    log.date,
    log.streamId,
    log.taskId ?? null,
    log.hours,
  );
}

export function getWeekLogs(db: DB, referenceDate: string): TimeLog[] {
  const start = weekStart(referenceDate);
  const end = toISODate(new Date(parseISODate(start).getTime() + 6 * DAY_MS));
  const rows = db
    .prepare('SELECT date, stream_id, task_id, hours FROM time_logs WHERE date >= ? AND date <= ? ORDER BY date')
    .all(start, end) as TimeLogRow[];
  return rows.map((r) => {
    const log: TimeLog = { date: r.date, streamId: r.stream_id, hours: r.hours };
    if (r.task_id !== null) log.taskId = r.task_id;
    return log;
  });
}
