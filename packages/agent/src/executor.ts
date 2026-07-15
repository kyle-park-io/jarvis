import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { issueBranchName } from './ref';
import { buildTaskPrompt } from './prompt';
import { auditLine } from './audit';

export interface ClaudeResult {
  isError: boolean;
  result: string;
  sessionId: string;
  numTurns: number;
}

/** Parse the `claude -p --output-format json` single result object. */
export function parseClaudeResult(stdout: string): ClaudeResult {
  const obj = JSON.parse(stdout) as {
    is_error?: unknown;
    result?: unknown;
    session_id?: unknown;
    num_turns?: unknown;
  };
  return {
    isError: obj.is_error === true,
    result: typeof obj.result === 'string' ? obj.result : '',
    sessionId: typeof obj.session_id === 'string' ? obj.session_id : '',
    numTurns: typeof obj.num_turns === 'number' ? obj.num_turns : 0,
  };
}

export type RunResult = { stdout: string; stderr: string; code: number };
export type RunFn = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<RunResult>;

/** Default runner: spawn a subprocess, capture stdout/stderr, resolve with the exit code. */
export const defaultRun: RunFn = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts?.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });

/** Run a command and throw a helpful error on a non-zero exit. */
async function must(run: RunFn, cmd: string, args: string[], opts?: { cwd?: string }): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    throw new Error(`\`${cmd} ${args.join(' ')}\` failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  }
  return r;
}

export interface ExecuteIssueParams {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  workRoot: string;
  auditPath: string;
  model?: string;
}

export interface ExecuteResult {
  branch: string;
  prUrl: string;
  changed: boolean;
  resultSummary: string;
  sessionId: string;
  worktree: string;
}

/**
 * Execute one issue in an isolated clone via the local `claude` CLI, then open a
 * draft PR. `run` is injectable so the orchestration is unit-testable without
 * spawning; production uses `defaultRun`. Never touches `main`; draft PR only.
 */
export async function executeIssue(params: ExecuteIssueParams, run: RunFn = defaultRun): Promise<ExecuteResult> {
  const { owner, repo, number } = params;
  const slug = `${owner}/${repo}`;
  const branch = issueBranchName(number);
  const worktree = path.join(params.workRoot, `${owner}-${repo}-${number}-${Date.now()}`);
  fs.mkdirSync(params.workRoot, { recursive: true });

  // Isolated shallow clone + branch (gh handles auth via the local gh login).
  await must(run, 'gh', ['repo', 'clone', slug, worktree, '--', '--depth', '1']);
  await must(run, 'git', ['-C', worktree, 'checkout', '-b', branch]);

  // Drive the local claude CLI headlessly in the worktree. --output-format json
  // yields one result object; bypassPermissions = non-interactive edits (safe in
  // this throwaway clone; the draft PR is the human gate).
  const prompt = buildTaskPrompt({ owner, repo, number, title: params.title, body: params.body });
  const claudeArgs = ['-p', prompt, '--permission-mode', 'bypassPermissions', '--output-format', 'json'];
  if (params.model !== undefined) claudeArgs.push('--model', params.model);
  const claudeRun = await must(run, 'claude', claudeArgs, { cwd: worktree });
  const claude = parseClaudeResult(claudeRun.stdout);
  if (claude.isError) {
    throw new Error(`Agent run failed: ${claude.result || '(no detail)'}`);
  }

  // Did the agent change anything?
  await must(run, 'git', ['-C', worktree, 'add', '-A']);
  const status = await must(run, 'git', ['-C', worktree, 'status', '--porcelain']);
  const changed = status.stdout.trim() !== '';

  let prUrl = '';
  if (changed) {
    await must(run, 'git', ['-C', worktree, 'commit', '-m', `jarvis: address #${number} — ${params.title}`]);
    await must(run, 'git', ['-C', worktree, 'push', '-u', 'origin', branch]);
    const pr = await must(run, 'gh', [
      'pr', 'create',
      '--repo', slug,
      '--draft',
      '--head', branch,
      '--title', `[jarvis] #${number}: ${params.title}`,
      '--body', `Automated draft by Jarvis for #${number}.\n\n${claude.result}`,
    ]);
    prUrl = pr.stdout.trim();
  }

  fs.appendFileSync(
    params.auditPath,
    auditLine({
      time: new Date().toISOString(),
      ref: `${slug}#${number}`,
      branch,
      prUrl,
      sessionId: claude.sessionId,
      numTurns: claude.numTurns,
      summary: changed ? claude.result : `no changes: ${claude.result}`,
    }),
  );

  return { branch, prUrl, changed, resultSummary: claude.result, sessionId: claude.sessionId, worktree };
}
