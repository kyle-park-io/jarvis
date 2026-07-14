# MCP Connector Framework + GitHub Mapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MCP-backed connector framework to `packages/connectors`: a generic `mcpConnector` (a `Connector` over an injected `callTool` + a pure mapper), a pure MCP-tool-result parser, and a concrete GitHub mapper/connector. This lets Jarvis pull tasks from MCP servers (starting with GitHub) using the same `Connector` contract as the folder connector.

**Architecture:** Everything testable is pure or dependency-injected. `mcpConnector({ id, callTool, map })` calls the injected `callTool()` and runs the raw result through the injected pure `map`. `parseMcpJson` extracts+parses the standard MCP tool-result envelope (`{ content: [{ type: 'text', text }], isError }`). `githubIssuesToTasks`/`extractIssues` are pure mappers. The concrete `githubConnector` composes them. The REAL `callTool` (an actual MCP client via `@modelcontextprotocol/sdk` connecting to a live server) is app-layer wiring — documented here, not built or unit-tested in this plan (it needs real credentials/servers).

**Tech Stack:** TypeScript (ES2022, strict), pnpm workspaces, vitest. No new runtime dependencies.

## Global Constraints

- **`packages/connectors` still depends on `@jarvis/core` only.** The MCP framework is generic over an injected `callTool: () => Promise<unknown>`; it does NOT import `@modelcontextprotocol/sdk` (that lives in the app layer that constructs a real `callTool`).
- **Empty-pull-throws contract holds automatically:** `mcpConnector.pull()` is `map(await callTool())`, so if `callTool` rejects (auth/network failure) the rejection propagates — it never returns `[]` on failure.
- **MCP tool-result envelope:** a standard MCP `CallToolResult` is `{ content: Array<{ type: string; text?: string }>, isError?: boolean }`. `parseMcpJson` throws on `isError`, throws if there is no text block, else `JSON.parse`es the first text block.
- **GitHub task mapping:** `id = github:<repository>#<number>` (or `github:#<number>` if no repo); `source: 'github'`; `status: 'done'` iff `state === 'closed'` else `'todo'`; `sourceRef = html_url` when present; `streamId` is supplied by the connector's config (a GitHub connector targets one stream).
- **Node ≥ 22.** Language: English. Conventional Commits. No `Co-Authored-By: Claude` / "Generated with" trailers.
- **TDD:** failing test first. All logic is pure or uses a fake injected `callTool` — no network, no real MCP server.

---

### Task 1: MCP tool-result parser + generic `mcpConnector`

**Files:**
- Create: `packages/connectors/src/mcp.ts`
- Test: `packages/connectors/src/mcp.test.ts`

**Interfaces:**
- Consumes: `Task` (`@jarvis/core`); `Connector`, `ConnectorId` (types.ts).
- Produces:
  - `parseMcpJson(raw: unknown): unknown` — extracts + JSON-parses the first text block of an MCP tool result; throws on `isError` or missing text.
  - `interface McpConnectorOptions { id: ConnectorId; callTool: () => Promise<unknown>; map: (raw: unknown) => Task[]; }`
  - `mcpConnector(options: McpConnectorOptions): Connector`

- [ ] **Step 1: Write the failing tests**

`packages/connectors/src/mcp.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseMcpJson, mcpConnector } from './mcp';
import type { Task } from '@jarvis/core';

describe('parseMcpJson', () => {
  it('parses the JSON in the first text content block', () => {
    const raw = { content: [{ type: 'text', text: '[{"n":1}]' }] };
    expect(parseMcpJson(raw)).toEqual([{ n: 1 }]);
  });

  it('throws when the result is flagged as an error', () => {
    const raw = { isError: true, content: [{ type: 'text', text: 'boom' }] };
    expect(() => parseMcpJson(raw)).toThrow();
  });

  it('throws when there is no text content', () => {
    expect(() => parseMcpJson({ content: [{ type: 'image' }] })).toThrow();
    expect(() => parseMcpJson({})).toThrow();
  });
});

describe('mcpConnector', () => {
  it('maps the raw result of callTool into tasks', async () => {
    const task: Task = { id: 't', streamId: 's', title: 'T', source: 'github', status: 'todo', spentHours: 0 };
    const connector = mcpConnector({
      id: 'github',
      callTool: async () => ({ raw: true }),
      map: (raw) => {
        expect(raw).toEqual({ raw: true });
        return [task];
      },
    });
    expect(connector.id).toBe('github');
    expect(await connector.pull()).toEqual([task]);
  });

  it('propagates a callTool rejection (never returns [] on failure)', async () => {
    const connector = mcpConnector({
      id: 'github',
      callTool: async () => {
        throw new Error('auth failed');
      },
      map: () => [],
    });
    await expect(connector.pull()).rejects.toThrow('auth failed');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/connectors test mcp`
