import { describe, it, expect } from 'vitest';
import { Cron } from 'croner';
import { VERSION } from './index';

describe('@jarvis/scheduler', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('can construct a croner job (dependency loads)', () => {
    const job = new Cron('0 8 * * *');
    expect(job.nextRun()).toBeInstanceOf(Date);
    job.stop();
  });
});
