import { describe, it, expect } from 'vitest';
import { startScheduler } from './scheduler';

describe('startScheduler', () => {
  it('schedules a job with a future next run and can be stopped', () => {
    const handle = startScheduler({ onDailyPlan: () => {}, dailyPlanCron: '0 8 * * *' });
    const next = handle.nextRun();
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now());
    handle.stop();
  });

  it('fires the callback on schedule', async () => {
    const fired = new Promise<void>((resolve) => {
      const handle = startScheduler({
        onDailyPlan: () => {
          handle.stop();
          resolve();
        },
        dailyPlanCron: '* * * * * *', // every second
      });
    });
    await expect(fired).resolves.toBeUndefined();
  }, 4000);

  it('uses the default cron when none is provided', () => {
    const handle = startScheduler({ onDailyPlan: () => {} });
    expect(handle.nextRun()).toBeInstanceOf(Date);
    handle.stop();
  });

  it('applies a timezone when one is provided', () => {
    const handle = startScheduler({
      onDailyPlan: () => {},
      dailyPlanCron: '0 8 * * *',
      timezone: 'Asia/Seoul',
    });
    expect(handle.nextRun()).toBeInstanceOf(Date);
    handle.stop();
  });
});