Expected: FAIL — cannot resolve `./mcp`.

- [ ] **Step 3: Implement `mcp.ts`**

`packages/connectors/src/mcp.ts`:
```ts
import type { Task } from '@jarvis/core';
import type { Connector, ConnectorId } from './types';

interface McpToolResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

/**
 * Extract and JSON-parse the payload of a standard MCP tool result
 * (`{ content: [{ type: 'text', text }], isError }`). Throws on an error
 * result or when there is no text content.
 */
export function parseMcpJson(raw: unknown): unknown {
  const result = raw as McpToolResult;
  if (result.isError === true) {
    throw new Error('MCP tool returned an error result');
  }
  const text = result.content?.find((block) => block.type === 'text')?.text;
  if (text === undefined) {
    throw new Error('MCP tool result has no text content');
  }
  return JSON.parse(text);
}

export interface McpConnectorOptions {
  id: ConnectorId;
  /** Perform the MCP tool call and resolve its raw result. MUST reject on failure. */
  callTool: () => Promise<unknown>;
  /** Pure mapper from the raw tool result to tasks. */
  map: (raw: unknown) => Task[];
}

/**
 * A Connector backed by an MCP tool call. `callTool` is injected (wired to a
 * real MCP client in the app layer); `map` is a pure transform. Because
 * `pull` awaits `callTool` directly, a rejection propagates — it never
 * returns [] on failure, satisfying the connector failure contract.
 */
export function mcpConnector(options: McpConnectorOptions): Connector {
  return {
    id: options.id,
    pull: async () => options.map(await options.callTool()),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/connectors test mcp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(connectors): add MCP tool-result parser and generic mcpConnector"
```

---

### Task 2: GitHub mapper + connector

**Files:**
- Create: `packages/connectors/src/github.ts`
- Test: `packages/connectors/src/github.test.ts`

**Interfaces:**
- Consumes: `Task` (`@jarvis/core`); `Connector` (types.ts); `mcpConnector`, `parseMcpJson` (mcp.ts).
- Produces:
  - `interface GithubIssue { number: number; title: string; state: string; repository?: string; html_url?: string; }`
  - `githubIssuesToTasks(issues: GithubIssue[], streamId: string): Task[]` — pure mapper.
  - `extractIssues(parsed: unknown): GithubIssue[]` — accepts an array, or `{ items }` / `{ issues }`; throws otherwise.
  - `interface GithubConnectorOptions { streamId: string; callTool: () => Promise<unknown>; }`
  - `githubConnector(options: GithubConnectorOptions): Connector` — composes `mcpConnector` + `parseMcpJson` + `extractIssues` + `githubIssuesToTasks`.

- [ ] **Step 1: Write the failing tests**

`packages/connectors/src/github.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { githubIssuesToTasks, extractIssues, githubConnector, type GithubIssue } from './github';

describe('githubIssuesToTasks', () => {
  it('maps an open issue with a repo and url', () => {
    const issues: GithubIssue[] = [
      { number: 42, title: 'Fix bug', state: 'open', repository: 'kyle/repo', html_url: 'https://x/42' },
    ];
    expect(githubIssuesToTasks(issues, 'mantle')).toEqual([
      {
        id: 'github:kyle/repo#42',
        streamId: 'mantle',
        title: 'Fix bug',
        source: 'github',
        status: 'todo',
        spentHours: 0,
        sourceRef: 'https://x/42',
      },
    ]);
  });

  it('maps a closed issue with no repo/url to a done task without sourceRef', () => {
    const tasks = githubIssuesToTasks([{ number: 7, title: 'Old', state: 'closed' }], 's');
    expect(tasks[0]).toEqual({
      id: 'github:#7',
      streamId: 's',
      title: 'Old',
      source: 'github',
      status: 'done',
      spentHours: 0,
    });
  });
});

describe('extractIssues', () => {
  it('accepts a bare array', () => {
    expect(extractIssues([{ number: 1 }])).toEqual([{ number: 1 }]);
  });
  it('accepts { items } and { issues } wrappers', () => {
    expect(extractIssues({ items: [{ number: 2 }] })).toEqual([{ number: 2 }]);
    expect(extractIssues({ issues: [{ number: 3 }] })).toEqual([{ number: 3 }]);
  });
  it('throws on an unexpected shape', () => {
    expect(() => extractIssues(null)).toThrow();
    expect(() => extractIssues('nope')).toThrow();
    expect(() => extractIssues({})).toThrow();
  });
});

describe('githubConnector', () => {
  it('pulls issues from an MCP-shaped tool result into tasks', async () => {
    const toolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify([{ number: 5, title: 'Review PR', state: 'open', repository: 'a/b' }]),
        },
      ],
    };
    const connector = githubConnector({ streamId: 'mantle', callTool: async () => toolResult });
    expect(connector.id).toBe('github');
    const tasks = await connector.pull();
    expect(tasks).toEqual([
      {
        id: 'github:a/b#5',
        streamId: 'mantle',
        title: 'Review PR',
        source: 'github',
        status: 'todo',
        spentHours: 0,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/connectors test github`
