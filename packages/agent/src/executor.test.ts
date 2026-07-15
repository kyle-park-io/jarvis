import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseClaudeResult, executeIssue, type RunFn } from './executor';

describe('parseClaudeResult', () => {
  it('reads is_error/result/session_id/num_turns from the CLI json', () => {
    const stdout = JSON.stringify({ type: 'result', is_error: false, result: 'done', session_id: 's1', num_turns: 3 });
    expect(parseClaudeResult(stdout)).toEqual({ isError: false, result: 'done', sessionId: 's1', numTurns: 3 });
  });

  it('flags an error result', () => {
    expect(parseClaudeResult(JSON.stringify({ is_error: true, result: 'boom' })).isError).toBe(true);
  });
});

describe('executeIssue', () => {
  function tmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-exec-'));
  }

  const baseParams = () => ({
    owner: 'o',
    repo: 'r',
    number: 3,
    title: 'Add hello()',
    body: 'Add a hello function.',
    workRoot: tmp(),
    auditPath: path.join(tmp(), 'audit.log'),
  });

  it('clones, branches, runs claude, commits, pushes, opens a draft PR, and audits', async () => {
    const calls: string[] = [];
    const run: RunFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'claude') {
        return { stdout: JSON.stringify({ is_error: false, result: 'Added hello()', session_id: 'sess', num_turns: 2 }), stderr: '', code: 0 };
      }
      if (cmd === 'git' && args.includes('status')) {
        return { stdout: ' M file.ts\n', stderr: '', code: 0 }; // there are changes
      }
      if (cmd === 'gh' && args[0] === 'pr') {
        return { stdout: 'https://github.com/o/r/pull/9\n', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    };

    const params = baseParams();
    const result = await executeIssue(params, run);

    expect(result.branch).toBe('jarvis/issue-3');
    expect(result.prUrl).toBe('https://github.com/o/r/pull/9');
    expect(result.changed).toBe(true);
    // command sequence
    const joined = calls.join('\n');
    expect(joined).toMatch(/gh repo clone o\/r/);
    expect(joined).toMatch(/git .*checkout -b jarvis\/issue-3/);
    expect(joined).toMatch(/^claude -p /m);
    expect(joined).toMatch(/git .*commit/);
    expect(joined).toMatch(/git .*push/);
    expect(joined).toMatch(/gh pr create .*--draft/);
    // audit written
    expect(fs.readFileSync(params.auditPath, 'utf8')).toContain('o/r#3');
  });

  it('does not commit/push/PR when the agent made no changes', async () => {
    const calls: string[] = [];
    const run: RunFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'claude') return { stdout: JSON.stringify({ is_error: false, result: 'no change needed', session_id: 's', num_turns: 1 }), stderr: '', code: 0 };
      if (cmd === 'git' && args.includes('status')) return { stdout: '', stderr: '', code: 0 }; // clean tree
      return { stdout: '', stderr: '', code: 0 };
    };
    const result = await executeIssue(baseParams(), run);
    expect(result.changed).toBe(false);
    expect(result.prUrl).toBe('');
    expect(calls.join('\n')).not.toMatch(/gh pr create/);
  });

  it('throws when claude returns an error result', async () => {
    const run: RunFn = async (cmd) =>
      cmd === 'claude'
        ? { stdout: JSON.stringify({ is_error: true, result: 'model failed' }), stderr: '', code: 0 }
        : { stdout: '', stderr: '', code: 0 };
    await expect(executeIssue(baseParams(), run)).rejects.toThrow(/model failed|agent/i);
  });
});
