# Core Allocation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/core` — the pure, deterministic allocation engine that turns work streams + tasks + time logs + today's calendar load into a ranked daily plan plus alerts (overcommit, falling-behind, deadline-risk, dropped-ball).

**Architecture:** A single pure package with no I/O and no external runtime dependencies. Small focused modules — domain types, date math, task ranking, deadline pressure, the `allocate()` orchestrator, and three alert scanners — composed by `allocate()`. Everything is a pure function so it is unit-testable without mocks. Consumers (store, connectors, scheduler, CLI) come in later plans and depend on this package; this package depends on nothing in the repo.

**Tech Stack:** TypeScript (ES2022, strict), pnpm workspaces, vitest.

## Global Constraints

- **`packages/core` has ZERO external runtime dependencies and performs ZERO I/O.** Pure functions only. (Dev-only deps like `vitest`/`typescript` are fine.)
- **All dates are ISO date strings `YYYY-MM-DD` and are computed in UTC** — no timezone logic in core (timezone belongs to the scheduler layer later). This keeps the engine deterministic.
- **Week = Monday–Sunday** (ISO). "This week" always means the Mon–Sun week containing the reference date.
- **Weekday numbering: `0=Sunday … 6=Saturday`** (matches JS `Date.getUTCDay()`).
- **Language: English** for all code, comments, identifiers, and commit messages. Conventional Commits.
- **No `Co-Authored-By: Claude` / no "Generated with" trailers** in commits.
- **TDD:** every logic function gets a failing test first. Target 100% coverage for `packages/core`.

---

### Task 1: Monorepo scaffold + `@jarvis/core` package + vitest

**Files:**
- Create: `package.json` (repo root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: an installable workspace where `pnpm test` runs vitest in `packages/core`; `@jarvis/core` exports `VERSION`.

- [ ] **Step 1: Create root workspace files**

`package.json`:
```json
{
  "name": "jarvis",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 2: Create the core package files**

`packages/core/package.json`:
```json
{
  "name": "@jarvis/core",
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
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src"]
}
```

`packages/core/vitest.config.ts`:
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

`packages/core/src/index.ts`:
```ts
export const VERSION = '0.0.0';
```

- [ ] **Step 3: Write the smoke test**

`packages/core/src/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { VERSION } from './index';

describe('@jarvis/core', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.0.0');
  });
});
```

- [ ] **Step 4: Install and run tests**

Run: `pnpm install && pnpm test`
Expected: vitest runs in `@jarvis/core`, 1 test file, 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(core): scaffold monorepo and @jarvis/core with vitest"
```

---

### Task 2: Domain model + date helpers

**Files:**
- Create: `packages/core/src/model.ts`
- Create: `packages/core/src/dates.ts`
- Test: `packages/core/src/dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Types (all in `model.ts`): `WorkStream`, `Task`, `TaskSource`, `TaskStatus`, `TimeLog`, `AllocationLine`, `Allocation`, `Alert`, `AlertType`, `AlertSeverity`.
  - Date functions (all in `dates.ts`, ISO `YYYY-MM-DD`, UTC):
    - `parseISODate(iso: string): Date`
    - `toISODate(d: Date): string`
    - `weekdayOf(iso: string): number` — 0=Sun..6=Sat
    - `weekStart(iso: string): string` — Monday of that week
    - `isSameWeek(a: string, b: string): boolean`
    - `daysUntil(from: string, to: string): number` — integer `to - from`
    - `countRemainingWorkdays(iso: string, workdays: number[]): number` — today..Sunday inclusive
    - `workdaysInWeek(iso: string, workdays: number[]): number` — whole Mon–Sun week
    - `workdaysElapsed(iso: string, workdays: number[]): number` — Monday..today inclusive

- [ ] **Step 1: Write `model.ts` (types only — consumed by later tasks)**

`packages/core/src/model.ts`:
```ts
export interface WorkStream {
  id: string;
  name: string;
  weeklyBudgetHours: number;
  weight: number; // 0..1, used to bias overcommit scale-down (later)
  workdays: number[]; // 0=Sun..6=Sat
  active: boolean;
}

export type TaskSource = 'calendar' | 'gmail' | 'github' | 'folder' | 'manual';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

export interface Task {
  id: string;
  streamId: string;
  title: string;
  source: TaskSource;
  sourceRef?: string;
  estimateHours?: number;
  deadline?: string; // ISO date
  status: TaskStatus;
  spentHours: number;
  waitingSince?: string; // ISO date — set when this task is awaiting a response
}

export interface TimeLog {
  date: string; // ISO date
  streamId: string;
  taskId?: string;
  hours: number;
}

