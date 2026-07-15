# GitHub Live Connector (remote MCP + PAT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull real GitHub issues into Jarvis via the official remote GitHub MCP server (PAT auth), mapping each configured repo's issues to a work stream, feeding the existing daily-plan pipeline.

**Architecture:** `packages/connectors` stays pure and dependency-injected — the GitHub connector aggregates several `repo→stream` entries over an injected `callTool(entry)` and maps each repo's issues (tagged with its repo for a stable id) into that stream. The app layer (`apps/cli`) builds the real `callTool` with `@modelcontextprotocol/sdk` over a `StreamableHTTPClientTransport` to `https://api.githubcopilot.com/mcp/`, authenticated by `GITHUB_PERSONAL_ACCESS_TOKEN`. `packages/store` gains an optional `github` config section. Registration is token+config gated (fail-safe: folder-only otherwise).

**Tech Stack:** TypeScript (ES2022, strict, `noUncheckedIndexedAccess`), pnpm workspaces, vitest, zod, `@modelcontextprotocol/sdk` (app layer only).

## Global Constraints

- **`packages/connectors` depends on `@jarvis/core` only.** It MUST NOT import `@modelcontextprotocol/sdk` — the real MCP client lives in `apps/cli`. The connector is generic over an injected `callTool`.
- **Empty-pull-throws contract:** a connector's `pull()` MUST reject on any failure (auth/network/parse). `[]` means genuinely-zero and triggers source-authoritative deletion of that source's tasks. The GitHub connector must reject if ANY configured repo's fetch fails.
- **Single `github` connector.** Reconciliation is source-authoritative per `source`, so ALL github tasks come from one connector that internally maps every repo→stream. Never register one connector per stream.
- **Real `list_issues` result shape** (from `github/github-mcp-server`, GraphQL-based): `{ repository: { issues: { nodes: [ { number:int, title:string, state:'OPEN'|'CLOSED' (UPPERCASE), url:string, ... } ] } } }`. There is NO `repository`/`html_url` field on each issue; state is UPPERCASE. The web URL field is `url`.
- **Task mapping:** `id = github:<owner/name>#<number>`; `source:'github'`; `status:'done'` iff `state` upper-cases to `'CLOSED'` else `'todo'`; `sourceRef = url` when present; `streamId` from the entry.
- **Remote endpoint** `https://api.githubcopilot.com/mcp/`; auth header `Authorization: Bearer <PAT>`; available to all GitHub users (no Copilot subscription for issue reads).
- **MVP: single page (`perPage: 100`) per repo, no cursor pagination.** Documented limitation; pagination is a follow-up.
- **Node ≥ 22. English. Conventional Commits. No `Co-Authored-By: Claude` / "Generated with" trailers.**
- **TDD:** failing test first. All connector/config/helper logic is pure or uses a fake injected `callTool` — no network, no real MCP server in unit tests. The live path is verified once by a manual smoke test (final section).

---

### Task 1: `github` config section in `@jarvis/store`

**Files:**
- Modify: `packages/store/src/config.ts`
- Test: `packages/store/src/config.test.ts`

**Interfaces:**
- Consumes: existing `ConfigSchema`, `loadConfig`, `JarvisConfig` (config.ts).
- Produces:
  - `GithubRepoConfig = { repo: string; stream: string; state?: 'open' | 'closed' | 'all' }`
  - `ConfigSchema` gains optional `github?: { repos: GithubRepoConfig[] }`.
  - `JarvisConfig` (inferred) now includes `github?`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/store/src/config.test.ts` (keep existing imports; add cases inside the existing top-level `describe`, or a new one):

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema, loadConfig } from './config';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @jarvis/store test -- config`
Expected: FAIL (`github` not on the schema; `cfg.github` is undefined / stripped or unknown-key error differs).

- [ ] **Step 3: Add the schema**

In `packages/store/src/config.ts`, add above `ConfigSchema`:

