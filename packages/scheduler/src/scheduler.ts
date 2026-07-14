import { Cron } from 'croner';

export interface SchedulerOptions {
  onDailyPlan: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  dailyPlanCron?: string;
  timezone?: string;
}

export interface SchedulerHandle {
  stop(): void;
  nextRun(): Date | null;
}

export function startScheduler(options: SchedulerOptions): SchedulerHandle {
  const pattern = options.dailyPlanCron ?? '0 8 * * *';
  const job = new Cron(
    pattern,
    {
      catch: (error: unknown) => options.onError?.(error),
      ...(options.timezone ? { timezone: options.timezone } : {}),
    },
    options.onDailyPlan,
  );
  return {
    stop: () => job.stop(),
    nextRun: () => job.nextRun(),
  };
}
