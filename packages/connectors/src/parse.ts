import type { Task } from '@jarvis/core';

const TASK_RE = /^- \[( |x|X)\]\s+(.*)$/;
const DEADLINE_RE = /@(\d{4}-\d{2}-\d{2})/;
const ESTIMATE_RE = /~(\d+(?:\.\d+)?)h\b/;

export function parseStreamLine(streamId: string, line: string): Task | null {
  const m = TASK_RE.exec(line.trim());
  if (!m) return null;

  const checked = m[1] === 'x' || m[1] === 'X';
  let title = m[2] ?? '';

  const deadline = DEADLINE_RE.exec(title)?.[1];
  const estStr = ESTIMATE_RE.exec(title)?.[1];
  const estimateHours = estStr !== undefined ? Number(estStr) : undefined;

  title = title.replace(DEADLINE_RE, '').replace(ESTIMATE_RE, '').replace(/\s+/g, ' ').trim();

  const task: Task = {
    id: `folder:${streamId}:${title}`,
    streamId,
    title,
    source: 'folder',
    status: checked ? 'done' : 'todo',
    spentHours: 0,
  };
  if (deadline !== undefined) task.deadline = deadline;
  if (estimateHours !== undefined) task.estimateHours = estimateHours;
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