```ts
const GithubRepoSchema = z.object({
  repo: z.string(),
  stream: z.string(),
  state: z.enum(['open', 'closed', 'all']).optional(),
}).strict();

const GithubSchema = z.object({
  repos: z.array(GithubRepoSchema),
}).strict();

export type GithubRepoConfig = z.infer<typeof GithubRepoSchema>;
```

Then add one field to `ConfigSchema` (keep `.strict()`):

```ts
export const ConfigSchema = z.object({
  dailyCapacityHours: z.number().positive().default(8),
  deadlineHorizonDays: z.number().int().positive().default(5),
  fallingBehindPct: z.number().min(0).max(100).default(25),
  droppedBallDays: z.number().int().nonnegative().default(1),
  streams: z.array(StreamSchema).default([]),
  github: GithubSchema.optional(),
}).strict();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @jarvis/store test -- config`
Expected: PASS.

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @jarvis/store typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/store/src/config.ts packages/store/src/config.test.ts
git commit -m "feat(store): optional github repos->streams config section"
```

---

### Task 2: Rewrite the GitHub mapper to the real `list_issues` shape + aggregating connector

**Files:**
- Modify: `packages/connectors/src/github.ts`
- Modify: `packages/connectors/src/github.test.ts`
- Modify: `packages/connectors/src/index.ts`

**Interfaces:**
- Consumes: `Task` (`@jarvis/core`); `Connector` (types.ts); `parseMcpJson` (mcp.ts).
- Produces:
  - `interface GithubIssue { number: number; title: string; state: string; url?: string; repository?: string }`
  - `githubIssuesToTasks(issues: GithubIssue[], streamId: string): Task[]`
  - `extractIssues(parsed: unknown): GithubIssue[]` — digs `repository.issues.nodes`.
  - `interface GithubRepoEntry { repo: string; streamId: string; state?: string }`
  - `interface GithubConnectorOptions { entries: GithubRepoEntry[]; callTool: (entry: GithubRepoEntry) => Promise<unknown> }`
  - `githubConnector(options: GithubConnectorOptions): Connector` (id `'github'`, aggregates all entries).

- [ ] **Step 1: Replace the test file with tests for the real shape + aggregation**

Overwrite `packages/connectors/src/github.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { githubIssuesToTasks, extractIssues, githubConnector, type GithubRepoEntry } from './github';

/** Wrap a JSON value as a standard MCP text tool-result. */
function mcpResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** A list_issues payload with the given nodes. */
function listIssues(nodes: unknown[]) {
  return { repository: { issues: { nodes } } };
}

describe('githubIssuesToTasks', () => {
  it('maps issues to tasks with a repo-qualified id and open/closed status', () => {
    const tasks = githubIssuesToTasks(
      [
        { number: 12, title: 'Fix bug', state: 'OPEN', url: 'https://github.com/o/r/issues/12', repository: 'o/r' },
        { number: 7, title: 'Old', state: 'CLOSED', url: 'https://github.com/o/r/issues/7', repository: 'o/r' },
      ],
      'personal',
    );
    expect(tasks).toEqual([
      { id: 'github:o/r#12', streamId: 'personal', title: 'Fix bug', source: 'github', status: 'todo', spentHours: 0, sourceRef: 'https://github.com/o/r/issues/12' },
      { id: 'github:o/r#7', streamId: 'personal', title: 'Old', source: 'github', status: 'done', spentHours: 0, sourceRef: 'https://github.com/o/r/issues/7' },
    ]);
  });

  it('treats state case-insensitively and omits sourceRef when there is no url', () => {
    const [task] = githubIssuesToTasks([{ number: 1, title: 'x', state: 'closed', repository: 'o/r' }], 's');
    expect(task?.status).toBe('done');
    expect(task && 'sourceRef' in task).toBe(false);
  });

  it('falls back to a bare #number id when repository is absent', () => {
    const [task] = githubIssuesToTasks([{ number: 5, title: 'x', state: 'OPEN' }], 's');
    expect(task?.id).toBe('github:#5');
  });
});

