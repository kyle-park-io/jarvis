import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema, loadConfig } from './config';

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

  it('rejects an unknown top-level field (strict)', () => {
    writeConfig(`
dailyCapcityHours: 6
streams: []
`);
    expect(() => loadConfig(dir)).toThrow();
  });
});

describe('github config section', () => {
  it('parses a github section with repos mapped to streams', () => {
    const cfg = ConfigSchema.parse({
      streams: [],
      github: { repos: [{ repo: 'octo/hello', stream: 'personal' }] },
    });
    expect(cfg.github).toEqual({ repos: [{ repo: 'octo/hello', stream: 'personal' }] });
  });

  it('accepts an optional per-repo state filter', () => {
    const cfg = ConfigSchema.parse({
      github: { repos: [{ repo: 'octo/hello', stream: 'personal', state: 'all' }] },
    });
    expect(cfg.github?.repos[0]?.state).toBe('all');
  });

  it('rejects an unknown state', () => {
    expect(() =>
      ConfigSchema.parse({ github: { repos: [{ repo: 'octo/hello', stream: 'personal', state: 'nope' }] } }),
    ).toThrow();
  });

  it('rejects unknown keys in a github repo entry (strict)', () => {
    expect(() =>
      ConfigSchema.parse({ github: { repos: [{ repo: 'octo/hello', stream: 'personal', extra: 1 }] } }),
    ).toThrow();
  });

  it('leaves github undefined when the section is absent', () => {
    const cfg = ConfigSchema.parse({ streams: [] });
    expect(cfg.github).toBeUndefined();
  });

  it('loads a github section from config.yaml', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cfg-'));
    fs.writeFileSync(
      path.join(dir, 'config.yaml'),
      'github:\n  repos:\n    - repo: octo/hello\n      stream: personal\n',
    );
    const cfg = loadConfig(dir);
    expect(cfg.github?.repos[0]).toEqual({ repo: 'octo/hello', stream: 'personal' });
  });
});