export interface AllocationLine {
  streamId: string;
  targetHours: number;
  tasks: Task[];
}

export interface Allocation {
  date: string; // ISO date
  capacityHours: number;
  lines: AllocationLine[];
  overcommitted: boolean;
}

export type AlertType = 'deadline_risk' | 'dropped_ball' | 'falling_behind' | 'overcommit';
export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  streamId?: string;
  taskId?: string;
  message: string;
}
```

- [ ] **Step 2: Write the failing date tests**

`packages/core/src/dates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  weekdayOf,
  weekStart,
  isSameWeek,
  daysUntil,
  countRemainingWorkdays,
  workdaysInWeek,
  workdaysElapsed,
} from './dates';

const MON_FRI = [1, 2, 3, 4, 5];

describe('dates', () => {
  it('weekdayOf: 2026-07-14 is a Tuesday (2)', () => {
    expect(weekdayOf('2026-07-14')).toBe(2);
  });

  it('weekStart: Monday of the week containing 2026-07-14 is 2026-07-13', () => {
    expect(weekStart('2026-07-14')).toBe('2026-07-13');
    expect(weekStart('2026-07-13')).toBe('2026-07-13'); // Monday maps to itself
    expect(weekStart('2026-07-19')).toBe('2026-07-13'); // Sunday still same week
  });

  it('isSameWeek respects Mon–Sun boundaries', () => {
    expect(isSameWeek('2026-07-13', '2026-07-19')).toBe(true);
    expect(isSameWeek('2026-07-19', '2026-07-20')).toBe(false);
  });

  it('daysUntil returns signed integer day difference', () => {
    expect(daysUntil('2026-07-14', '2026-07-16')).toBe(2);
    expect(daysUntil('2026-07-14', '2026-07-14')).toBe(0);
    expect(daysUntil('2026-07-14', '2026-07-13')).toBe(-1);
  });

  it('countRemainingWorkdays: Tue 07-14, Mon–Fri -> Tue,Wed,Thu,Fri = 4', () => {
    expect(countRemainingWorkdays('2026-07-14', MON_FRI)).toBe(4);
  });

  it('countRemainingWorkdays: Sun 07-19, Mon–Fri = 0', () => {
    expect(countRemainingWorkdays('2026-07-19', MON_FRI)).toBe(0);
  });

  it('workdaysInWeek: Mon–Fri = 5', () => {
    expect(workdaysInWeek('2026-07-14', MON_FRI)).toBe(5);
  });

  it('workdaysElapsed: Tue 07-14, Mon–Fri -> Mon,Tue = 2', () => {
    expect(workdaysElapsed('2026-07-14', MON_FRI)).toBe(2);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @jarvis/core test`
Expected: FAIL — cannot resolve `./dates`.

- [ ] **Step 4: Implement `dates.ts`**

`packages/core/src/dates.ts`:
```ts
const DAY_MS = 86_400_000;

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(iso: string): number {
  return parseISODate(iso).getUTCDay();
}

export function weekStart(iso: string): string {
  const d = parseISODate(iso);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Mon->0 ... Sun->6
  return toISODate(new Date(d.getTime() - daysSinceMonday * DAY_MS));
}

export function isSameWeek(a: string, b: string): boolean {
  return weekStart(a) === weekStart(b);
}

export function daysUntil(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / DAY_MS);
}

export function countRemainingWorkdays(iso: string, workdays: number[]): number {
  const start = parseISODate(iso);
  const daysToSunday = (7 - start.getUTCDay()) % 7; // Sun->0, Mon->6, Sat->1
  let count = 0;
  for (let i = 0; i <= daysToSunday; i++) {
    const day = new Date(start.getTime() + i * DAY_MS).getUTCDay();
    if (workdays.includes(day)) count++;
  }
  return count;
}

export function workdaysInWeek(iso: string, workdays: number[]): number {
  const monday = parseISODate(weekStart(iso));
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday.getTime() + i * DAY_MS).getUTCDay();
    if (workdays.includes(day)) count++;
  }
  return count;
}

export function workdaysElapsed(iso: string, workdays: number[]): number {
  const monday = parseISODate(weekStart(iso));
  const today = parseISODate(iso);
  let count = 0;
  for (let t = monday.getTime(); t <= today.getTime(); t += DAY_MS) {
    if (workdays.includes(new Date(t).getUTCDay())) count++;
  }
  return count;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @jarvis/core test`
Expected: PASS (all `dates` tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add domain model and UTC date helpers"
```

---

### Task 3: Task ranking + deadline pressure

**Files:**
- Create: `packages/core/src/rank.ts`
- Create: `packages/core/src/pressure.ts`
- Test: `packages/core/src/rank.test.ts`
- Test: `packages/core/src/pressure.test.ts`

**Interfaces:**
- Consumes: `Task` (model.ts), `daysUntil` (dates.ts).
- Produces:
  - `rankTasks(streamId: string, tasks: Task[]): Task[]` — open tasks (`status !== 'done'`) for the stream, sorted by deadline ascending (tasks without a deadline last), tie-broken by `estimateHours` descending.
  - `deadlinePressure(streamId: string, tasks: Task[], today: string, horizonDays: number): number` — summed daily demand from open, dated tasks due within `[today, today+horizonDays]`, each spread over the inclusive days until due.

- [ ] **Step 1: Write the failing ranking test**

`packages/core/src/rank.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { rankTasks } from './rank';
import type { Task } from './model';

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

describe('rankTasks', () => {
  it('keeps only the stream, drops done, sorts by deadline then estimate', () => {
    const tasks: Task[] = [
      task({ id: 'a', deadline: '2026-07-20', estimateHours: 1 }),
      task({ id: 'b', deadline: '2026-07-16', estimateHours: 2 }),
      task({ id: 'c' }), // no deadline -> last
      task({ id: 'd', deadline: '2026-07-16', estimateHours: 5 }), // same deadline as b, bigger estimate first
      task({ id: 'e', status: 'done', deadline: '2026-07-15' }), // dropped
      task({ id: 'f', streamId: 's2', deadline: '2026-07-15' }), // other stream, dropped
    ];
    expect(rankTasks('s1', tasks).map((t) => t.id)).toEqual(['d', 'b', 'a', 'c']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/core test rank`
Expected: FAIL — cannot resolve `./rank`.

- [ ] **Step 3: Implement `rank.ts`**

`packages/core/src/rank.ts`:
```ts
import type { Task } from './model';

export function rankTasks(streamId: string, tasks: Task[]): Task[] {
  return tasks
    .filter((t) => t.streamId === streamId && t.status !== 'done')
    .sort((a, b) => {
      const ad = a.deadline ?? '9999-12-31';
      const bd = b.deadline ?? '9999-12-31';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return (b.estimateHours ?? 0) - (a.estimateHours ?? 0);
    });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/core test rank`
Expected: PASS.

- [ ] **Step 5: Write the failing deadline-pressure test**

`packages/core/src/pressure.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deadlinePressure } from './pressure';
import type { Task } from './model';

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

describe('deadlinePressure', () => {
  const today = '2026-07-14';

  it('spreads each due task estimate over inclusive days until due', () => {
    // due in 1 day -> daysUntil=1 -> spread over 2 days -> 4/2 = 2
    const tasks = [task({ id: 'a', deadline: '2026-07-15', estimateHours: 4 })];
    expect(deadlinePressure('s1', tasks, today, 5)).toBeCloseTo(2);
  });

  it('sums across tasks and ignores out-of-horizon, done, undated, and other streams', () => {
    const tasks: Task[] = [
      task({ id: 'a', deadline: '2026-07-14', estimateHours: 3 }), // due today -> 3/1 = 3
      task({ id: 'b', deadline: '2026-07-16', estimateHours: 4 }), // in 2 days -> 4/3
      task({ id: 'c', deadline: '2026-08-01', estimateHours: 9 }), // beyond horizon -> 0
      task({ id: 'd', estimateHours: 9 }), // undated -> 0
      task({ id: 'e', deadline: '2026-07-15', estimateHours: 9, status: 'done' }), // done -> 0
      task({ id: 'f', streamId: 's2', deadline: '2026-07-15', estimateHours: 9 }), // other stream
    ];
    expect(deadlinePressure('s1', tasks, today, 5)).toBeCloseTo(3 + 4 / 3);
  });

  it('treats a missing estimate as 0', () => {
    const tasks = [task({ id: 'a', deadline: '2026-07-15' })];
    expect(deadlinePressure('s1', tasks, today, 5)).toBe(0);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @jarvis/core test pressure`
Expected: FAIL — cannot resolve `./pressure`.

- [ ] **Step 7: Implement `pressure.ts`**

`packages/core/src/pressure.ts`:
```ts
import type { Task } from './model';
import { daysUntil } from './dates';

export function deadlinePressure(
  streamId: string,
  tasks: Task[],
  today: string,
  horizonDays: number,
): number {
  let demand = 0;
  for (const t of tasks) {
    if (t.streamId !== streamId) continue;
    if (t.status === 'done') continue;
    if (!t.deadline) continue;
    const d = daysUntil(today, t.deadline);
    if (d < 0 || d > horizonDays) continue;
    const estimate = t.estimateHours ?? 0;
    demand += estimate / (d + 1); // inclusive spread; d>=0 so denominator >=1
  }
  return demand;
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm --filter @jarvis/core test pressure`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(core): add task ranking and deadline pressure"
```

---

### Task 4: `allocate()` — base pace, capacity, overcommit

**Files:**
- Create: `packages/core/src/allocate.ts`
- Test: `packages/core/src/allocate.test.ts`

**Interfaces:**
- Consumes: `WorkStream`, `Task`, `TimeLog`, `AllocationLine`, `Allocation`, `Alert` (model.ts); `countRemainingWorkdays` (dates.ts); `rankTasks` (rank.ts); `deadlinePressure` (pressure.ts).
- Produces:
  - `interface AllocateInput { date: string; streams: WorkStream[]; tasks: Task[]; weekLogs: TimeLog[]; committedHoursToday: number; dailyCapacityHours: number; deadlineHorizonDays: number; }`
  - `interface AllocateResult { allocation: Allocation; alerts: Alert[]; }`
  - `allocate(input: AllocateInput): AllocateResult`
  - `round1(n: number): number` (exported helper, one-decimal rounding)

Note: in this task `allocate()` emits only the `overcommit` alert; Task 5 adds the other scanners into it.

- [ ] **Step 1: Write the failing allocate tests**

`packages/core/src/allocate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { allocate, round1, type AllocateInput } from './allocate';
import type { WorkStream } from './model';

const MON_FRI = [1, 2, 3, 4, 5];

function stream(partial: Partial<WorkStream> & { id: string }): WorkStream {
  return {
    name: partial.id,
    weeklyBudgetHours: 10,
    weight: 0.5,
    workdays: MON_FRI,
    active: true,
    ...partial,
  };
}

function baseInput(over: Partial<AllocateInput> = {}): AllocateInput {
  return {
    date: '2026-07-14', // Tuesday -> 4 remaining workdays (Tue..Fri)
    streams: [],
    tasks: [],
    weekLogs: [],
    committedHoursToday: 0,
    dailyCapacityHours: 8,
    deadlineHorizonDays: 5,
    ...over,
  };
}

describe('round1', () => {
  it('rounds to one decimal', () => {
    expect(round1(2.4999)).toBe(2.5);
    expect(round1(1 / 3)).toBe(0.3);
  });
});

describe('allocate', () => {
  it('splits remaining weekly budget over remaining workdays (base pace)', () => {
    const res = allocate(baseInput({ streams: [stream({ id: 's1', weeklyBudgetHours: 20 })] }));
    // 20h budget, 0 logged, 4 remaining workdays -> 5.0h today
    expect(res.allocation.lines).toEqual([
      { streamId: 's1', targetHours: 5, tasks: [] },
    ]);
    expect(res.allocation.overcommitted).toBe(false);
    expect(res.alerts.map((a) => a.type)).not.toContain('overcommit');
  });

  it('subtracts already-logged hours (self-correcting pace)', () => {
    const res = allocate(
      baseInput({
        streams: [stream({ id: 's1', weeklyBudgetHours: 20 })],
        weekLogs: [{ date: '2026-07-13', streamId: 's1', hours: 8 }],
      }),
    );
    // remaining 12h over 4 days -> 3.0h
    expect(res.allocation.lines[0]?.targetHours).toBe(3);
  });

  it('computes capacity as dailyCapacity minus committed calendar hours', () => {
    const res = allocate(
      baseInput({
        streams: [stream({ id: 's1', weeklyBudgetHours: 20 })],
        committedHoursToday: 3,
      }),
    );
    expect(res.allocation.capacityHours).toBe(5);
  });

  it('drops inactive streams and omits zero-target lines', () => {
    const res = allocate(
      baseInput({
        streams: [
          stream({ id: 's1', weeklyBudgetHours: 20 }),
          stream({ id: 's2', active: false, weeklyBudgetHours: 20 }),
          stream({ id: 's3', weeklyBudgetHours: 0 }),
        ],
      }),
    );
    expect(res.allocation.lines.map((l) => l.streamId)).toEqual(['s1']);
  });

  it('sorts lines by target descending', () => {
    const res = allocate(
      baseInput({
        dailyCapacityHours: 100,
        streams: [
          stream({ id: 'small', weeklyBudgetHours: 4 }),
          stream({ id: 'big', weeklyBudgetHours: 40 }),
        ],
      }),
    );
    expect(res.allocation.lines.map((l) => l.streamId)).toEqual(['big', 'small']);
  });

  it('scales down proportionally and raises overcommit when targets exceed capacity', () => {
    const res = allocate(
      baseInput({
        dailyCapacityHours: 3,
        streams: [
          stream({ id: 's1', weeklyBudgetHours: 20 }), // base 5
          stream({ id: 's2', weeklyBudgetHours: 20 }), // base 5 -> total 10, capacity 3 -> scale 0.3
        ],
      }),
    );
    expect(res.allocation.overcommitted).toBe(true);
    expect(res.allocation.lines[0]?.targetHours).toBe(1.5);
    expect(res.allocation.lines[1]?.targetHours).toBe(1.5);
    expect(res.alerts.map((a) => a.type)).toContain('overcommit');
  });

  it('lets deadline pressure raise a stream above its base pace', () => {
    const res = allocate(
      baseInput({
        dailyCapacityHours: 100,
        streams: [stream({ id: 's1', weeklyBudgetHours: 20 })], // base 5
        tasks: [
          {
            id: 't1',
            streamId: 's1',
            title: 'ship',
            source: 'manual',
            status: 'todo',
            spentHours: 0,
            estimateHours: 16,
            deadline: '2026-07-15', // due in 1 day -> pressure 8
          },
        ],
      }),
    );
    // max(basePace 5, pressure 8) = 8, capped by remaining weekly 20
    expect(res.allocation.lines[0]?.targetHours).toBe(8);
    expect(res.allocation.lines[0]?.tasks.map((t) => t.id)).toEqual(['t1']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/core test allocate`
Expected: FAIL — cannot resolve `./allocate`.

- [ ] **Step 3: Implement `allocate.ts`**

`packages/core/src/allocate.ts`:
```ts
import type { WorkStream, Task, TimeLog, AllocationLine, Allocation, Alert } from './model';
import { countRemainingWorkdays } from './dates';
import { rankTasks } from './rank';
import { deadlinePressure } from './pressure';

export interface AllocateInput {
  date: string;
  streams: WorkStream[];
  tasks: Task[];
  weekLogs: TimeLog[];
  committedHoursToday: number;
  dailyCapacityHours: number;
  deadlineHorizonDays: number;
}

export interface AllocateResult {
  allocation: Allocation;
  alerts: Alert[];
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface RawLine {
  stream: WorkStream;
  target: number;
  tasks: Task[];
}

export function allocate(input: AllocateInput): AllocateResult {
  const { date, streams, tasks, weekLogs, committedHoursToday, dailyCapacityHours, deadlineHorizonDays } = input;
  const capacity = Math.max(0, dailyCapacityHours - committedHoursToday);
  const alerts: Alert[] = [];

  const raw: RawLine[] = [];
  for (const s of streams) {
    if (!s.active) continue;
    const logged = weekLogs
      .filter((l) => l.streamId === s.id)
      .reduce((sum, l) => sum + l.hours, 0);
    const remainingWeekly = Math.max(0, s.weeklyBudgetHours - logged);
    const remainingWorkdays = countRemainingWorkdays(date, s.workdays);
    const basePace = remainingWorkdays > 0 ? remainingWeekly / remainingWorkdays : remainingWeekly;
    const pressure = deadlinePressure(s.id, tasks, date, deadlineHorizonDays);
    const target = Math.min(remainingWeekly, Math.max(basePace, pressure));
    raw.push({ stream: s, target, tasks: rankTasks(s.id, tasks) });
  }

  const totalTarget = raw.reduce((sum, r) => sum + r.target, 0);
  let overcommitted = false;
  if (totalTarget > capacity && totalTarget > 0) {
    overcommitted = true;
    const scale = capacity / totalTarget;
    for (const r of raw) r.target *= scale;
    alerts.push({
      type: 'overcommit',
      severity: 'warn',
      message: `Today's target ${round1(totalTarget)}h exceeds capacity ${round1(capacity)}h; scaled down.`,
    });
  }

  const lines: AllocationLine[] = raw
    .sort((a, b) => b.target - a.target)
    .map((r) => ({ streamId: r.stream.id, targetHours: round1(r.target), tasks: r.tasks }))
    .filter((l) => l.targetHours > 0);

  return { allocation: { date, capacityHours: capacity, lines, overcommitted }, alerts };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/core test allocate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): add allocate() with base pace, capacity and overcommit"
```

---

### Task 5: Crack detection (falling-behind, deadline-risk, dropped-ball)

**Files:**
- Create: `packages/core/src/alerts.ts`
- Modify: `packages/core/src/allocate.ts` (compose the scanners into `allocate()`)
- Test: `packages/core/src/alerts.test.ts`
- Modify: `packages/core/src/allocate.test.ts` (add an assertion that alerts flow through)

**Interfaces:**
- Consumes: `WorkStream`, `Task`, `Alert`, `Allocation` (model.ts); `workdaysInWeek`, `workdaysElapsed`, `daysUntil` (dates.ts).
- Produces (all in `alerts.ts`):
  - `scanFallingBehind(stream: WorkStream, loggedThisWeek: number, today: string, thresholdPct: number): Alert[]`
  - `scanDeadlineRisks(tasks: Task[], allocation: Allocation, today: string, horizonDays: number): Alert[]`
  - `scanDroppedBalls(tasks: Task[], today: string, droppedBallDays: number): Alert[]`
- `AllocateInput` gains two optional fields with defaults: `fallingBehindPct?: number` (default 25), `droppedBallDays?: number` (default 2).

- [ ] **Step 1: Write the failing alerts tests**

`packages/core/src/alerts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { scanFallingBehind, scanDeadlineRisks, scanDroppedBalls } from './alerts';
import type { WorkStream, Task, Allocation } from './model';

const MON_FRI = [1, 2, 3, 4, 5];

function stream(partial: Partial<WorkStream> & { id: string }): WorkStream {
  return { name: partial.id, weeklyBudgetHours: 10, weight: 0.5, workdays: MON_FRI, active: true, ...partial };
}
function task(partial: Partial<Task> & { id: string }): Task {
  return { streamId: 's1', title: partial.id, source: 'manual', status: 'todo', spentHours: 0, ...partial };
}

describe('scanFallingBehind', () => {
  // 2026-07-15 is a Wednesday: elapsed workdays Mon,Tue,Wed = 3 of 5 -> expected 60% of budget
  const wed = '2026-07-15';

  it('warns when logged is far below the expected pace', () => {
    const s = stream({ id: 's1', weeklyBudgetHours: 10 }); // expected 6.0h by Wed
    const alerts = scanFallingBehind(s, 1, wed, 25); // 1h << 6 * 0.75
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.type).toBe('falling_behind');
    expect(alerts[0]?.streamId).toBe('s1');
  });

  it('stays quiet when on pace', () => {
    const s = stream({ id: 's1', weeklyBudgetHours: 10 });
    expect(scanFallingBehind(s, 6, wed, 25)).toEqual([]);
  });
});

describe('scanDeadlineRisks', () => {
  const today = '2026-07-14';

  it('flags an open dated task in horizon whose stream got zero allocation', () => {
    const tasks = [task({ id: 't1', streamId: 's2', deadline: '2026-07-15', estimateHours: 4 })];
    const allocation: Allocation = {
      date: today,
      capacityHours: 8,
      lines: [{ streamId: 's1', targetHours: 5, tasks: [] }], // s2 absent -> zero
      overcommitted: false,
    };
    const alerts = scanDeadlineRisks(tasks, allocation, today, 5);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'deadline_risk', severity: 'critical', taskId: 't1' });
  });

  it('does not flag when the stream has a positive allocation', () => {
    const tasks = [task({ id: 't1', streamId: 's1', deadline: '2026-07-15', estimateHours: 4 })];
    const allocation: Allocation = {
      date: today,
      capacityHours: 8,
      lines: [{ streamId: 's1', targetHours: 5, tasks: [] }],
      overcommitted: false,
    };
    expect(scanDeadlineRisks(tasks, allocation, today, 5)).toEqual([]);
  });
});

describe('scanDroppedBalls', () => {
  const today = '2026-07-14';

  it('flags open tasks waiting longer than the threshold', () => {
    const tasks = [
      task({ id: 'old', waitingSince: '2026-07-10' }), // 4 days
      task({ id: 'fresh', waitingSince: '2026-07-13' }), // 1 day
      task({ id: 'done', waitingSince: '2026-07-01', status: 'done' }),
    ];
    const alerts = scanDroppedBalls(tasks, today, 2);
    expect(alerts.map((a) => a.taskId)).toEqual(['old']);
    expect(alerts[0]?.type).toBe('dropped_ball');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/core test alerts`
Expected: FAIL — cannot resolve `./alerts`.

- [ ] **Step 3: Implement `alerts.ts`**

`packages/core/src/alerts.ts`:
```ts
import type { WorkStream, Task, Alert, Allocation } from './model';
import { workdaysInWeek, workdaysElapsed, daysUntil } from './dates';

export function scanFallingBehind(
  stream: WorkStream,
  loggedThisWeek: number,
  today: string,
  thresholdPct: number,
): Alert[] {
  const total = workdaysInWeek(today, stream.workdays);
  if (total === 0) return [];
  const elapsed = workdaysElapsed(today, stream.workdays);
  const expected = stream.weeklyBudgetHours * (elapsed / total);
  const floor = expected * (1 - thresholdPct / 100);
  if (loggedThisWeek < floor) {
    return [
      {
        type: 'falling_behind',
        severity: 'warn',
        streamId: stream.id,
        message: `${stream.name} is behind pace: ${loggedThisWeek}h logged vs ~${Math.round(expected)}h expected by today.`,
      },
    ];
  }
  return [];
}

export function scanDeadlineRisks(
  tasks: Task[],
  allocation: Allocation,
  today: string,
  horizonDays: number,
): Alert[] {
  const allocated = new Set(allocation.lines.filter((l) => l.targetHours > 0).map((l) => l.streamId));
  const alerts: Alert[] = [];
  for (const t of tasks) {
    if (t.status === 'done') continue;
    if (!t.deadline) continue;
    const d = daysUntil(today, t.deadline);
    if (d < 0 || d > horizonDays) continue;
    if (allocated.has(t.streamId)) continue;
    alerts.push({
      type: 'deadline_risk',
      severity: 'critical',
      streamId: t.streamId,
      taskId: t.id,
      message: `"${t.title}" is due in ${d}d but its stream has no time allocated today.`,
    });
  }
  return alerts;
}

export function scanDroppedBalls(tasks: Task[], today: string, droppedBallDays: number): Alert[] {
  const alerts: Alert[] = [];
  for (const t of tasks) {
    if (t.status === 'done') continue;
    if (!t.waitingSince) continue;
    if (daysUntil(t.waitingSince, today) > droppedBallDays) {
      alerts.push({
        type: 'dropped_ball',
        severity: 'warn',
        streamId: t.streamId,
        taskId: t.id,
        message: `"${t.title}" has been waiting since ${t.waitingSince}.`,
      });
    }
  }
  return alerts;
}
```

- [ ] **Step 4: Run to verify alerts tests pass**

Run: `pnpm --filter @jarvis/core test alerts`
Expected: PASS.

- [ ] **Step 5: Compose scanners into `allocate()`**

In `packages/core/src/allocate.ts`, update the import line and the `AllocateInput` interface, and append the scanner calls before building `lines`. Replace the existing import from `./dates` and the `AllocateInput` interface, and insert the scanner block.

Change the imports at the top to also pull the scanners and the extra date helper:
```ts
import { countRemainingWorkdays } from './dates';
import { rankTasks } from './rank';
import { deadlinePressure } from './pressure';
import { scanFallingBehind, scanDeadlineRisks, scanDroppedBalls } from './alerts';
```

Add the two optional fields to `AllocateInput`:
```ts
export interface AllocateInput {
  date: string;
  streams: WorkStream[];
  tasks: Task[];
  weekLogs: TimeLog[];
  committedHoursToday: number;
  dailyCapacityHours: number;
  deadlineHorizonDays: number;
  fallingBehindPct?: number; // default 25
  droppedBallDays?: number; // default 2
}
```

Inside `allocate()`, after the overcommit block and **before** building `lines`, add falling-behind scanning per stream (it needs each stream's logged hours). Refactor so `logged` is captured per raw line. Change the `RawLine` interface and loop to store `logged`:
```ts
interface RawLine {
  stream: WorkStream;
  target: number;
  tasks: Task[];
  logged: number;
}
```
In the stream loop, push `logged` too:
```ts
raw.push({ stream: s, target, tasks: rankTasks(s.id, tasks), logged });
```
Then after the overcommit block, build `lines` first, then run the scanners (deadline risk needs the finished `allocation`):
```ts
  const lines: AllocationLine[] = raw
    .sort((a, b) => b.target - a.target)
    .map((r) => ({ streamId: r.stream.id, targetHours: round1(r.target), tasks: r.tasks }))
    .filter((l) => l.targetHours > 0);

  const allocation: Allocation = { date, capacityHours: capacity, lines, overcommitted };

  const fallingBehindPct = input.fallingBehindPct ?? 25;
  const droppedBallDays = input.droppedBallDays ?? 2;
  for (const r of raw) {
    alerts.push(...scanFallingBehind(r.stream, r.logged, date, fallingBehindPct));
  }
  alerts.push(...scanDeadlineRisks(tasks, allocation, date, deadlineHorizonDays));
  alerts.push(...scanDroppedBalls(tasks, date, droppedBallDays));

  return { allocation, alerts };
```
Remove the old `return { allocation: { ... }, alerts };` line so there is exactly one return.

- [ ] **Step 6: Add an integration assertion to `allocate.test.ts`**

Append this test inside the existing `describe('allocate', ...)` block:
```ts
  it('surfaces falling-behind and dropped-ball alerts through allocate()', () => {
    const res = allocate(
      baseInput({
        date: '2026-07-15', // Wednesday
        streams: [stream({ id: 's1', weeklyBudgetHours: 10 })],
        weekLogs: [{ date: '2026-07-13', streamId: 's1', hours: 1 }], // behind
        tasks: [
          {
            id: 'w',
            streamId: 's1',
            title: 'reply',
            source: 'github',
            status: 'todo',
            spentHours: 0,
            waitingSince: '2026-07-10',
          },
        ],
      }),
    );
    const types = res.alerts.map((a) => a.type);
    expect(types).toContain('falling_behind');
    expect(types).toContain('dropped_ball');
  });
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm --filter @jarvis/core test`
Expected: PASS (all files).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add crack detection and wire scanners into allocate()"
```

---

### Task 6: Public API surface + scenario integration test

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/scenario.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `@jarvis/core` public exports — all model types, `allocate`, `AllocateInput`, `AllocateResult`, `round1`, plus `rankTasks`, `deadlinePressure`, the three `scan*` functions, and the date helpers.

- [ ] **Step 1: Replace `index.ts` with the real public surface**

`packages/core/src/index.ts`:
```ts
export const VERSION = '0.1.0';

export type {
  WorkStream,
  Task,
  TaskSource,
  TaskStatus,
  TimeLog,
  AllocationLine,
  Allocation,
  Alert,
  AlertType,
  AlertSeverity,
} from './model';

export { allocate, round1, type AllocateInput, type AllocateResult } from './allocate';
export { rankTasks } from './rank';
export { deadlinePressure } from './pressure';
export { scanFallingBehind, scanDeadlineRisks, scanDroppedBalls } from './alerts';
export {
  parseISODate,
  toISODate,
  weekdayOf,
  weekStart,
  isSameWeek,
  daysUntil,
  countRemainingWorkdays,
  workdaysInWeek,
  workdaysElapsed,
} from './dates';
```

- [ ] **Step 2: Update the smoke test for the new version**

In `packages/core/src/index.test.ts`, change the expected version:
```ts
    expect(VERSION).toBe('0.1.0');
```

- [ ] **Step 3: Write the scenario test (morning-briefing shape from design §3.1)**

`packages/core/src/scenario.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { allocate, type AllocateInput, type WorkStream } from './index';

const MON_FRI = [1, 2, 3, 4, 5];

describe('scenario: morning briefing', () => {
  it('produces a ranked, budget-respecting plan for three streams', () => {
    const streams: WorkStream[] = [
      { id: 'alpha', name: 'Alpha', weeklyBudgetHours: 25, weight: 0.5, workdays: MON_FRI, active: true },
      { id: 'beta', name: 'Beta', weeklyBudgetHours: 15, weight: 0.3, workdays: MON_FRI, active: true },
      { id: 'gamma', name: 'Gamma', weeklyBudgetHours: 8, weight: 0.2, workdays: MON_FRI, active: true },
    ];
    const input: AllocateInput = {
      date: '2026-07-14', // Tuesday, 4 remaining workdays
      streams,
      tasks: [],
      weekLogs: [],
      committedHoursToday: 3,
      dailyCapacityHours: 8,
      deadlineHorizonDays: 5,
    };

    const { allocation } = allocate(input);

    expect(allocation.capacityHours).toBe(5); // 8 - 3
    // base paces: 25/4=6.25, 15/4=3.75, 8/4=2.0 -> total 12 > 5 -> overcommit, scaled by 5/12
    expect(allocation.overcommitted).toBe(true);
    expect(allocation.lines.map((l) => l.streamId)).toEqual(['alpha', 'beta', 'gamma']);
    const total = allocation.lines.reduce((s, l) => s + l.targetHours, 0);
    expect(total).toBeCloseTo(5, 1);
  });
});
```

- [ ] **Step 4: Run the full suite with coverage**

Run: `pnpm --filter @jarvis/core exec vitest run --coverage`
Expected: PASS, and coverage for `src` (excluding tests + `index.ts`) at/near 100%.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @jarvis/core typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): finalize public API and add morning-briefing scenario test"
```

---

## What comes next (future plans, not this one)

- `packages/store` — SQLite persistence + human-readable `plans/*.md` writer over `~/jarvis`.
- `packages/connectors` — `folder`, `calendar`, `github` behind a common `Connector` interface.
- `packages/scheduler` — local `croner` jobs (`dailyPlan`, `pollSources`, `endOfDayReview`).
- `apps/cli` — `jarvis today` / `jarvis plan` / `jarvis alerts`.
