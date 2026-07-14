import { parseISODate, toISODate, type Task } from '@jarvis/core';

const TASK_RE = /^- \[( |x|X)\]\s+(.*)$/;
const DEADLINE_RE = /@(\d{4}-\d{2}-\d{2})/;
const ESTIMATE_RE = /~(\d+(?:\.\d+)?)h\b/;

export function parseStreamLine(streamId: string, line: string): Task | null {
  const m = TASK_RE.exec(line.trim());
  if (!m) return null;

  const checked = m[1] === 'x' || m[1] === 'X';
  const rest = m[2] ?? '';

  const rawDeadline = DEADLINE_RE.exec(rest)?.[1];
  const estStr = ESTIMATE_RE.exec(rest)?.[1];

  const title = rest.replace(DEADLINE_RE, '').replace(ESTIMATE_RE, '').replace(/\s+/g, ' ').trim();
  if (title === '') return null;

  const task: Task = {
    id: `folder:${streamId}:${title}`,
    streamId,
    title,
    source: 'folder',
    status: checked ? 'done' : 'todo',
    spentHours: 0,
  };
  // Keep the deadline only if it is a real calendar date (round-trips through core's UTC parse).
  if (rawDeadline !== undefined && toISODate(parseISODate(rawDeadline)) === rawDeadline) {
    task.deadline = rawDeadline;
  }
  if (estStr !== undefined) task.estimateHours = Number(estStr);
  return task;
}

export function parseStreamFile(streamId: string, content: string): Task[] {
  const tasks: Task[] = [];
  for (const line of content.split('\n')) {
    const task = parseStreamLine(streamId, line);
    if (task) tasks.push(task);
  }
  return tasks;
}
