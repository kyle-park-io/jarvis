# Connectors — Folder Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/connectors` — a common `Connector` contract plus the `folder` connector, which reads human-written task files from `<dataRoot>/streams/*.md` and returns `@jarvis/core` `Task[]`. This establishes the connector pattern that later MCP-backed connectors (calendar/gmail/github) will follow.

**Architecture:** A small package with a minimal `Connector` interface (`id` + `pull(): Promise<Task[]>`), a PURE parser (`parseStreamLine`/`parseStreamFile`) that turns markdown checklist lines into tasks, and a thin filesystem wrapper (`folder.ts`) that reads the stream files and delegates to the pure parser. Connectors depend on `@jarvis/core` only for the `Task` type; wiring connector output into the store is the scheduler's job (a later plan).

**Tech Stack:** TypeScript (ES2022, strict), pnpm workspaces, vitest.

## Global Constraints

- **`packages/connectors` depends on `@jarvis/core` only** (for the `Task` type). It performs filesystem reads (it is an adapter), but the parser (`parse.ts`) is PURE and testable without I/O.
- **Task file format** (`<dataRoot>/streams/<streamId>.md`): each line `- [ ] <title>` is a todo task, `- [x] <title>` (or `[X]`) is done. Optional inline metadata inside the title: `@YYYY-MM-DD` = deadline, `~Nh` (e.g. `~4h`, `~1.5h`) = estimate hours. Both tokens are stripped from the final title. `streamId` = filename without `.md`. Task `id` = `` `folder:${streamId}:${title}` `` (title after metadata is stripped). Lines that are not task checkboxes (headings, blanks, prose) are ignored.
- **No external dependencies, no auth, no secrets** — the folder connector reads local files only.
- **Node ≥ 22.** Language: English for code, comments, identifiers, commit messages. Conventional Commits.
- **No `Co-Authored-By: Claude` / no "Generated with" trailers** in commits.
- **TDD:** every logic function gets a failing test first. Filesystem tests use a per-test temp directory (`fs.mkdtempSync`) and clean it up.

---

### Task 1: Scaffold `@jarvis/connectors` package

**Files:**
- Create: `packages/connectors/package.json`
- Create: `packages/connectors/tsconfig.json`
- Create: `packages/connectors/vitest.config.ts`
- Create: `packages/connectors/src/index.ts`
- Test: `packages/connectors/src/index.test.ts`

**Interfaces:**
- Consumes: `@jarvis/core` (workspace).
- Produces: an installable `@jarvis/connectors` package where `pnpm --filter @jarvis/connectors test` runs vitest.

- [ ] **Step 1: Create the package files**

`packages/connectors/package.json`:
```json
{
  "name": "@jarvis/connectors",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@jarvis/core": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

`packages/connectors/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src"]
}
```

`packages/connectors/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
```

`packages/connectors/src/index.ts`:
```ts
export const VERSION = '0.0.0';
```

`packages/connectors/src/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { VERSION } from './index';

describe('@jarvis/connectors', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0');
  });
});
```

- [ ] **Step 2: Install and run tests**

Run: `pnpm install && pnpm --filter @jarvis/connectors test`
Expected: 1 test PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(connectors): scaffold @jarvis/connectors package"
```

---

### Task 2: Connector interface + line parser

**Files:**
- Create: `packages/connectors/src/types.ts`
- Create: `packages/connectors/src/parse.ts`
- Test: `packages/connectors/src/parse.test.ts`

**Interfaces:**
- Consumes: `Task` (`@jarvis/core`).
- Produces:
  - `types.ts`: `type ConnectorId = 'folder' | 'calendar' | 'gmail' | 'github'` and `interface Connector { id: ConnectorId; pull(): Promise<Task[]>; }`.
  - `parse.ts`: `parseStreamLine(streamId: string, line: string): Task | null` — parses one markdown checklist line into a `Task` (or `null` if the line is not a task).

- [ ] **Step 1: Write `types.ts` (interface only — consumed by later tasks)**

`packages/connectors/src/types.ts`:
```ts
import type { Task } from '@jarvis/core';

export type ConnectorId = 'folder' | 'calendar' | 'gmail' | 'github';

/**
 * A source of tasks. `folder` reads local files; later connectors
 * (calendar/gmail/github) will be backed by MCP servers — same contract.
 */
export interface Connector {
  id: ConnectorId;
  /** Read the current set of tasks from this source. */
  pull(): Promise<Task[]>;
}
```

- [ ] **Step 2: Write the failing parser tests**

