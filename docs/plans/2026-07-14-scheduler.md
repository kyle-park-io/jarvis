# Scheduler — Daily Plan Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/scheduler` — the integration layer that runs the daily pipeline (pull connectors → reconcile into the store → run core `allocate()` → write the plan) and schedules it with `croner`. This is where all the other packages come together.

**Architecture:** Two pieces. `runDailyPlan()` is a pure-orchestration function that wires `@jarvis/connectors` → `@jarvis/store` → `@jarvis/core` → the store's plan writer; it is fully testable against a temp data root. `startScheduler()` is a thin `croner` wrapper that fires `runDailyPlan` on a cron cadence. Reconciliation is **source-authoritative**: a connector's `pull()` is the source of truth for its `source`, so tasks that disappear from a source are deleted from the store (this closes the folder title-rename orphan gap) — implemented by a new `syncSourceTasks` in the store.

**Tech Stack:** TypeScript (ES2022, strict), pnpm workspaces, vitest, croner.

## Global Constraints

- **`packages/scheduler` is the integration layer** — it depends on `@jarvis/core`, `@jarvis/store`, `@jarvis/connectors`, and `croner`. It contains no engine logic of its own; it only wires the packages together.
- **Reconciliation is source-authoritative:** `syncSourceTasks(db, source, tasks)` upserts every task in `tasks` and DELETES any store task with the same `source` whose id is not in `tasks`. It must NOT touch tasks of other sources. Runs in a single transaction.
- **`committedHoursToday` defaults to `0`** (no calendar connector yet).
- **Cron schedule + timezone are scheduler options** (default daily `'0 8 * * *'`), not stored in the strict store config.
- **Node ≥ 22.** Language: English for code, comments, identifiers, commit messages. Conventional Commits.
- **No `Co-Authored-By: Claude` / no "Generated with" trailers** in commits.
- **TDD:** every logic function gets a failing test first. Filesystem tests use a per-test temp directory (`fs.mkdtempSync`) and clean it up; store unit tests use `:memory:`.

---

### Task 1: Scaffold `@jarvis/scheduler` package

**Files:**
- Create: `packages/scheduler/package.json`
- Create: `packages/scheduler/tsconfig.json`
- Create: `packages/scheduler/vitest.config.ts`
- Create: `packages/scheduler/src/index.ts`
- Test: `packages/scheduler/src/smoke.test.ts`

**Interfaces:**
- Consumes: `@jarvis/core`, `@jarvis/store`, `@jarvis/connectors` (workspace), `croner`.
- Produces: an installable `@jarvis/scheduler` package where `pnpm --filter @jarvis/scheduler test` runs vitest and `croner` loads.

- [ ] **Step 1: Create the package files**

`packages/scheduler/package.json`:
```json
{
  "name": "@jarvis/scheduler",
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
    "@jarvis/core": "workspace:*",
    "@jarvis/store": "workspace:*",
    "@jarvis/connectors": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

`packages/scheduler/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src"]
}
```

`packages/scheduler/vitest.config.ts`:
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

`packages/scheduler/src/index.ts`:
```ts
export const VERSION = '0.0.0';
```

- [ ] **Step 2: Add the `croner` dependency**

Run:
```bash
pnpm --filter @jarvis/scheduler add croner
```
(croner is pure JavaScript — no native build step required.)

- [ ] **Step 3: Write the smoke test (also proves croner loads)**

`packages/scheduler/src/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Cron } from 'croner';
import { VERSION } from './index';

describe('@jarvis/scheduler', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('can construct a croner job (dependency loads)', () => {
    const job = new Cron('0 8 * * *');
    expect(job.nextRun()).toBeInstanceOf(Date);
    job.stop();
  });
});
```

- [ ] **Step 4: Install and run tests**

Run: `pnpm install && pnpm --filter @jarvis/scheduler test`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(scheduler): scaffold @jarvis/scheduler with croner"
```

---

### Task 2: Store — source-authoritative task sync

**Files:**
- Modify: `packages/store/src/repository.ts`
- Modify: `packages/store/src/index.ts`
- Test: `packages/store/src/repository.test.ts` (add cases)

