import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDataRoot } from '@jarvis/store';
import { folderConnector } from '@jarvis/connectors';
import { runCli, type CliDeps } from './cli';

describe('runCli', () => {
  let dataRoot: string;
  let output: string;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cli-'));
    ensureDataRoot(dataRoot);
    fs.mkdirSync(path.join(dataRoot, 'streams'));
    fs.writeFileSync(
      path.join(dataRoot, 'config.yaml'),
      `dailyCapacityHours: 8
streams:
  - id: work
    name: Work
    weeklyBudgetHours: 20
`,
      'utf8',
    );
    fs.writeFileSync(path.join(dataRoot, 'streams', 'work.md'), '- [ ] Do work', 'utf8');
    output = '';
  });
  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  function deps(): CliDeps {
    return {
      dataRoot,
      connectors: [folderConnector(path.join(dataRoot, 'streams'))],
      today: '2026-07-14',
      out: (text) => {
        output += text;
      },
    };
  }

  it('today prints the plan for today', async () => {
    const code = await runCli(['today'], deps());
    expect(code).toBe(0);
    expect(output).toContain('# Plan — 2026-07-14');
    expect(output).toContain('## Work — 5h');
    expect(output).toContain('- [ ] Do work');
  });

  it('plan --date renders the plan for the given date', async () => {
    const code = await runCli(['plan', '--date=2026-07-14'], deps());
    expect(code).toBe(0);
    expect(output).toContain('# Plan — 2026-07-14');
  });

  it('plan without --date falls back to today', async () => {
    const code = await runCli(['plan'], deps());
    expect(code).toBe(0);
    expect(output).toContain('# Plan — 2026-07-14');
  });

  it('no command prints help', async () => {
    const code = await runCli([], deps());
    expect(code).toBe(0);
    expect(output).toContain('Usage:');
  });

  it('alerts prints the alerts (Work is behind pace on a Tuesday with no logs)', async () => {
    const code = await runCli(['alerts'], deps());
    expect(code).toBe(0);
    expect(output).toContain('falling_behind');
  });

  it('help prints usage', async () => {
    const code = await runCli(['help'], deps());
    expect(code).toBe(0);
    expect(output).toContain('Usage:');
  });

  it('an unknown command prints help and returns exit code 1', async () => {
    const code = await runCli(['bogus'], deps());
    expect(code).toBe(1);
    expect(output).toContain('Unknown command: bogus');
  });

  it('log records hours and confirms', async () => {
    const code = await runCli(['log', 'work', '3'], deps());
    expect(code).toBe(0);
    expect(output).toContain('Logged 3h to work on 2026-07-14.');
  });

  it('log without enough args returns 1 with usage', async () => {
    const code = await runCli(['log', 'work'], deps());
    expect(code).toBe(1);
    expect(output).toContain('Usage: jarvis log');
  });

  it('log rejects invalid hours', async () => {
    const code = await runCli(['log', 'work', 'abc'], deps());
    expect(code).toBe(1);
    expect(output).toContain('Invalid hours: abc');
  });

  it('logged hours reduce the stream target on the next plan (self-correction)', async () => {
    let before = '';
    await runCli(['today'], { ...deps(), out: (t) => (before += t) });
    expect(before).toContain('## Work — 5h');

    await runCli(['log', 'work', '8'], deps());

    let after = '';
    await runCli(['today'], { ...deps(), out: (t) => (after += t) });
    expect(after).toContain('## Work — 3h');
  });
});