`packages/connectors/src/parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseStreamLine } from './parse';

describe('parseStreamLine', () => {
  it('parses a todo with deadline and estimate, stripping the metadata from the title', () => {
    expect(parseStreamLine('trading', '- [ ] Review PR #482 @2026-07-20 ~4h')).toEqual({
      id: 'folder:trading:Review PR #482',
      streamId: 'trading',
      title: 'Review PR #482',
      source: 'folder',
      status: 'todo',
      spentHours: 0,
      deadline: '2026-07-20',
      estimateHours: 4,
    });
  });

  it('parses a done task (checked box), no metadata', () => {
    expect(parseStreamLine('trading', '- [x] Merge hotfix')).toEqual({
      id: 'folder:trading:Merge hotfix',
      streamId: 'trading',
      title: 'Merge hotfix',
      source: 'folder',
      status: 'done',
      spentHours: 0,
    });
  });

  it('treats an uppercase [X] as done', () => {
    expect(parseStreamLine('s', '- [X] done thing')?.status).toBe('done');
  });

  it('parses a fractional estimate', () => {
    expect(parseStreamLine('s', '- [ ] task ~1.5h')?.estimateHours).toBe(1.5);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(parseStreamLine('s', '   - [ ] Indented task  ')?.title).toBe('Indented task');
  });

  it('returns null for non-task lines', () => {
    expect(parseStreamLine('s', '# Heading')).toBeNull();
    expect(parseStreamLine('s', '')).toBeNull();
    expect(parseStreamLine('s', 'just prose')).toBeNull();
    expect(parseStreamLine('s', '- not a checkbox')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @jarvis/connectors test parse`
Expected: FAIL — cannot resolve `./parse`.

- [ ] **Step 4: Implement `parse.ts` (parseStreamLine)**

`packages/connectors/src/parse.ts`:
```ts
import type { Task } from '@jarvis/core';

const TASK_RE = /^- \[( |x|X)\]\s+(.*)$/;
const DEADLINE_RE = /@(\d{4}-\d{2}-\d{2})/;
const ESTIMATE_RE = /~(\d+(?:\.\d+)?)h\b/;

export function parseStreamLine(streamId: string, line: string): Task | null {
  const m = TASK_RE.exec(line.trim());
  if (!m) return null;

  const checked = m[1] === 'x' || m[1] === 'X';
  let title = m[2] ?? '';

  const deadline = DEADLINE_RE.exec(title)?.[1];
  const estStr = ESTIMATE_RE.exec(title)?.[1];
  const estimateHours = estStr !== undefined ? Number(estStr) : undefined;

  title = title.replace(DEADLINE_RE, '').replace(ESTIMATE_RE, '').replace(/\s+/g, ' ').trim();

  const task: Task = {
    id: `folder:${streamId}:${title}`,
    streamId,
    title,
    source: 'folder',
    status: checked ? 'done' : 'todo',
    spentHours: 0,
  };
  if (deadline !== undefined) task.deadline = deadline;
  if (estimateHours !== undefined) task.estimateHours = estimateHours;
  return task;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @jarvis/connectors test parse`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(connectors): add Connector interface and stream-line parser"
```

---

### Task 3: File parser (multi-line)

**Files:**
- Modify: `packages/connectors/src/parse.ts`
- Test: `packages/connectors/src/parse.test.ts` (add cases)

**Interfaces:**
- Consumes: `parseStreamLine`.
- Produces: `parseStreamFile(streamId: string, content: string): Task[]` — parses every task line in a file's content, ignoring non-task lines.

- [ ] **Step 1: Add the failing test**

Append to `packages/connectors/src/parse.test.ts`:
```ts
import { parseStreamFile } from './parse';