Expected: FAIL — cannot resolve `./github`.

- [ ] **Step 3: Implement `github.ts`**

`packages/connectors/src/github.ts`:
```ts
import type { Task } from '@jarvis/core';
import type { Connector } from './types';
import { mcpConnector, parseMcpJson } from './mcp';

export interface GithubIssue {
  number: number;
  title: string;
  state: string;
  repository?: string;
  html_url?: string;
}

export function githubIssuesToTasks(issues: GithubIssue[], streamId: string): Task[] {
  return issues.map((issue) => {
    const ref = issue.repository !== undefined ? `${issue.repository}#${issue.number}` : `#${issue.number}`;
    const task: Task = {
      id: `github:${ref}`,
      streamId,
      title: issue.title,
      source: 'github',
      status: issue.state === 'closed' ? 'done' : 'todo',
      spentHours: 0,
    };
    if (issue.html_url !== undefined) task.sourceRef = issue.html_url;
    return task;
  });
}

export function extractIssues(parsed: unknown): GithubIssue[] {
  if (Array.isArray(parsed)) return parsed as GithubIssue[];
  if (parsed !== null && typeof parsed === 'object') {
    const wrapped = parsed as { items?: unknown; issues?: unknown };
    if (Array.isArray(wrapped.items)) return wrapped.items as GithubIssue[];
    if (Array.isArray(wrapped.issues)) return wrapped.issues as GithubIssue[];
  }
  throw new Error('Unexpected GitHub MCP result shape (expected an array, or { items } / { issues })');
}

export interface GithubConnectorOptions {
  /** The stream all pulled GitHub tasks belong to. */
  streamId: string;
  /**
   * Calls the GitHub MCP server's issue-listing tool and resolves its raw
   * result. In the app layer this is wired to a real MCP client, e.g.
   * (pseudo): a `@modelcontextprotocol/sdk` Client over a StdioClient
   * transport spawning the GitHub MCP server with a GITHUB_TOKEN, calling
   * `client.callTool({ name: 'list_issues', arguments: {...} })`.
   */
  callTool: () => Promise<unknown>;
}

export function githubConnector(options: GithubConnectorOptions): Connector {
  return mcpConnector({
    id: 'github',
    callTool: options.callTool,
    map: (raw) => githubIssuesToTasks(extractIssues(parseMcpJson(raw)), options.streamId),
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/connectors test github`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(connectors): add GitHub MCP mapper and connector"
```

---

### Task 3: Public API + coverage

**Files:**
- Modify: `packages/connectors/src/index.ts`
- Test: `packages/connectors/src/mcp.test.ts` and `packages/connectors/src/github.test.ts` (only if coverage gaps remain — see Step 2)

**Interfaces:**
- Produces: `@jarvis/connectors` public exports gain `mcpConnector`, `parseMcpJson`, `type McpConnectorOptions`, `githubConnector`, `githubIssuesToTasks`, `extractIssues`, `type GithubIssue`, `type GithubConnectorOptions`.

- [ ] **Step 1: Add the new exports to `index.ts`**

In `packages/connectors/src/index.ts`, add (keeping the existing exports):
```ts
export { parseMcpJson, mcpConnector, type McpConnectorOptions } from './mcp';
export {
  githubConnector,
  githubIssuesToTasks,
  extractIssues,
  type GithubIssue,
  type GithubConnectorOptions,
} from './github';
```

- [ ] **Step 2: Run the full suite with coverage**

Run: `pnpm --filter @jarvis/connectors exec vitest run --coverage`
Expected: PASS. Confirm `mcp.ts` and `github.ts` are at/near 100% (statements/functions/lines 100%; the only acceptable branch gaps are defensive type-narrowing). If a real logic branch is uncovered, add a focused test for it in the matching test file and re-run.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @jarvis/connectors typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(connectors): export MCP + GitHub connector public API"
```

---

## What comes next (future plans, not this one)

- **Live MCP client wiring** — an app-layer helper that builds a real `callTool` with `@modelcontextprotocol/sdk` (Client + StdioClientTransport) spawning the GitHub MCP server with a `GITHUB_TOKEN`, and adding a `github` connector to the CLI's `bin.ts` connector list. Then a repo/label → stream mapping (which GitHub items belong to which stream).
- **Calendar / Gmail MCP connectors** — same framework, plus OAuth-backed MCP servers; the calendar connector also supplies `committedHoursToday`.
