import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPlan, writePlan } from './plan-writer';
import { ensureDataRoot } from './paths';
import type { Allocation, Alert } from '@jarvis/core';

const allocation: Allocation = {
  date: '2026-07-14',
  capacityHours: 5,
  overcommitted: true,
  lines: [
    {
      streamId: 's1',
      targetHours: 2.5,
      tasks: [
        { id: 't1', streamId: 's1', title: 'Review PR', source: 'github', status: 'todo', spentHours: 0 },
      ],
    },
  ],
};
const alerts: Alert[] = [
  { type: 'falling_behind', severity: 'warn', streamId: 's1', message: 'Work is behind pace.' },
];

describe('renderPlan', () => {
  it('renders date, capacity, streams with tasks, and alerts', () => {
    const md = renderPlan(allocation, alerts, { s1: 'Work' });
    expect(md).toContain('# Plan — 2026-07-14');
    expect(md).toContain('Capacity: 5h (overcommitted)');
    expect(md).toContain('## Work — 2.5h');
    expect(md).toContain('- [ ] Review PR');
    expect(md).toContain('## Alerts');
    expect(md).toContain('- **warn** (falling_behind): Work is behind pace.');
  });

  it('falls back to the stream id when no name is given, and omits the Alerts section when empty', () => {
    const md = renderPlan(allocation, [], {});
    expect(md).toContain('## s1 — 2.5h');
    expect(md).not.toContain('## Alerts');
  });
});

describe('writePlan', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-plan-'));
    ensureDataRoot(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes plans/<date>.md and returns its path', () => {
    const file = writePlan(dir, allocation, alerts, { s1: 'Work' });
    expect(file).toBe(path.join(dir, 'plans', '2026-07-14.md'));
    expect(fs.readFileSync(file, 'utf8')).toContain('## Work — 2.5h');
  });

  it('creates the plans directory if it does not exist yet', () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-plan-fresh-'));
    try {
      const file = writePlan(fresh, allocation, [], {});
      expect(fs.existsSync(file)).toBe(true);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });
});