**Interfaces:**
- Consumes: `DB` (db.ts), `Task` (`@jarvis/core`), existing `upsertTask`.
- Produces: `syncSourceTasks(db: DB, source: string, tasks: Task[]): void` — in one transaction, upserts each task in `tasks` and deletes any store task of the same `source` whose id is not in `tasks`; leaves other sources untouched.

- [ ] **Step 1: Write the failing test**

Add to `packages/store/src/repository.test.ts`, inside the existing `describe('repository', ...)` block:
```ts
  it('syncSourceTasks upserts present tasks and deletes gone ones of the same source, leaving other sources', () => {
    upsertTask(db, task({ id: 'folder:s:A', title: 'A' }));
    upsertTask(db, task({ id: 'folder:s:B', title: 'B' }));
    upsertTask(db, task({ id: 'github:s:1', title: 'gh', source: 'github' }));

    syncSourceTasks(db, 'folder', [
      task({ id: 'folder:s:A', title: 'A2', status: 'done' }), // updated
      task({ id: 'folder:s:C', title: 'C' }), // new
      // B is gone
    ]);

    const got = getTasks(db);
    expect(got.map((t) => t.id).sort()).toEqual(['folder:s:A', 'folder:s:C', 'github:s:1']);
    expect(got.find((t) => t.id === 'folder:s:A')?.title).toBe('A2');
    expect(got.find((t) => t.id === 'folder:s:A')?.status).toBe('done');
  });
```
Also add `syncSourceTasks` to the import at the top of `repository.test.ts` (it currently imports `upsertTask, getTasks, addTimeLog, getWeekLogs` from `./repository`):
```ts
import { upsertTask, getTasks, addTimeLog, getWeekLogs, syncSourceTasks } from './repository';
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/store test repository`
Expected: FAIL — `syncSourceTasks` is not exported.

- [ ] **Step 3: Implement `syncSourceTasks` (append to `repository.ts`)**

Add to `packages/store/src/repository.ts`:
```ts
export function syncSourceTasks(db: DB, source: string, tasks: Task[]): void {
  const keep = new Set(tasks.map((t) => t.id));
  const apply = db.transaction(() => {
    for (const task of tasks) upsertTask(db, task);
    const existing = db.prepare('SELECT id FROM tasks WHERE source = ?').all(source) as { id: string }[];
    const del = db.prepare('DELETE FROM tasks WHERE id = ?');
    for (const row of existing) {
      if (!keep.has(row.id)) del.run(row.id);
    }
  });
  apply();
}
```

- [ ] **Step 4: Export it from the store's public API**

In `packages/store/src/index.ts`, add `syncSourceTasks` to the repository export line so it reads:
```ts
export { upsertTask, getTasks, addTimeLog, getWeekLogs, syncSourceTasks } from './repository';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @jarvis/store test repository`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(store): add source-authoritative syncSourceTasks"
```

---

### Task 3: The `runDailyPlan` pipeline

**Files:**
- Create: `packages/scheduler/src/pipeline.ts`
- Test: `packages/scheduler/src/pipeline.test.ts`

**Interfaces:**
- Consumes: `allocate`, `Allocation`, `Alert` (`@jarvis/core`); `openDb`, `loadConfig`, `getTasks`, `getWeekLogs`, `syncSourceTasks`, `writePlan` (`@jarvis/store`); `Connector` (`@jarvis/connectors`).
- Produces:
  - `interface RunDailyPlanOptions { dataRoot: string; connectors: Connector[]; date: string; committedHoursToday?: number; }`
  - `interface DailyPlanResult { allocation: Allocation; alerts: Alert[]; planPath: string; }`
  - `runDailyPlan(options: RunDailyPlanOptions): Promise<DailyPlanResult>` — for each connector, `pull()` then `syncSourceTasks(db, connector.id, tasks)`; then `allocate()` over all store tasks + this week's logs; then `writePlan`; returns the result. Always closes the DB.

- [ ] **Step 1: Write the failing test**

`packages/scheduler/src/pipeline.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDataRoot } from '@jarvis/store';
import { folderConnector } from '@jarvis/connectors';
import { runDailyPlan } from './pipeline';

