import type { Task } from './model';

export function rankTasks(streamId: string, tasks: Task[]): Task[] {
  return tasks
    .filter((t) => t.streamId === streamId && t.status !== 'done')
    .sort((a, b) => {
      const ad = a.deadline ?? '9999-12-31';
      const bd = b.deadline ?? '9999-12-31';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return (b.estimateHours ?? 0) - (a.estimateHours ?? 0);
    });
}
