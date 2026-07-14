import { Cron } from 'croner';

export interface SchedulerOptions {
  onDailyPlan: () => void | Promise<void>;
  dailyPlanCron?: string;
  timezone?: string;
}

export interface SchedulerHandle {
  stop(): void;
  nextRun(): Date | null;
}

export function startScheduler(options: SchedulerOptions): SchedulerHandle {
  const pattern = options.dailyPlanCron ?? '0 8 * * *';
  const cronOptions = options.timezone ? { timezone: options.timezone } : {};
  const job = new Cron(pattern, cronOptions, () => {
    void options.onDailyPlan();
  });
  return {
    stop: () => job.stop(),
    nextRun: () => job.nextRun(),
  };
}