describe('runDailyPlan', () => {
  let dataRoot: string;
  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sched-'));
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
  });
  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('pulls folder tasks, allocates, and writes the plan file', async () => {
    fs.writeFileSync(path.join(dataRoot, 'streams', 'work.md'), '- [ ] Do work', 'utf8');

    const result = await runDailyPlan({
      dataRoot,
      connectors: [folderConnector(path.join(dataRoot, 'streams'))],
      date: '2026-07-14', // Tuesday, 4 remaining workdays
    });

    // 20h budget / 4 workdays = 5.0h for "work"
    expect(result.allocation.lines[0]?.streamId).toBe('work');
    expect(result.allocation.lines[0]?.targetHours).toBe(5);
    expect(fs.existsSync(result.planPath)).toBe(true);
    const md = fs.readFileSync(result.planPath, 'utf8');
    expect(md).toContain('## Work — 5h');
    expect(md).toContain('- [ ] Do work');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/scheduler test pipeline`
Expected: FAIL — cannot resolve `./pipeline`.

- [ ] **Step 3: Implement `pipeline.ts`**

`packages/scheduler/src/pipeline.ts`:
```ts
import { allocate, type Allocation, type Alert } from '@jarvis/core';
import { openDb, loadConfig, getTasks, getWeekLogs, syncSourceTasks, writePlan } from '@jarvis/store';
import type { Connector } from '@jarvis/connectors';

export interface RunDailyPlanOptions {
  dataRoot: string;
  connectors: Connector[];
  date: string;
  committedHoursToday?: number;
}

export interface DailyPlanResult {
  allocation: Allocation;
  alerts: Alert[];
  planPath: string;
}

export async function runDailyPlan(options: RunDailyPlanOptions): Promise<DailyPlanResult> {
  const { dataRoot, connectors, date, committedHoursToday = 0 } = options;
  const config = loadConfig(dataRoot);
  const db = openDb(dataRoot);
  try {
    for (const connector of connectors) {
      const tasks = await connector.pull();
      syncSourceTasks(db, connector.id, tasks);
    }

    const { allocation, alerts } = allocate({
      date,
      streams: config.streams,
      tasks: getTasks(db),
      weekLogs: getWeekLogs(db, date),
      committedHoursToday,
      dailyCapacityHours: config.dailyCapacityHours,
      deadlineHorizonDays: config.deadlineHorizonDays,
      fallingBehindPct: config.fallingBehindPct,
      droppedBallDays: config.droppedBallDays,
    });

    const streamNames = Object.fromEntries(config.streams.map((s) => [s.id, s.name]));
    const planPath = writePlan(dataRoot, allocation, alerts, streamNames);
    return { allocation, alerts, planPath };
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/scheduler test pipeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scheduler): add runDailyPlan pipeline"
```

---

### Task 4: Croner scheduler wrapper

**Files:**
- Create: `packages/scheduler/src/scheduler.ts`
- Test: `packages/scheduler/src/scheduler.test.ts`

**Interfaces:**
- Consumes: `croner`.
- Produces:
  - `interface SchedulerOptions { onDailyPlan: () => void | Promise<void>; dailyPlanCron?: string; timezone?: string; }`
  - `interface SchedulerHandle { stop(): void; nextRun(): Date | null; }`
  - `startScheduler(options: SchedulerOptions): SchedulerHandle` — schedules `onDailyPlan` on the given cron (default `'0 8 * * *'`), optional timezone; returns a handle to inspect the next run and stop.

- [ ] **Step 1: Write the failing tests**

`packages/scheduler/src/scheduler.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { startScheduler } from './scheduler';

describe('startScheduler', () => {
  it('schedules a job with a future next run and can be stopped', () => {
    const handle = startScheduler({ onDailyPlan: () => {}, dailyPlanCron: '0 8 * * *' });
    const next = handle.nextRun();
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now());
    handle.stop();
  });

  it('fires the callback on schedule', async () => {
    const fired = new Promise<void>((resolve) => {
      const handle = startScheduler({
        onDailyPlan: () => {
          handle.stop();
          resolve();
        },
        dailyPlanCron: '* * * * * *', // every second
      });
    });
    await expect(fired).resolves.toBeUndefined();
  }, 4000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/scheduler test scheduler`
Expected: FAIL — cannot resolve `./scheduler`.

- [ ] **Step 3: Implement `scheduler.ts`**

`packages/scheduler/src/scheduler.ts`:
```ts
import { Cron } from 'croner';

export interface SchedulerOptions {
  onDailyPlan: () => void | Promise<void>;
  dailyPlanCron?: string;
  timezone?: string;
}

export interface SchedulerHandle {
  stop(): void;
  nextRun(): Date | null;
}

export function startScheduler(options: SchedulerOptions): SchedulerHandle {
  const pattern = options.dailyPlanCron ?? '0 8 * * *';
  const cronOptions = options.timezone ? { timezone: options.timezone } : {};
  const job = new Cron(pattern, cronOptions, () => {
    void options.onDailyPlan();
  });
  return {
    stop: () => job.stop(),
    nextRun: () => job.nextRun(),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/scheduler test scheduler`
Expected: PASS (the every-second test fires within the 4s timeout).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scheduler): add croner scheduler wrapper"
```

---

### Task 5: Public API + reconciliation integration test

**Files:**
- Modify: `packages/scheduler/src/index.ts`
- Test: `packages/scheduler/src/integration.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `@jarvis/scheduler` public exports — `runDailyPlan`, `type RunDailyPlanOptions`, `type DailyPlanResult`, `startScheduler`, `type SchedulerOptions`, `type SchedulerHandle`, and `VERSION = '0.1.0'`.

- [ ] **Step 1: Replace `index.ts` with the public surface**

`packages/scheduler/src/index.ts`:
```ts
export const VERSION = '0.1.0';

export { runDailyPlan, type RunDailyPlanOptions, type DailyPlanResult } from './pipeline';
export { startScheduler, type SchedulerOptions, type SchedulerHandle } from './scheduler';
```

- [ ] **Step 2: Update the smoke test's version assertion**

In `packages/scheduler/src/smoke.test.ts`, change:
```ts
    expect(VERSION).toBe('0.1.0');
```

- [ ] **Step 3: Write the reconciliation integration test**

`packages/scheduler/src/integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDataRoot, openDb, getTasks } from '@jarvis/store';
import { folderConnector } from '@jarvis/connectors';
import { runDailyPlan } from './index';

describe('scheduler reconciliation integration', () => {
  let dataRoot: string;
  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sched-int-'));
    ensureDataRoot(dataRoot);
    fs.mkdirSync(path.join(dataRoot, 'streams'));
    fs.writeFileSync(
      path.join(dataRoot, 'config.yaml'),
      `streams:
  - id: work
    name: Work
    weeklyBudgetHours: 20
`,
      'utf8',
    );
  });
  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('deletes a folder task from the store once it is removed from the file', async () => {
    const streamsDir = path.join(dataRoot, 'streams');
    const workFile = path.join(streamsDir, 'work.md');
    const connectors = [folderConnector(streamsDir)];

    fs.writeFileSync(workFile, '- [ ] Alpha\n- [ ] Beta', 'utf8');
    await runDailyPlan({ dataRoot, connectors, date: '2026-07-14' });

    let db = openDb(dataRoot);
    expect(getTasks(db).map((t) => t.title).sort()).toEqual(['Alpha', 'Beta']);
    db.close();

    // Remove "Beta" from the file, re-run.
    fs.writeFileSync(workFile, '- [ ] Alpha', 'utf8');
    await runDailyPlan({ dataRoot, connectors, date: '2026-07-14' });

    db = openDb(dataRoot);
    expect(getTasks(db).map((t) => t.title)).toEqual(['Alpha']); // Beta reconciled away
    db.close();
  });
});
```

- [ ] **Step 4: Run the full suite with coverage**

Run: `pnpm --filter @jarvis/scheduler exec vitest run --coverage`
Expected: PASS, coverage for `src` (excluding tests + `index.ts`) at/near 100%.

- [ ] **Step 5: Typecheck the whole monorepo**

Run: `pnpm -r typecheck`
Expected: no errors (confirms `@jarvis/store`'s new export and the scheduler both typecheck).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scheduler): finalize public API and add reconciliation integration test"
```

---

## What comes next (future plans, not this one)

- **MCP-backed connectors** — `calendar` (also supplies `committedHoursToday`), `gmail`, `github`, plugged into `runDailyPlan`'s `connectors` array.
- `pollSources` / `endOfDayReview` jobs — variations on the pipeline (crack polling; end-of-day log aggregation).
- `apps/cli` — `jarvis today` / `jarvis plan` / `jarvis alerts`, driving `runDailyPlan` and reading the plan/alerts.
