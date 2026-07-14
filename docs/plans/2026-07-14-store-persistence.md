# Store Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/store` — the I/O boundary that persists Jarvis config, tasks, and time logs under `~/jarvis`, and renders a human-readable daily plan to `plans/YYYY-MM-DD.md`. It keeps `@jarvis/core` pure by owning all filesystem and database access.

**Architecture:** A small package with focused modules — path resolution, YAML config (zod-validated), a SQLite database (better-sqlite3) with a thin repository, and a markdown plan writer. Consumers (scheduler, CLI) will call these; `@jarvis/core` never does. `store` depends on `@jarvis/core` only for its domain types.

**Tech Stack:** TypeScript (ES2022, strict), pnpm workspaces, vitest, better-sqlite3, zod, yaml.

## Global Constraints

- **`packages/store` is the I/O boundary** — it may touch the filesystem and SQLite. It depends on `@jarvis/core` ONLY for types (`Task`, `TimeLog`, `WorkStream`, `Allocation`, `Alert`); it never reimplements engine logic.
- **All dates are ISO `YYYY-MM-DD`.** Week helpers come from `@jarvis/core` (`weekStart`, `parseISODate`, `toISODate`) — do not reimplement date math.
- **Data root resolution order:** explicit `override` arg → `process.env.JARVIS_HOME` → `~/jarvis` (`path.join(os.homedir(), 'jarvis')`).
- **Config default `droppedBallDays: 1`** (fires on the 2nd waiting day, given core's strict `>` comparison). Other engine-param defaults: `dailyCapacityHours: 8`, `deadlineHorizonDays: 5`, `fallingBehindPct: 25`.
- **Node ≥ 22** (matches the repo's pnpm 11 toolchain and CI).
- **Language: English** for code, comments, identifiers, commit messages. Conventional Commits.
- **No `Co-Authored-By: Claude` / no "Generated with" trailers** in commits.
- **TDD:** every logic function gets a failing test first. Tests that touch the filesystem use a per-test temp directory (`fs.mkdtempSync`) and clean it up; database unit tests use an in-memory database (`:memory:`).

---

### Task 1: Scaffold `@jarvis/store` package (with better-sqlite3 native build)

**Files:**
- Create: `packages/store/package.json`
- Create: `packages/store/tsconfig.json`
- Create: `packages/store/vitest.config.ts`
- Create: `packages/store/src/index.ts`
- Test: `packages/store/src/smoke.test.ts`

**Interfaces:**
- Consumes: `@jarvis/core` (workspace).
- Produces: an installable `@jarvis/store` package where `pnpm --filter @jarvis/store test` runs vitest, and `better-sqlite3` is built and loadable.

- [ ] **Step 1: Create the package files**

`packages/store/package.json`:
```json
{
  "name": "@jarvis/store",
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

`packages/store/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src"]
}
```

`packages/store/vitest.config.ts`:
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

`packages/store/src/index.ts`:
```ts
export const VERSION = '0.0.0';
```

- [ ] **Step 2: Add runtime + type dependencies**

Run:
```bash
pnpm --filter @jarvis/store add better-sqlite3 zod yaml
pnpm --filter @jarvis/store add -D @types/better-sqlite3
```
This updates `packages/store/package.json` and the lockfile with current versions.

- [ ] **Step 3: Approve the native build for better-sqlite3**

pnpm 11 blocks native postinstall scripts by default. Approve better-sqlite3 so its bindings compile:
```bash
pnpm approve-builds
```
Select `better-sqlite3` (and keep any previously-approved entries like `esbuild`). This appends `better-sqlite3` to the build allowlist in `pnpm-workspace.yaml`. Then reinstall to trigger the build:
```bash
pnpm install
```

- [ ] **Step 4: Write the smoke test (also proves better-sqlite3 loads and runs)**

`packages/store/src/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { VERSION } from './index';

describe('@jarvis/store', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('can open an in-memory SQLite database (native module built)', () => {
    const db = new Database(':memory:');
    const row = db.prepare('SELECT 1 + 1 AS n').get() as { n: number };
    expect(row.n).toBe(2);
    db.close();
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @jarvis/store test`
Expected: 2 tests PASS (if the second fails to load `better-sqlite3`, the build did not run — revisit Step 3).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(store): scaffold @jarvis/store with better-sqlite3, zod, yaml"
```

---

### Task 2: Data-root path resolution

**Files:**
- Create: `packages/store/src/paths.ts`
- Test: `packages/store/src/paths.test.ts`

**Interfaces:**
- Consumes: nothing from the repo.
- Produces:
  - `resolveDataRoot(override?: string): string` — `override` → `process.env.JARVIS_HOME` → `~/jarvis`.
  - `ensureDataRoot(root: string): void` — creates `root` and `root/plans` (recursive, idempotent).

- [ ] **Step 1: Write the failing tests**

`packages/store/src/paths.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDataRoot, ensureDataRoot } from './paths';

describe('resolveDataRoot', () => {
  const saved = process.env.JARVIS_HOME;
  afterEach(() => {
    if (saved === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = saved;
  });

  it('prefers an explicit override', () => {
    process.env.JARVIS_HOME = '/from/env';
    expect(resolveDataRoot('/explicit')).toBe('/explicit');
  });

  it('falls back to JARVIS_HOME', () => {
    process.env.JARVIS_HOME = '/from/env';
    expect(resolveDataRoot()).toBe('/from/env');
  });

  it('defaults to ~/jarvis', () => {
    delete process.env.JARVIS_HOME;
    expect(resolveDataRoot()).toBe(path.join(os.homedir(), 'jarvis'));
  });
});

describe('ensureDataRoot', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-paths-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the root and plans/ directory idempotently', () => {
    const root = path.join(dir, 'data');
    ensureDataRoot(root);
    ensureDataRoot(root); // idempotent — must not throw
    expect(fs.existsSync(path.join(root, 'plans'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/store test paths`
Expected: FAIL — cannot resolve `./paths`.

- [ ] **Step 3: Implement `paths.ts`**

`packages/store/src/paths.ts`:
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveDataRoot(override?: string): string {
  return override ?? process.env.JARVIS_HOME ?? path.join(os.homedir(), 'jarvis');
}

export function ensureDataRoot(root: string): void {
  fs.mkdirSync(path.join(root, 'plans'), { recursive: true });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/store test paths`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(store): resolve and ensure the data root directory"
```

---

### Task 3: Config loading + validation

**Files:**
- Create: `packages/store/src/config.ts`
- Test: `packages/store/src/config.test.ts`

**Interfaces:**
- Consumes: `WorkStream` (from `@jarvis/core`), `yaml`, `zod`.
- Produces:
  - `ConfigSchema` (zod), `JarvisConfig` (`z.infer`) with fields: `dailyCapacityHours`, `deadlineHorizonDays`, `fallingBehindPct`, `droppedBallDays`, `streams: WorkStream[]`.
  - `loadConfig(dataRoot: string): JarvisConfig` — reads `dataRoot/config.yaml`, parses YAML, validates, applies defaults.

- [ ] **Step 1: Write the failing tests**

`packages/store/src/config.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/store test config`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 3: Implement `config.ts`**

`packages/store/src/config.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const StreamSchema = z.object({
  id: z.string(),
  name: z.string(),
  weeklyBudgetHours: z.number().nonnegative(),
  weight: z.number().min(0).max(1).default(0.5),
  workdays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  active: z.boolean().default(true),
});

export const ConfigSchema = z.object({
  dailyCapacityHours: z.number().positive().default(8),
  deadlineHorizonDays: z.number().int().positive().default(5),
  fallingBehindPct: z.number().min(0).max(100).default(25),
  droppedBallDays: z.number().int().nonnegative().default(1),
  streams: z.array(StreamSchema).default([]),
});

export type JarvisConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(dataRoot: string): JarvisConfig {
  const file = path.join(dataRoot, 'config.yaml');
  const raw = fs.readFileSync(file, 'utf8');
  const parsed: unknown = parseYaml(raw) ?? {};
  return ConfigSchema.parse(parsed);
}
```

Note: `StreamSchema`'s output shape is exactly `@jarvis/core`'s `WorkStream`, so `cfg.streams` is usable directly as `WorkStream[]`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/store test config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(store): load and validate config.yaml with zod"
```

---

### Task 4: SQLite database + schema

**Files:**
- Create: `packages/store/src/db.ts`
- Test: `packages/store/src/db.test.ts`

**Interfaces:**
- Consumes: `better-sqlite3`.
- Produces:
  - `type DB = Database.Database`
  - `openDatabase(file: string): DB` — opens `file` (or `:memory:`), sets WAL for file DBs, runs `migrate`.
  - `openDb(dataRoot: string): DB` — opens `dataRoot/jarvis.db` via `openDatabase`.
  - Schema: tables `tasks` (id PK) and `time_logs` (autoincrement id), created idempotently.

- [ ] **Step 1: Write the failing tests**

`packages/store/src/db.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';

describe('openDatabase', () => {
  it('creates the tasks and time_logs tables', () => {
    const db = openDatabase(':memory:');
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(names).toContain('tasks');
    expect(names).toContain('time_logs');
    db.close();
  });

  it('is idempotent (re-running migrate does not throw)', () => {
    const db = openDatabase(':memory:');
    expect(() => db.exec('SELECT 1')).not.toThrow();
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/store test db`
Expected: FAIL — cannot resolve `./db`.

- [ ] **Step 3: Implement `db.ts`**

`packages/store/src/db.ts`:
```ts
import Database from 'better-sqlite3';
import path from 'node:path';

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export function openDb(dataRoot: string): DB {
  return openDatabase(path.join(dataRoot, 'jarvis.db'));
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      estimate_hours REAL,
      deadline TEXT,
      status TEXT NOT NULL,
      spent_hours REAL NOT NULL DEFAULT 0,
      waiting_since TEXT
    );
    CREATE TABLE IF NOT EXISTS time_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      task_id TEXT,
      hours REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_time_logs_date ON time_logs(date);
  `);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/store test db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(store): open SQLite database and create schema"
```

---

### Task 5: Repository (tasks + time logs)

**Files:**
- Create: `packages/store/src/repository.ts`
- Test: `packages/store/src/repository.test.ts`

**Interfaces:**
- Consumes: `DB` (db.ts); `Task`, `TimeLog` (`@jarvis/core`); `weekStart`, `parseISODate`, `toISODate` (`@jarvis/core`).
- Produces:
  - `upsertTask(db: DB, task: Task): void` — insert or replace by `id`.
  - `getTasks(db: DB): Task[]`
  - `addTimeLog(db: DB, log: TimeLog): void`
  - `getWeekLogs(db: DB, referenceDate: string): TimeLog[]` — logs in the Monday–Sunday week containing `referenceDate`.

- [ ] **Step 1: Write the failing tests**

`packages/store/src/repository.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, type DB } from './db';
import { upsertTask, getTasks, addTimeLog, getWeekLogs } from './repository';
import type { Task } from '@jarvis/core';

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    streamId: 's1',
    title: partial.id,
    source: 'manual',
    status: 'todo',
    spentHours: 0,
    ...partial,
  };
}

describe('repository', () => {
  let db: DB;
  beforeEach(() => {
    db = openDatabase(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('round-trips a task through upsert/get, preserving optional fields', () => {
    upsertTask(db, task({ id: 't1', title: 'Ship', estimateHours: 4, deadline: '2026-07-20', waitingSince: '2026-07-10' }));
    const got = getTasks(db);
    expect(got).toEqual([
      {
        id: 't1',
        streamId: 's1',
        title: 'Ship',
        source: 'manual',
        status: 'todo',
        spentHours: 0,
        estimateHours: 4,
        deadline: '2026-07-20',
        waitingSince: '2026-07-10',
      },
    ]);
  });

  it('upsert updates an existing task by id', () => {
    upsertTask(db, task({ id: 't1', status: 'todo' }));
    upsertTask(db, task({ id: 't1', status: 'done', spentHours: 5 }));
    const got = getTasks(db);
    expect(got).toHaveLength(1);
    expect(got[0]?.status).toBe('done');
    expect(got[0]?.spentHours).toBe(5);
  });

  it('omits optional fields that were not set (undefined, not null)', () => {
    upsertTask(db, task({ id: 't2' }));
    const got = getTasks(db)[0];
    expect(got?.estimateHours).toBeUndefined();
    expect(got?.deadline).toBeUndefined();
    expect(got?.waitingSince).toBeUndefined();
    expect(got?.sourceRef).toBeUndefined();
  });

  it('returns only this week\'s time logs (Mon–Sun of the reference date)', () => {
    addTimeLog(db, { date: '2026-07-12', streamId: 's1', hours: 2 }); // Sunday of previous week
    addTimeLog(db, { date: '2026-07-13', streamId: 's1', hours: 3 }); // Monday (in week)
    addTimeLog(db, { date: '2026-07-15', streamId: 's1', taskId: 't1', hours: 1 }); // Wed (in week)
    addTimeLog(db, { date: '2026-07-20', streamId: 's1', hours: 4 }); // next Monday (out)
    const logs = getWeekLogs(db, '2026-07-14'); // Tuesday
    expect(logs).toEqual([
      { date: '2026-07-13', streamId: 's1', taskId: undefined, hours: 3 },
      { date: '2026-07-15', streamId: 's1', taskId: 't1', hours: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/store test repository`
Expected: FAIL — cannot resolve `./repository`.

- [ ] **Step 3: Implement `repository.ts`**

`packages/store/src/repository.ts`:
```ts
import type { DB } from './db';
import type { Task, TimeLog } from '@jarvis/core';
import { weekStart, parseISODate, toISODate } from '@jarvis/core';

interface TaskRow {
  id: string;
  stream_id: string;
  title: string;
  source: string;
  source_ref: string | null;
  estimate_hours: number | null;
  deadline: string | null;
  status: string;
  spent_hours: number;
  waiting_since: string | null;
}

interface TimeLogRow {
  date: string;
  stream_id: string;
  task_id: string | null;
  hours: number;
}

const DAY_MS = 86_400_000;

export function upsertTask(db: DB, task: Task): void {
  db.prepare(
    `INSERT INTO tasks
       (id, stream_id, title, source, source_ref, estimate_hours, deadline, status, spent_hours, waiting_since)
     VALUES
       (@id, @streamId, @title, @source, @sourceRef, @estimateHours, @deadline, @status, @spentHours, @waitingSince)
     ON CONFLICT(id) DO UPDATE SET
       stream_id = excluded.stream_id,
       title = excluded.title,
       source = excluded.source,
       source_ref = excluded.source_ref,
       estimate_hours = excluded.estimate_hours,
       deadline = excluded.deadline,
       status = excluded.status,
       spent_hours = excluded.spent_hours,
       waiting_since = excluded.waiting_since`,
  ).run({
    id: task.id,
    streamId: task.streamId,
    title: task.title,
    source: task.source,
    sourceRef: task.sourceRef ?? null,
    estimateHours: task.estimateHours ?? null,
    deadline: task.deadline ?? null,
    status: task.status,
    spentHours: task.spentHours,
    waitingSince: task.waitingSince ?? null,
  });
}

function rowToTask(r: TaskRow): Task {
  const t: Task = {
    id: r.id,
    streamId: r.stream_id,
    title: r.title,
    source: r.source as Task['source'],
    status: r.status as Task['status'],
    spentHours: r.spent_hours,
  };
  if (r.source_ref !== null) t.sourceRef = r.source_ref;
  if (r.estimate_hours !== null) t.estimateHours = r.estimate_hours;
  if (r.deadline !== null) t.deadline = r.deadline;
  if (r.waiting_since !== null) t.waitingSince = r.waiting_since;
  return t;
}

export function getTasks(db: DB): Task[] {
  const rows = db.prepare('SELECT * FROM tasks').all() as TaskRow[];
  return rows.map(rowToTask);
}

export function addTimeLog(db: DB, log: TimeLog): void {
  db.prepare('INSERT INTO time_logs (date, stream_id, task_id, hours) VALUES (?, ?, ?, ?)').run(
    log.date,
    log.streamId,
    log.taskId ?? null,
    log.hours,
  );
}

export function getWeekLogs(db: DB, referenceDate: string): TimeLog[] {
  const start = weekStart(referenceDate);
  const end = toISODate(new Date(parseISODate(start).getTime() + 6 * DAY_MS));
  const rows = db
    .prepare('SELECT date, stream_id, task_id, hours FROM time_logs WHERE date >= ? AND date <= ? ORDER BY date')
    .all(start, end) as TimeLogRow[];
  return rows.map((r) => {
    const log: TimeLog = { date: r.date, streamId: r.stream_id, hours: r.hours };
    if (r.task_id !== null) log.taskId = r.task_id;
    return log;
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/store test repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(store): add task and time-log repository"
```

---

### Task 6: Markdown plan writer

**Files:**
- Create: `packages/store/src/plan-writer.ts`
- Test: `packages/store/src/plan-writer.test.ts`

**Interfaces:**
- Consumes: `Allocation`, `Alert` (`@jarvis/core`); filesystem.
- Produces:
  - `renderPlan(allocation: Allocation, alerts: Alert[], streamNames: Record<string, string>): string` — pure markdown renderer.
  - `writePlan(dataRoot: string, allocation: Allocation, alerts: Alert[], streamNames: Record<string, string>): string` — writes `dataRoot/plans/<date>.md`, returns the file path.

- [ ] **Step 1: Write the failing tests**

`packages/store/src/plan-writer.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/store test plan-writer`
Expected: FAIL — cannot resolve `./plan-writer`.

- [ ] **Step 3: Implement `plan-writer.ts`**

`packages/store/src/plan-writer.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Allocation, Alert } from '@jarvis/core';

export function renderPlan(
  allocation: Allocation,
  alerts: Alert[],
  streamNames: Record<string, string>,
): string {
  const out: string[] = [];
  out.push(`# Plan — ${allocation.date}`);
  out.push('');
  out.push(`Capacity: ${allocation.capacityHours}h${allocation.overcommitted ? ' (overcommitted)' : ''}`);
  out.push('');
  for (const line of allocation.lines) {
    out.push(`## ${streamNames[line.streamId] ?? line.streamId} — ${line.targetHours}h`);
    for (const t of line.tasks) {
      out.push(`- [ ] ${t.title}`);
    }
    out.push('');
  }
  if (alerts.length > 0) {
    out.push('## Alerts');
    for (const a of alerts) {
      out.push(`- **${a.severity}** (${a.type}): ${a.message}`);
    }
    out.push('');
  }
  return out.join('\n');
}

export function writePlan(
  dataRoot: string,
  allocation: Allocation,
  alerts: Alert[],
  streamNames: Record<string, string>,
): string {
  const file = path.join(dataRoot, 'plans', `${allocation.date}.md`);
  fs.writeFileSync(file, renderPlan(allocation, alerts, streamNames), 'utf8');
  return file;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/store test plan-writer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(store): render and write the daily plan markdown"
```

---

### Task 7: Public API + end-to-end integration test

**Files:**
- Modify: `packages/store/src/index.ts`
- Test: `packages/store/src/integration.test.ts`

**Interfaces:**
- Consumes: everything above + `@jarvis/core`'s `allocate`.
- Produces: `@jarvis/store` public exports — `resolveDataRoot`, `ensureDataRoot`, `loadConfig`, `ConfigSchema`, `type JarvisConfig`, `openDb`, `openDatabase`, `type DB`, `upsertTask`, `getTasks`, `addTimeLog`, `getWeekLogs`, `renderPlan`, `writePlan`.

- [ ] **Step 1: Replace `index.ts` with the public surface**

`packages/store/src/index.ts`:
```ts
export const VERSION = '0.1.0';

export { resolveDataRoot, ensureDataRoot } from './paths';
export { loadConfig, ConfigSchema, type JarvisConfig } from './config';
export { openDb, openDatabase, type DB } from './db';
export { upsertTask, getTasks, addTimeLog, getWeekLogs } from './repository';
export { renderPlan, writePlan } from './plan-writer';
```

- [ ] **Step 2: Update the smoke test's version assertion**

In `packages/store/src/smoke.test.ts`, change:
```ts
    expect(VERSION).toBe('0.1.0');
```

- [ ] **Step 3: Write the end-to-end integration test**

`packages/store/src/integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allocate } from '@jarvis/core';
import { ensureDataRoot, loadConfig, openDb, upsertTask, getTasks, addTimeLog, getWeekLogs, writePlan } from './index';

describe('store integration: config -> db -> allocate -> plan file', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-int-'));
    ensureDataRoot(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('drives the whole persistence path end to end', () => {
    fs.writeFileSync(
      path.join(dir, 'config.yaml'),
      `dailyCapacityHours: 8
streams:
  - id: work
    name: Work
    weeklyBudgetHours: 20
`,
      'utf8',
    );

    const cfg = loadConfig(dir);
    const db = openDb(dir);
    upsertTask(db, { id: 't1', streamId: 'work', title: 'Review PR', source: 'github', status: 'todo', spentHours: 0 });
    addTimeLog(db, { date: '2026-07-13', streamId: 'work', hours: 4 });

    const { allocation, alerts } = allocate({
      date: '2026-07-14', // Tuesday, 4 remaining workdays
      streams: cfg.streams,
      tasks: getTasks(db),
      weekLogs: getWeekLogs(db, '2026-07-14'),
      committedHoursToday: 0,
      dailyCapacityHours: cfg.dailyCapacityHours,
      deadlineHorizonDays: cfg.deadlineHorizonDays,
      fallingBehindPct: cfg.fallingBehindPct,
      droppedBallDays: cfg.droppedBallDays,
    });

    // remaining 16h over 4 workdays -> 4.0h target for "work"
    expect(allocation.lines[0]?.streamId).toBe('work');
    expect(allocation.lines[0]?.targetHours).toBe(4);

    const streamNames = Object.fromEntries(cfg.streams.map((s) => [s.id, s.name]));
    const file = writePlan(dir, allocation, alerts, streamNames);

    const md = fs.readFileSync(file, 'utf8');
    expect(md).toContain('# Plan — 2026-07-14');
    expect(md).toContain('## Work — 4h');
    expect(md).toContain('- [ ] Review PR');
    db.close();
  });
});
```

- [ ] **Step 4: Run the full suite with coverage**

Run: `pnpm --filter @jarvis/store exec vitest run --coverage`
Expected: PASS, coverage for `src` (excluding tests + `index.ts`) at/near 100%.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @jarvis/store typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(store): finalize public API and add end-to-end integration test"
```

---

## What comes next (future plans, not this one)

- `packages/connectors` — `folder`, `calendar`, `github` behind a common `Connector` interface, upserting tasks into the store.
- `packages/scheduler` — local `croner` jobs (`dailyPlan`, `pollSources`, `endOfDayReview`) wiring connectors → store → core → plan writer.
- `apps/cli` — `jarvis today` / `jarvis plan` / `jarvis alerts`.
