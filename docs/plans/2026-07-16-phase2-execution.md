# Phase 2 Execution — `jarvis do <issue>` → draft PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `jarvis do <owner/repo#N>` — for one GitHub issue in an allowlisted repo, Jarvis clones the repo into an isolated worktree, drives the **local `claude` CLI** (Kyle's subscription — no API key) to make the change, and opens a **draft PR** (the approval gate). `main` is never touched; every run is audited.

**Architecture:** Pure allowlist check in `packages/core`; an optional `execution` config section in `packages/store`; a new `packages/agent` that orchestrates the execution (spawns `git`, `gh`, and the local `claude` CLI via an **injectable command runner**, so the orchestration is unit-testable without spawning); an `apps/cli` `do` command that gates on the allowlist and wires it. This is the thinnest vertical slice — one repo, one manually-triggered issue, draft-PR only.

**Tech Stack:** TypeScript (ES2022, strict, `noUncheckedIndexedAccess`), pnpm, vitest. Node built-ins only (`node:child_process`, `node:fs`, `node:path`) — **no new runtime dependency**, **no `ANTHROPIC_API_KEY`**.

## Decisions baked in (Kyle can redirect at plan review)

1. **Execution engine = the local `claude` CLI**, headless: `claude -p "<prompt>" --permission-mode bypassPermissions --output-format json`, run with `cwd` = the isolated worktree. It uses whatever the local `claude` is logged into (Kyle's Claude Code subscription) — **no API key, no billing config**. `bypassPermissions` gives fully non-interactive edits; that's acceptable because the work happens in a throwaway clone and the **draft PR is the human gate**.
2. **Issue title/body are fetched with `gh issue view`.** The MCP-only rule governs the *connector data path* (pulling tasks into the planner); the **execution subsystem is CLI-driven** (`git` + `gh` + `claude`). `gh` is GitHub's official CLI using the local `gh` login — not hand-rolled REST.

## Global Constraints

- **Fail-safe / allowlist:** execution runs **only** when the target repo is listed in `config.yaml` `execution.repos`. Not listed (or no `execution` section) → no-op with a clear message. `main` of anything is never changed; Jarvis only ever pushes a branch and opens a **draft** PR.
- **`packages/core` stays pure** (no I/O) — it gets only the pure `isExecutionAllowed`. **`packages/agent` owns all execution I/O** (spawning `git`/`gh`/`claude`, fs) behind an injectable runner; it depends on nothing (`node:` built-ins only).
- **Local `claude` CLI contract:** `--output-format json` prints one JSON object `{ type:"result", is_error, result:"<summary>", session_id, num_turns, ... }`. Treat `is_error === true` as a failure. The agent must NOT commit/push/PR — Jarvis does that deterministically.
- **Isolation:** each run clones to `<dataRoot>/work/<owner>-<repo>-<number>-<ts>/` on branch `jarvis/issue-<N>`.
- **Audit:** append one tab-separated line per run to `<dataRoot>/audit.log` (time, issue ref, branch, PR url, session id, turns, truncated summary). The file changes themselves live in the draft-PR diff.
- **Prerequisites (runtime, not code):** local `gh` logged in, local `claude` logged in, and the sandbox repo exists. These are the smoke-test's setup, not gates in code.
- **Node ≥ 22. English. Conventional Commits. No `Co-Authored-By: Claude` / "Generated with" trailers.**
- **TDD:** failing test first. The pure helpers (`parseIssueRef`, `buildTaskPrompt`, `auditLine`, `parseClaudeResult`, `isExecutionAllowed`) and the executor's orchestration (via an injected fake runner) are unit-tested. Only the real `spawn`-backed runner is smoke-only.

---

### Task 1: `isExecutionAllowed` in `@jarvis/core`

**Files:**
- Create: `packages/core/src/execution.ts`
- Test: `packages/core/src/execution.test.ts`
- Modify: `packages/core/src/index.ts` (re-export)

**Interfaces:**
- Produces: `isExecutionAllowed(repo: string, allowedRepos: readonly string[]): boolean`

- [ ] **Step 1: Write the failing test**

`packages/core/src/execution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isExecutionAllowed } from './execution';

describe('isExecutionAllowed', () => {
  it('is true only for an exact repo match in the allowlist', () => {
    const allow = ['kyle-park-io/jarvis-sandbox'];
    expect(isExecutionAllowed('kyle-park-io/jarvis-sandbox', allow)).toBe(true);
    expect(isExecutionAllowed('kyle-park-io/jarvis', allow)).toBe(false);
    expect(isExecutionAllowed('other/jarvis-sandbox', allow)).toBe(false);
  });

  it('is false for an empty allowlist', () => {
    expect(isExecutionAllowed('a/b', [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/core test -- execution`
Expected: FAIL (`./execution` does not exist).

- [ ] **Step 3: Implement**

`packages/core/src/execution.ts`:

```ts
/** Whether Jarvis may execute against `repo` ("owner/name"), i.e. it is on the allowlist. */
export function isExecutionAllowed(repo: string, allowedRepos: readonly string[]): boolean {
  return allowedRepos.includes(repo);
}
```

Add to `packages/core/src/index.ts`:

```ts
export { isExecutionAllowed } from './execution';
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @jarvis/core test -- execution` → PASS.
Run: `pnpm --filter @jarvis/core typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/execution.ts packages/core/src/execution.test.ts packages/core/src/index.ts
git commit -m "feat(core): isExecutionAllowed allowlist check"
```

---

### Task 2: `execution` config section in `@jarvis/store`

**Files:**
- Modify: `packages/store/src/config.ts`
- Test: `packages/store/src/config.test.ts`

**Interfaces:**
- Produces: `ConfigSchema` gains optional `execution?: { repos: string[] }`; `JarvisConfig` includes it.

- [ ] **Step 1: Write the failing tests**

Add to `packages/store/src/config.test.ts`:

```ts
describe('execution config section', () => {
  it('parses execution.repos', () => {
    const cfg = ConfigSchema.parse({ execution: { repos: ['kyle-park-io/jarvis-sandbox'] } });
    expect(cfg.execution?.repos).toEqual(['kyle-park-io/jarvis-sandbox']);
  });

  it('leaves execution undefined when absent', () => {
    expect(ConfigSchema.parse({ streams: [] }).execution).toBeUndefined();
  });

  it('rejects unknown keys in execution (strict)', () => {
    expect(() => ConfigSchema.parse({ execution: { repos: [], extra: 1 } })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @jarvis/store test -- config`
Expected: FAIL (`execution` stripped / unknown-key behavior differs).

- [ ] **Step 3: Add the schema**

In `packages/store/src/config.ts`, add above `ConfigSchema`:

```ts
const ExecutionSchema = z.object({
  repos: z.array(z.string()),
}).strict();
```

Add one field to `ConfigSchema` (keep `.strict()`):

```ts
  execution: ExecutionSchema.optional(),
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @jarvis/store test -- config` → PASS.
Run: `pnpm --filter @jarvis/store typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/store/src/config.ts packages/store/src/config.test.ts
git commit -m "feat(store): optional execution.repos allowlist config"
```

---

### Task 3: `@jarvis/agent` — the executor

A new package. Pure helpers are unit-tested; the orchestration is unit-tested via an **injected fake command runner**; only the real `spawn`-backed runner is smoke-only.

**Files:**
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/agent/src/index.ts`
- Create: `packages/agent/src/ref.ts` + `src/ref.test.ts`
- Create: `packages/agent/src/prompt.ts` + `src/prompt.test.ts`
- Create: `packages/agent/src/audit.ts` + `src/audit.test.ts`
- Create: `packages/agent/src/executor.ts` + `src/executor.test.ts`
- Modify: `pnpm-workspace.yaml` is already `packages/*` (no change needed — verify)

**Interfaces:**
- Produces:
  - `parseIssueRef(ref: string): { owner: string; repo: string; number: number }`
  - `issueBranchName(n: number): string`
  - `buildTaskPrompt(issue): string`
  - `parseClaudeResult(stdout: string): { isError: boolean; result: string; sessionId: string; numTurns: number }`
  - `auditLine(entry): string`
  - `type RunFn = (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<{ stdout: string; stderr: string; code: number }>`
  - `executeIssue(params: ExecuteIssueParams, run?: RunFn): Promise<ExecuteResult>`

- [ ] **Step 1: Scaffold the package**

Create `packages/agent/package.json` (mirror an existing package, e.g. `packages/connectors/package.json`):

```json
{
  "name": "@jarvis/agent",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Create `packages/agent/tsconfig.json` (copy `packages/connectors/tsconfig.json` verbatim — it extends the base and sets the same options).

- [ ] **Step 2: Write the failing tests for the pure helpers**

Create `packages/agent/src/ref.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseIssueRef, issueBranchName } from './ref';

describe('parseIssueRef', () => {
  it('parses owner/repo#number', () => {
    expect(parseIssueRef('kyle-park-io/jarvis-sandbox#3')).toEqual({
      owner: 'kyle-park-io',
      repo: 'jarvis-sandbox',
      number: 3,
    });
  });

  it('throws on a malformed ref', () => {
    expect(() => parseIssueRef('nope')).toThrow(/owner\/repo#number/);
    expect(() => parseIssueRef('a/b#x')).toThrow();
    expect(() => parseIssueRef('a/b')).toThrow();
  });
});

describe('issueBranchName', () => {
  it('names the branch jarvis/issue-<n>', () => {
    expect(issueBranchName(7)).toBe('jarvis/issue-7');
  });
});
```

Create `packages/agent/src/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTaskPrompt } from './prompt';

describe('buildTaskPrompt', () => {
  it('includes the issue and forbids git operations', () => {
    const p = buildTaskPrompt({ owner: 'o', repo: 'r', number: 3, title: 'Add hello()', body: 'Please add it.' });
    expect(p).toContain('o/r');
    expect(p).toContain('#3');
    expect(p).toContain('Add hello()');
    expect(p).toContain('Please add it.');
    expect(p).toMatch(/do not commit/i);
  });

  it('handles an empty body', () => {
    expect(buildTaskPrompt({ owner: 'o', repo: 'r', number: 1, title: 't', body: '' })).toContain('(no description)');
  });
});
```

Create `packages/agent/src/audit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { auditLine } from './audit';

describe('auditLine', () => {
  it('is a single tab-separated line ending in newline, with a truncated one-line summary', () => {
    const line = auditLine({
      time: '2026-07-16T00:00:00Z',
      ref: 'o/r#3',
      branch: 'jarvis/issue-3',
      prUrl: 'https://github.com/o/r/pull/9',
      sessionId: 'sess',
      numTurns: 4,
      summary: 'Added\na hello function',
    });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n')).toHaveLength(2); // content + trailing newline
    expect(line).toContain('\t');
    expect(line).toContain('o/r#3');
    expect(line).toContain('Added a hello function'); // newline collapsed
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `pnpm --filter @jarvis/agent test`
Expected: FAIL (modules don't exist).

- [ ] **Step 4: Implement the pure helpers**

`packages/agent/src/ref.ts`:

```ts
export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

/** Parse "owner/repo#number"; throws on a malformed ref. */
export function parseIssueRef(ref: string): IssueRef {
  const match = /^([^/]+)\/([^#/]+)#(\d+)$/.exec(ref.trim());
  if (match === null) {
    throw new Error(`Invalid issue reference "${ref}" (expected "owner/repo#number")`);
  }
  const [, owner, repo, num] = match;
  if (owner === undefined || repo === undefined || num === undefined) {
    throw new Error(`Invalid issue reference "${ref}" (expected "owner/repo#number")`);
  }
  return { owner, repo, number: Number(num) };
}

export function issueBranchName(n: number): string {
  return `jarvis/issue-${n}`;
}
```

`packages/agent/src/prompt.ts`:

```ts
export interface IssuePrompt {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
}

/** The task prompt handed to the local `claude` CLI, in the repo worktree. */
export function buildTaskPrompt(issue: IssuePrompt): string {
  return [
    `You are working in a clone of ${issue.owner}/${issue.repo} to address issue #${issue.number}.`,
    '',
    `Title: ${issue.title}`,
    '',
    'Body:',
    issue.body.trim() === '' ? '(no description)' : issue.body,
    '',
    'Make the smallest code change that addresses this issue. Follow the existing code style.',
    'Do NOT commit, push, or open a pull request — that is handled for you afterward.',
    'When done, briefly summarize what you changed.',
  ].join('\n');
}
```

`packages/agent/src/audit.ts`:

```ts
export interface AuditEntry {
  time: string;
  ref: string;
  branch: string;
  prUrl: string;
  sessionId: string;
  numTurns: number;
  summary: string;
}

/** One tab-separated audit line (trailing newline), summary collapsed + truncated. */
export function auditLine(e: AuditEntry): string {
  const summary = e.summary.replace(/\s+/g, ' ').trim().slice(0, 200);
  return [e.time, e.ref, e.branch, e.prUrl, `session=${e.sessionId}`, `turns=${e.numTurns}`, summary].join('\t') + '\n';
}
```

- [ ] **Step 5: Run the pure-helper tests + typecheck**

Run: `pnpm --filter @jarvis/agent test` → the ref/prompt/audit suites PASS (executor suite still absent).
Run: `pnpm --filter @jarvis/agent typecheck` → clean.

- [ ] **Step 6: Write the failing executor test (fake runner)**

Create `packages/agent/src/executor.test.ts`:

```ts
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
      if (cmd === 'git' && args[0] === 'status') {
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
      if (cmd === 'git' && args[0] === 'status') return { stdout: '', stderr: '', code: 0 }; // clean tree
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
```

- [ ] **Step 7: Run to verify fail**

Run: `pnpm --filter @jarvis/agent test -- executor`
Expected: FAIL (`./executor` does not exist).

- [ ] **Step 8: Implement the executor**

`packages/agent/src/executor.ts`:

```ts
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
```

`packages/agent/src/index.ts`:

```ts
export { parseIssueRef, issueBranchName, type IssueRef } from './ref';
export { buildTaskPrompt, type IssuePrompt } from './prompt';
export { auditLine, type AuditEntry } from './audit';
export {
  executeIssue,
  parseClaudeResult,
  defaultRun,
  type ExecuteIssueParams,
  type ExecuteResult,
  type RunFn,
  type RunResult,
  type ClaudeResult,
} from './executor';
```

- [ ] **Step 9: Run tests + typecheck**

Run: `pnpm --filter @jarvis/agent test` → all PASS.
Run: `pnpm --filter @jarvis/agent typecheck` → clean.
Run (workspace still resolves): `pnpm -w typecheck` → clean.

- [ ] **Step 10: Commit**

```bash
git add packages/agent
git commit -m "feat(agent): local-claude executor — clone, run, draft PR, audit (injectable runner)"
```

---

### Task 4: `jarvis do` command in `apps/cli`

**Files:**
- Modify: `apps/cli/src/cli.ts`
- Modify: `apps/cli/src/cli.test.ts`
- Modify: `apps/cli/src/bin.ts`
- Modify: `apps/cli/package.json` (add `@jarvis/agent` workspace dep)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `isExecutionAllowed` (`@jarvis/core`); `parseIssueRef`, `executeIssue` (`@jarvis/agent`); `loadConfig` (`@jarvis/store`).
- `CliDeps` gains `runDo?: (ref: string) => Promise<number>`.

- [ ] **Step 1: Add the workspace dependency**

In `apps/cli/package.json`, add `"@jarvis/agent": "workspace:*"` to `dependencies` (matching how `@jarvis/connectors` is listed). Run `pnpm install` to link it.

- [ ] **Step 2: Write the failing CLI test**

In `apps/cli/src/cli.test.ts`, add (matching the existing deps-building style):

```ts
it('routes `do <ref>` to runDo', async () => {
  let called = '';
  const deps = makeDeps({ runDo: async (ref) => { called = ref; return 0; } });
  const code = await runCli(['do', 'o/r#3'], deps);
  expect(called).toBe('o/r#3');
  expect(code).toBe(0);
});

it('`do` with no ref or no runDo prints usage and returns 1', async () => {
  const deps = makeDeps({});
  expect(await runCli(['do'], deps)).toBe(1);
});
```

> **Implementer note:** follow the existing `cli.test.ts` pattern for constructing `CliDeps` (as the `auth`/`committedHoursProvider` tests do). If there's no `makeDeps` helper, build `deps` inline in the same style the file already uses.

- [ ] **Step 3: Run to verify fail**

Run: `pnpm --filter @jarvis/cli test -- cli`
Expected: FAIL (`runDo` not on `CliDeps`; no `do` route).

- [ ] **Step 4: Add the `do` route in `cli.ts`**

Extend `CliDeps`:

```ts
  runDo?: (ref: string) => Promise<number>;
```

Add a `do` case to the command switch (before `help`):

```ts
    case 'do': {
      const ref = argv[1];
      if (ref === undefined || deps.runDo === undefined) {
        deps.out('Usage: jarvis do <owner/repo#number>\n');
        return 1;
      }
      return deps.runDo(ref);
    }
```

Add to the `HELP` text: `  jarvis do <owner/repo#N>  Draft a PR for an issue (allowlisted repos)`.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @jarvis/cli test -- cli` → PASS.
Run: `pnpm --filter @jarvis/cli typecheck` → clean.

- [ ] **Step 6: Wire `runDo` in `bin.ts`**

In `apps/cli/src/bin.ts`'s `main()`, add a `runDo` implementation passed into `runCli`. It gates on the allowlist, fetches the issue via `gh`, and calls the executor:

```ts
import { isExecutionAllowed } from '@jarvis/core';
import { parseIssueRef, executeIssue } from '@jarvis/agent';
import { spawnSync } from 'node:child_process';
// ...
    runDo: async (ref) => {
      let parsed;
      try {
        parsed = parseIssueRef(ref);
      } catch (error) {
        process.stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
      const slug = `${parsed.owner}/${parsed.repo}`;

      let allowed: string[] = [];
      try {
        allowed = loadConfig(dataRoot).execution?.repos ?? [];
      } catch {
        allowed = [];
      }
      if (!isExecutionAllowed(slug, allowed)) {
        process.stdout.write(`Execution not allowed for ${slug}. Add it to config.yaml under execution.repos.\n`);
        return 1;
      }

      // Fetch the issue via gh (execution subsystem is CLI-driven).
      const view = spawnSync('gh', ['issue', 'view', String(parsed.number), '--repo', slug, '--json', 'title,body'], {
        encoding: 'utf8',
      });
      if (view.status !== 0) {
        process.stdout.write(`Could not read ${slug}#${parsed.number}: ${(view.stderr || '').trim()}\n`);
        return 1;
      }
      const issue = JSON.parse(view.stdout) as { title: string; body: string | null };

      process.stdout.write(`Working on ${slug}#${parsed.number} (isolated clone + local claude)...\n`);
      const result = await executeIssue({
        owner: parsed.owner,
        repo: parsed.repo,
        number: parsed.number,
        title: issue.title,
        body: issue.body ?? '',
        workRoot: path.join(dataRoot, 'work'),
        auditPath: path.join(dataRoot, 'audit.log'),
      });
      if (!result.changed) {
        process.stdout.write(`Agent made no changes: ${result.resultSummary}\n`);
        return 0;
      }
      process.stdout.write(`Draft PR: ${result.prUrl}\n`);
      return 0;
    },
```

> **Implementer note:** merge this into the existing `runCli(...)` deps object in `main()` alongside `committedHoursProvider`/`runAuth`; keep those intact. `path` and `loadConfig` are already imported in `bin.ts`.

- [ ] **Step 7: Add the changelog entry**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, add:

```markdown
- `jarvis do <owner/repo#N>` (Phase 2, experimental): drafts a PR for an allowlisted-repo issue using the local Claude CLI in an isolated clone — never touches main, opens a draft PR as the approval gate, audited to `<dataRoot>/audit.log` (#18)
```

- [ ] **Step 8: Verify the whole package + gated-off path**

Run: `pnpm --filter @jarvis/cli test` → PASS.
Run: `pnpm -w typecheck` → clean.
Run: `env JARVIS_HOME=$(mktemp -d) pnpm --filter @jarvis/cli exec tsx src/bin.ts do foo/bar#1`
Expected: prints "Execution not allowed for foo/bar..." and exit 1 (no allowlist, no network, no clone).

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/cli.ts apps/cli/src/cli.test.ts apps/cli/src/bin.ts apps/cli/package.json pnpm-lock.yaml CHANGELOG.md
git commit -m "feat(cli): jarvis do — execute an allowlisted issue via local claude, draft PR"
```

---

## Final verification — live smoke test (manual, needs Kyle's setup)

No API key. Prerequisites: local `gh` logged in (`gh auth status`), local `claude` logged in, and a sandbox repo with a simple test issue.

1. Create `kyle-park-io/jarvis-sandbox` with a trivial issue, e.g. #1 "Add a `hello()` function to `index.js` that returns the string `hello`."
2. In `~/jarvis/config.yaml`:
   ```yaml
   execution:
     repos:
       - kyle-park-io/jarvis-sandbox
   ```
3. Run: `pnpm jarvis do kyle-park-io/jarvis-sandbox#1`
4. Confirm: an isolated clone appears under `~/jarvis/work/`, the local `claude` makes the change, a **draft PR** opens on the sandbox repo, and `~/jarvis/audit.log` gains a line. `main` of the sandbox is untouched.

**If the live result differs, adjust + add a regression test:**
- **`gh repo clone` flags:** if `-- --depth 1` isn't accepted, drop the depth or adjust the passthrough; update the executor + its test.
- **`claude` json shape / flags:** if `--permission-mode bypassPermissions` or the json keys differ on the installed version, adjust `parseClaudeResult` / the args and the test. (Verified against `claude` 2.1.210.)
- **PR url parsing:** `gh pr create` prints the URL on stdout; if it also prints noise, take the last non-empty line.

Then: `pnpm test && pnpm typecheck` (all green) and finish the branch.

---

## Self-review notes

- **Spec coverage:** allowlist (Task 1), config (Task 2), executor with injectable runner + all pure helpers (Task 3), CLI route + gated wiring + changelog (Task 4), live smoke (final). No `ANTHROPIC_API_KEY` anywhere — the engine is the local `claude` CLI.
- **Fail-safe gates:** repo not in `execution.repos` → refuse; bad/missing config → empty allowlist → refuse; a bad issue ref or `gh` read failure → clear message + exit 1; the agent making no changes → no PR, still audited. `main` is never touched; only a draft PR is opened.
- **Type consistency:** `ExecuteIssueParams`/`ExecuteResult`/`RunFn` produced in Task 3 are consumed unchanged in Task 4; `isExecutionAllowed(slug, repos)` uses the `"owner/repo"` slug that `parseIssueRef` reconstructs and that `execution.repos` stores.
- **Testability:** the injected `RunFn` makes the whole orchestration (command sequence, no-changes branch, error branch, audit write) unit-testable; only `defaultRun`'s real `spawn` is smoke-only.
- **Known limitations (documented, out of scope):** single issue, manual trigger, sandbox repo, `bypassPermissions`. Autonomous selection, multiple repos, per-tool permission policies, and worktree cleanup are later slices.