describe('extractIssues', () => {
  it('digs nodes out of { repository: { issues: { nodes } } }', () => {
    const issues = extractIssues(listIssues([{ number: 1, title: 'a', state: 'OPEN', url: 'u' }]));
    expect(issues).toEqual([{ number: 1, title: 'a', state: 'OPEN', url: 'u' }]);
  });

  it('accepts a bare array as a fallback', () => {
    expect(extractIssues([{ number: 2, title: 'b', state: 'CLOSED' }])).toEqual([
      { number: 2, title: 'b', state: 'CLOSED' },
    ]);
  });

  it('throws on an unexpected shape', () => {
    expect(() => extractIssues({ nope: true })).toThrow(/Unexpected GitHub MCP result shape/);
  });

  it('throws on a malformed issue node (missing number/title/state)', () => {
    expect(() => extractIssues(listIssues([{ title: 'no number', state: 'OPEN' }]))).toThrow(/Malformed GitHub issue/);
  });
});

describe('githubConnector (aggregating)', () => {
  const entries: GithubRepoEntry[] = [
    { repo: 'o/a', streamId: 'work' },
    { repo: 'o/b', streamId: 'personal' },
  ];

  it('pulls every entry, tags ids with the entry repo, and concatenates', async () => {
    const byRepo: Record<string, unknown> = {
      'o/a': mcpResult(listIssues([{ number: 1, title: 'A1', state: 'OPEN', url: 'ua1' }])),
      'o/b': mcpResult(listIssues([{ number: 9, title: 'B9', state: 'OPEN', url: 'ub9' }])),
    };
    const connector = githubConnector({ entries, callTool: async (e) => byRepo[e.repo] });
    const tasks = await connector.pull();
    expect(connector.id).toBe('github');
    expect(tasks.map((t) => [t.id, t.streamId])).toEqual([
      ['github:o/a#1', 'work'],
      ['github:o/b#9', 'personal'],
    ]);
  });

  it('rejects the whole pull if any entry fails (never returns [])', async () => {
    const connector = githubConnector({
      entries,
      callTool: async (e) => {
        if (e.repo === 'o/b') throw new Error('network');
        return mcpResult(listIssues([]));
      },
    });
    await expect(connector.pull()).rejects.toThrow('network');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @jarvis/connectors test -- github`
Expected: FAIL (old `githubConnector` signature `{ streamId, callTool }`; old `extractIssues` expects `{ items }`; `GithubRepoEntry` not exported).

- [ ] **Step 3: Rewrite `github.ts`**

Overwrite `packages/connectors/src/github.ts`:

```ts
import type { Task } from '@jarvis/core';
import type { Connector } from './types';
import { parseMcpJson } from './mcp';

/** One issue as returned in a list_issues GraphQL `nodes` array. */
export interface GithubIssue {
  number: number;
  title: string;
  /** GraphQL IssueState — 'OPEN' | 'CLOSED' (uppercase); compared case-insensitively. */
  state: string;
  /** Web URL of the issue (GraphQL `url`). */
  url?: string;
  /** "owner/name" — the server does not include it per-issue; the connector injects it. */
  repository?: string;
}

export function githubIssuesToTasks(issues: GithubIssue[], streamId: string): Task[] {
  return issues.map((issue) => {
    const ref = issue.repository !== undefined ? `${issue.repository}#${issue.number}` : `#${issue.number}`;
    const task: Task = {
      id: `github:${ref}`,
      streamId,
      title: issue.title,
      source: 'github',
      status: issue.state.toUpperCase() === 'CLOSED' ? 'done' : 'todo',
      spentHours: 0,
    };
    if (issue.url !== undefined) task.sourceRef = issue.url;
    return task;
  });
}

function toGithubIssue(raw: unknown): GithubIssue {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`Malformed GitHub issue (not an object): ${JSON.stringify(raw)}`);
  }
  const issue = raw as { number?: unknown; title?: unknown; state?: unknown; url?: unknown };
  if (typeof issue.number !== 'number' || typeof issue.title !== 'string' || typeof issue.state !== 'string') {
    throw new Error(`Malformed GitHub issue (missing number/title/state): ${JSON.stringify(raw)}`);
  }
  const result: GithubIssue = { number: issue.number, title: issue.title, state: issue.state };
  if (typeof issue.url === 'string') result.url = issue.url;
  return result;
}

/**
 * Extract the issue nodes from a list_issues result. The GitHub MCP server
 * returns `{ repository: { issues: { nodes: [...] } } }` (GraphQL-shaped). A
 * bare array or `{ nodes }` / `{ issues: [...] }` is accepted as a fallback.
 */
export function extractIssues(parsed: unknown): GithubIssue[] {
  return findIssueNodes(parsed).map(toGithubIssue);
}

function findIssueNodes(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as { repository?: unknown; issues?: unknown; nodes?: unknown };
    if (obj.repository !== null && typeof obj.repository === 'object') {
      const repo = obj.repository as { issues?: unknown };
      if (repo.issues !== null && typeof repo.issues === 'object') {
        const issues = repo.issues as { nodes?: unknown };
        if (Array.isArray(issues.nodes)) return issues.nodes;
      }
    }
    if (Array.isArray(obj.nodes)) return obj.nodes;
    if (Array.isArray(obj.issues)) return obj.issues;
  }
  throw new Error('Unexpected GitHub MCP result shape (expected { repository: { issues: { nodes } } } or an array)');
}

export interface GithubRepoEntry {
  /** "owner/name" — disambiguates task ids and (in the app layer) selects the repo to query. */
  repo: string;
  /** The stream all issues from this repo belong to. */
  streamId: string;
  /** Issue-state filter passed to the app-layer callTool (default handled there). */
  state?: string;
}

export interface GithubConnectorOptions {
  entries: GithubRepoEntry[];
  /**
   * Calls the GitHub MCP server's `list_issues` for one entry and resolves the
   * raw MCP tool-result. Wired to a real MCP client in the app layer. MUST
   * reject on failure (auth/network) — never resolve empty on error.
   */
  callTool: (entry: GithubRepoEntry) => Promise<unknown>;
}

/**
 * One aggregating `github` Connector. Reconciliation is source-authoritative
 * per source, so ALL github tasks must come from a single connector: this loops
 * every configured repo→stream entry, tags each repo's issues with that repo
 * (for stable `github:owner/name#N` ids), maps them into the entry's stream, and
 * concatenates. Any entry's rejection rejects the whole pull (never returns []).
 */
export function githubConnector(options: GithubConnectorOptions): Connector {
  return {
    id: 'github',
    pull: async () => {
      const tasks: Task[] = [];
      for (const entry of options.entries) {
        const parsed = parseMcpJson(await options.callTool(entry));
        const issues = extractIssues(parsed).map((issue) => ({
          ...issue,
          repository: issue.repository ?? entry.repo,
        }));
        tasks.push(...githubIssuesToTasks(issues, entry.streamId));
      }
      return tasks;
    },
  };
}
```

- [ ] **Step 4: Update the barrel export**

In `packages/connectors/src/index.ts`, replace the github re-export line(s) so the exported names match the new API. Ensure this export is present (adjust the existing github line):

```ts
export {
  githubConnector,
  githubIssuesToTasks,
  extractIssues,
  type GithubIssue,
  type GithubRepoEntry,
  type GithubConnectorOptions,
} from './github';
```

- [ ] **Step 5: Run tests + typecheck to verify they pass**

Run: `pnpm --filter @jarvis/connectors test -- github`
Expected: PASS.
Run: `pnpm --filter @jarvis/connectors typecheck`
Expected: no errors (confirms no other file referenced the removed `streamId`/`GithubConnectorOptions.streamId`).

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/github.ts packages/connectors/src/github.test.ts packages/connectors/src/index.ts
git commit -m "feat(connectors): github connector aggregates repos->streams over real list_issues shape"
```

---

### Task 3: App-layer MCP client + CLI wiring + changelog

**Files:**
- Create: `apps/cli/src/github-mcp.ts`
- Test: `apps/cli/src/github-mcp.test.ts`
- Modify: `apps/cli/src/bin.ts`
- Modify: `apps/cli/package.json` (add `@modelcontextprotocol/sdk`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `githubConnector`, `type Connector`, `type GithubRepoEntry` (`@jarvis/connectors`); `loadConfig`, `resolveDataRoot`, `type JarvisConfig` (`@jarvis/store`); `Client`, `StreamableHTTPClientTransport` (`@modelcontextprotocol/sdk`).
- Produces:
  - `parseRepo(repo: string): { owner: string; repo: string }`
  - `buildListIssuesArgs(entry: GithubRepoEntry): Record<string, unknown>`
  - `createGithubConnector(params: { token: string | undefined; entries: GithubRepoEntry[]; url?: string }): { connector: Connector; close: () => Promise<void> } | undefined`

- [ ] **Step 1: Add the SDK dependency**

Run: `pnpm --filter @jarvis/cli add @modelcontextprotocol/sdk`
Expected: `apps/cli/package.json` gains `@modelcontextprotocol/sdk` under dependencies; lockfile updates.

- [ ] **Step 2: Write the failing tests for the pure helpers + gating**

Create `apps/cli/src/github-mcp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseRepo, buildListIssuesArgs, createGithubConnector } from './github-mcp';

describe('parseRepo', () => {
  it('splits "owner/name"', () => {
    expect(parseRepo('octo/hello')).toEqual({ owner: 'octo', repo: 'hello' });
  });

  it('throws on a malformed repo', () => {
    expect(() => parseRepo('nope')).toThrow(/expected "owner\/name"/);
    expect(() => parseRepo('a/b/c')).toThrow();
    expect(() => parseRepo('/b')).toThrow();
  });
});

describe('buildListIssuesArgs', () => {
  it('defaults state to open and caps the page size', () => {
    expect(buildListIssuesArgs({ repo: 'octo/hello', streamId: 's' })).toEqual({
      owner: 'octo',
      repo: 'hello',
      state: 'open',
      perPage: 100,
    });
  });

  it('passes an explicit state through', () => {
    expect(buildListIssuesArgs({ repo: 'octo/hello', streamId: 's', state: 'all' }).state).toBe('all');
  });
});

describe('createGithubConnector (gating)', () => {
  const entries = [{ repo: 'octo/hello', streamId: 'personal' }];

  it('returns undefined without a token', () => {
    expect(createGithubConnector({ token: undefined, entries })).toBeUndefined();
    expect(createGithubConnector({ token: '', entries })).toBeUndefined();
  });

  it('returns undefined with no entries', () => {
    expect(createGithubConnector({ token: 'ghp_x', entries: [] })).toBeUndefined();
  });

  it('returns a github connector when token + entries are present, and close() is safe before any connect', async () => {
    const gh = createGithubConnector({ token: 'ghp_x', entries });
    expect(gh?.connector.id).toBe('github');
    await expect(gh?.close()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @jarvis/cli test -- github-mcp`
Expected: FAIL (`./github-mcp` does not exist).

- [ ] **Step 4: Implement `github-mcp.ts`**

Create `apps/cli/src/github-mcp.ts`:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { githubConnector } from '@jarvis/connectors';
import type { Connector, GithubRepoEntry } from '@jarvis/connectors';

const DEFAULT_URL = 'https://api.githubcopilot.com/mcp/';

/** Split "owner/name" into parts; throws on a malformed value. */
export function parseRepo(repo: string): { owner: string; repo: string } {
  const parts = repo.split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    throw new Error(`Invalid GitHub repo "${repo}" (expected "owner/name")`);
  }
  return { owner: parts[0], repo: parts[1] };
}

/** Build the list_issues arguments for one entry (open issues, first page). */
export function buildListIssuesArgs(entry: GithubRepoEntry): Record<string, unknown> {
  const { owner, repo } = parseRepo(entry.repo);
  return { owner, repo, state: entry.state ?? 'open', perPage: 100 };
}

export interface GithubMcp {
  connector: Connector;
  close: () => Promise<void>;
}

/**
 * Build the live `github` connector backed by the remote GitHub MCP server.
 * Returns undefined when there is no token or no configured repos (fail-safe:
 * Jarvis runs folder-only). The MCP client connects lazily on the first pull,
 * so commands that never pull (help/log) touch no network.
 */
export function createGithubConnector(params: {
  token: string | undefined;
  entries: GithubRepoEntry[];
  url?: string;
}): GithubMcp | undefined {
  if (params.token === undefined || params.token === '' || params.entries.length === 0) {
    return undefined;
  }
  const url = params.url ?? DEFAULT_URL;
  const token = params.token;
  let client: Client | undefined;
  let connecting: Promise<Client> | undefined;

  const ensureClient = async (): Promise<Client> => {
    if (client) return client;
    if (!connecting) {
      connecting = (async () => {
        const c = new Client({ name: 'jarvis', version: '0.1.0' });
        const transport = new StreamableHTTPClientTransport(new URL(url), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        });
        await c.connect(transport);
        client = c;
        return c;
      })();
    }
    return connecting;
  };

  const connector = githubConnector({
    entries: params.entries,
    callTool: async (entry) => {
      const c = await ensureClient();
      return c.callTool({ name: 'list_issues', arguments: buildListIssuesArgs(entry) });
    },
  });

  return {
    connector,
    close: async () => {
      if (client) await client.close();
    },
  };
}
```

- [ ] **Step 5: Run tests + typecheck to verify they pass**

Run: `pnpm --filter @jarvis/cli test -- github-mcp`
Expected: PASS.
Run: `pnpm --filter @jarvis/cli typecheck`
Expected: no errors.

- [ ] **Step 6: Wire the connector into `bin.ts`**

Overwrite `apps/cli/src/bin.ts`:

```ts
#!/usr/bin/env node
import path from 'node:path';
import { toISODate } from '@jarvis/core';
import { resolveDataRoot, loadConfig } from '@jarvis/store';
import { folderConnector } from '@jarvis/connectors';
import type { Connector } from '@jarvis/connectors';
import { runCli } from './cli';
import { createGithubConnector } from './github-mcp';