describe('parseStreamFile', () => {
  it('parses only the task lines, in order, ignoring headings and prose', () => {
    const content = ['# Trading', '', '- [ ] First @2026-07-20', 'some prose', '- [x] Second', ''].join('\n');
    const tasks = parseStreamFile('trading', content);
    expect(tasks.map((t) => t.title)).toEqual(['First', 'Second']);
    expect(tasks.map((t) => t.status)).toEqual(['todo', 'done']);
    expect(tasks[0]?.deadline).toBe('2026-07-20');
  });

  it('returns an empty array for a file with no tasks', () => {
    expect(parseStreamFile('s', '# Just a heading\n\nsome notes')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/connectors test parse`
Expected: FAIL — `parseStreamFile` is not exported.

- [ ] **Step 3: Implement `parseStreamFile` (append to `parse.ts`)**

Add to `packages/connectors/src/parse.ts`:
```ts
export function parseStreamFile(streamId: string, content: string): Task[] {
  const tasks: Task[] = [];
  for (const line of content.split('\n')) {
    const task = parseStreamLine(streamId, line);
    if (task) tasks.push(task);
  }
  return tasks;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/connectors test parse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(connectors): parse a whole stream file into tasks"
```

---

### Task 4: Folder connector (filesystem)

**Files:**
- Create: `packages/connectors/src/folder.ts`
- Test: `packages/connectors/src/folder.test.ts`

**Interfaces:**
- Consumes: `Task` (`@jarvis/core`), `Connector` (types.ts), `parseStreamFile` (parse.ts).
- Produces:
  - `pullFolderTasks(streamsDir: string): Task[]` — reads every `*.md` in `streamsDir` (sorted by filename for determinism), using the filename (minus `.md`) as `streamId`; returns `[]` if the directory does not exist.
  - `folderConnector(streamsDir: string): Connector` — a `Connector` with `id: 'folder'` whose `pull()` resolves to `pullFolderTasks(streamsDir)`.

- [ ] **Step 1: Write the failing tests**

`packages/connectors/src/folder.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pullFolderTasks, folderConnector } from './folder';

describe('pullFolderTasks', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-folder-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeStream(name: string, content: string): void {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }

  it('reads every .md file, using the filename as the stream id', () => {
    writeStream('trading.md', '- [ ] Review PR ~2h\n- [x] Merge');
    writeStream('personal.md', '- [ ] Write blog');
    writeStream('notes.txt', '- [ ] should be ignored (not .md)');

    const tasks = pullFolderTasks(dir);
    // sorted by filename: personal.md before trading.md
    expect(tasks.map((t) => t.id)).toEqual([
      'folder:personal:Write blog',
      'folder:trading:Review PR',
      'folder:trading:Merge',
    ]);
    expect(tasks.find((t) => t.title === 'Review PR')?.estimateHours).toBe(2);
    expect(tasks.find((t) => t.title === 'Merge')?.status).toBe('done');
  });

  it('returns an empty array when the directory does not exist', () => {
    expect(pullFolderTasks(path.join(dir, 'nope'))).toEqual([]);
  });
});

describe('folderConnector', () => {
  it('exposes id "folder" and pulls tasks asynchronously', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-folder-'));
    try {
      fs.writeFileSync(path.join(dir, 's.md'), '- [ ] Task', 'utf8');
      const connector = folderConnector(dir);
      expect(connector.id).toBe('folder');
      const tasks = await connector.pull();
      expect(tasks.map((t) => t.title)).toEqual(['Task']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/connectors test folder`
Expected: FAIL — cannot resolve `./folder`.

- [ ] **Step 3: Implement `folder.ts`**

`packages/connectors/src/folder.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@jarvis/core';
import type { Connector } from './types';
import { parseStreamFile } from './parse';

export function pullFolderTasks(streamsDir: string): Task[] {
  if (!fs.existsSync(streamsDir)) return [];
  const tasks: Task[] = [];
  for (const entry of fs.readdirSync(streamsDir).sort()) {
    if (!entry.endsWith('.md')) continue;
    const streamId = entry.slice(0, -3);
    const content = fs.readFileSync(path.join(streamsDir, entry), 'utf8');
    tasks.push(...parseStreamFile(streamId, content));
  }
  return tasks;
}

export function folderConnector(streamsDir: string): Connector {
  return {
    id: 'folder',
    pull: async () => pullFolderTasks(streamsDir),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/connectors test folder`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(connectors): add folder connector reading streams/*.md"
```

---

### Task 5: Public API + integration test

**Files:**
- Modify: `packages/connectors/src/index.ts`
- Test: `packages/connectors/src/integration.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `@jarvis/connectors` public exports — `type Connector`, `type ConnectorId`, `parseStreamLine`, `parseStreamFile`, `folderConnector`, `pullFolderTasks`, and `VERSION = '0.1.0'`.

- [ ] **Step 1: Replace `index.ts` with the public surface**

`packages/connectors/src/index.ts`:
```ts
export const VERSION = '0.1.0';

export type { Connector, ConnectorId } from './types';
export { parseStreamLine, parseStreamFile } from './parse';
export { folderConnector, pullFolderTasks } from './folder';
```

- [ ] **Step 2: Update the smoke test's version assertion**

In `packages/connectors/src/index.test.ts`, change:
```ts
    expect(VERSION).toBe('0.1.0');
```

- [ ] **Step 3: Write the integration test**

`packages/connectors/src/integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { folderConnector } from './index';

describe('folder connector integration', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-conn-int-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads real stream files into core Task objects', async () => {
    fs.writeFileSync(
      path.join(dir, 'trading.md'),
      ['# Trading', '', '- [ ] Review PR #482 @2026-07-20 ~4h', '- [x] Merge hotfix'].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'personal.md'), '- [ ] Write blog ~2h', 'utf8');

    const tasks = await folderConnector(dir).pull();
    expect(tasks).toHaveLength(3);

    const review = tasks.find((t) => t.title === 'Review PR #482');
    expect(review).toMatchObject({
      streamId: 'trading',
      source: 'folder',
      status: 'todo',
      deadline: '2026-07-20',
      estimateHours: 4,
    });
    expect(tasks.find((t) => t.title === 'Merge hotfix')?.status).toBe('done');
    expect(tasks.find((t) => t.title === 'Write blog')?.streamId).toBe('personal');
  });
});
```

- [ ] **Step 4: Run the full suite with coverage**

Run: `pnpm --filter @jarvis/connectors exec vitest run --coverage`
Expected: PASS, coverage for `src` (excluding tests + `index.ts`) at/near 100%.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @jarvis/connectors typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(connectors): finalize public API and add integration test"
```

---

## What comes next (future plans, not this one)

- **MCP-backed connectors** — `calendar`, `gmail`, `github` implemented against official MCP servers (auth handled by the MCP server config, not this repo). Each satisfies the same `Connector` contract (`id` + `pull(): Promise<Task[]>`).
- `packages/scheduler` — local `croner` jobs that call each connector's `pull()`, upsert results into `@jarvis/store`, run core `allocate()`, and write the plan.
- `apps/cli` — `jarvis today` / `jarvis plan` / `jarvis alerts`.
