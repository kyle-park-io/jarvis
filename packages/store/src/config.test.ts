import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config';

describe('loadConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-config-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(yaml: string): void {
    fs.writeFileSync(path.join(dir, 'config.yaml'), yaml, 'utf8');
  }

  it('parses streams and applies stream-level defaults', () => {
    writeConfig(`
dailyCapacityHours: 6
streams:
  - id: work
    name: Work
    weeklyBudgetHours: 20
`);
    const cfg = loadConfig(dir);
    expect(cfg.dailyCapacityHours).toBe(6);
    expect(cfg.streams).toEqual([
      { id: 'work', name: 'Work', weeklyBudgetHours: 20, weight: 0.5, workdays: [1, 2, 3, 4, 5], active: true },
    ]);
  });

  it('applies engine-param defaults when omitted', () => {
    writeConfig(`streams: []`);
    const cfg = loadConfig(dir);
    expect(cfg.dailyCapacityHours).toBe(8);
    expect(cfg.deadlineHorizonDays).toBe(5);
    expect(cfg.fallingBehindPct).toBe(25);
    expect(cfg.droppedBallDays).toBe(1);
  });

  it('throws on an invalid config', () => {
    writeConfig(`
streams:
  - id: bad
    name: Bad
    weeklyBudgetHours: "not a number"
`);
    expect(() => loadConfig(dir)).toThrow();
  });

  it('returns defaults for an empty config file', () => {
    writeConfig('');
    const cfg = loadConfig(dir);
    expect(cfg.streams).toEqual([]);
    expect(cfg.dailyCapacityHours).toBe(8);
    expect(cfg.droppedBallDays).toBe(1);
  });

  it('rejects an unknown field on a stream (strict)', () => {
    writeConfig(`
streams:
  - id: work
    name: Work
    weeklyBudgetHours: 20
    wieght: 0.5
`);
    expect(() => loadConfig(dir)).toThrow();
  });
});