const dataRoot = resolveDataRoot();

// Load secrets from `<dataRoot>/.env` if present (Node 22+ native, no
// dependency). Secrets live next to the data (config.yaml, tasks.db), outside
// this code repo, so the path is identical in dev and when installed globally.
// Optional — values can also come straight from the process environment.
// (JARVIS_HOME itself must be an exported env var, since it locates this file.)
try {
  process.loadEnvFile(path.join(dataRoot, '.env'));
} catch {
  // No .env in the data directory — that's fine.
}

async function main(): Promise<number> {
  const connectors: Connector[] = [folderConnector(path.join(dataRoot, 'streams'))];

  // Register the live GitHub connector only when config + token are present.
  // A missing/unreadable config must not break commands like `help`/`log`, so
  // load defensively here; `plan`/`alerts` re-load and surface real errors.
  let githubRepos: { repo: string; stream: string; state?: string }[] = [];
  try {
    githubRepos = loadConfig(dataRoot).github?.repos ?? [];
  } catch {
    githubRepos = [];
  }
  const github = createGithubConnector({
    token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
    entries: githubRepos.map((r) => ({ repo: r.repo, streamId: r.stream, state: r.state })),
  });
  if (github) connectors.push(github.connector);

  try {
    return await runCli(process.argv.slice(2), {
      dataRoot,
      connectors,
      today: toISODate(new Date()),
      out: (text) => process.stdout.write(text),
    });
  } finally {
    if (github) await github.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
```

- [ ] **Step 7: Verify the whole CLI package + folder-only path still works**

Run: `pnpm --filter @jarvis/cli test`
Expected: PASS (existing cli tests unaffected).
Run: `pnpm --filter @jarvis/cli typecheck`
Expected: no errors.
Run: `env -u GITHUB_PERSONAL_ACCESS_TOKEN JARVIS_HOME=$(mktemp -d) pnpm --filter @jarvis/cli exec tsx src/bin.ts help`
Expected: prints the help text with no network access and exit 0 (github gated off; no config.yaml present).

- [ ] **Step 8: Add the changelog entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add an `### Added` section (create it if absent) with:

```markdown
### Added

- Live GitHub connector via the official remote MCP server (PAT auth), mapping configured repos to streams (#13)
```

(Use the actual PR number when opening the PR.)

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/github-mcp.ts apps/cli/src/github-mcp.test.ts apps/cli/src/bin.ts apps/cli/package.json pnpm-lock.yaml CHANGELOG.md
git commit -m "feat(cli): wire live GitHub connector (remote MCP + PAT), gated on config + token"
```

---

## Final verification — live smoke test (manual, needs a real PAT)

Unit tests never touch the network. Before declaring done, run one real pull (orchestrator + Kyle's token). This is also where any residual shape assumptions get confirmed.

1. Put a fine-grained PAT (read access to the target repo's issues) in `<dataRoot>/.env` as `GITHUB_PERSONAL_ACCESS_TOKEN=...`.
2. Add a `github` section to `<dataRoot>/config.yaml`, e.g.:
   ```yaml
   github:
     repos:
       - repo: <owner>/<name>
         stream: <an existing stream id>
   ```
3. Run: `pnpm jarvis plan`
4. Confirm: the plan renders and real issues from `<owner>/<name>` appear as tasks under `<stream>`, with ids `github:<owner>/<name>#<n>` and open/closed status correct.

**If the live result differs from the source-derived assumptions, adjust and add a regression test:**
- **State value not accepted / wrong casing:** if the server rejects `state: 'open'` or returns unexpected results, try `'OPEN'`; update `buildListIssuesArgs`.
- **JSON lives in `structuredContent`, not a text block:** if `parseMcpJson` throws "no text content", extend `parseMcpJson` (mcp.ts) to prefer `result.structuredContent` when present, then fall back to the text block. Add a test in `mcp.test.ts`.
- **Different field names** (`url` vs something else, `state` nested): adjust `toGithubIssue`/`findIssueNodes` in `github.ts` and update the Task 2 tests to match the captured shape.

Then run the full suite and finish the branch:

Run: `pnpm test && pnpm typecheck`
Expected: all green.

---

## Self-review notes

- **Spec coverage:** config section (Task 1), single aggregating connector + real shape + id disambiguation + throw-on-any-failure (Task 2), app-layer MCP client + gating + lifecycle + changelog (Task 3), live verification (final section). DIP constraint honored — SDK only in `apps/cli`.
- **Type consistency:** `GithubRepoEntry { repo, streamId, state? }` is produced in Task 2 and consumed unchanged in Task 3; `buildListIssuesArgs` and the connector both read `entry.repo`/`entry.state`. Config uses `{ repo, stream, state? }` (YAML-friendly) and bin.ts maps `stream → streamId`.
- **Known limitation:** single page (100 issues/repo), no cursor pagination — documented in Global Constraints; revisit if a tracked repo exceeds it.
