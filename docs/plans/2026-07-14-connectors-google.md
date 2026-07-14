# Google Connectors (Gmail + Calendar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two MCP-backed sources to `@jarvis/connectors`: a **Gmail connector** (unanswered threads → `Task[]`, same `Connector` contract as GitHub) and a **Calendar committed-hours provider** (today's timed events → a number of hours, which feeds the scheduler's `committedHoursToday`).

**Architecture:** Mirror the existing GitHub connector: a pure mapper + a defensive `extract*` (with per-element validation) + a thin factory that composes `mcpConnector` + `parseMcpJson`. Calendar is deliberately **not** a `Connector` (its events are not tasks) — it exposes `calendarCommittedHours(...)` returning `(date) => Promise<number>`, matching the number that `runDailyPlan({ committedHoursToday })` already accepts. **No `@modelcontextprotocol/sdk` dependency** — `callTool` is injected; live MCP wiring is app-layer (out of scope).

**Tech Stack:** TypeScript (ES2022, strict, `noUncheckedIndexedAccess`), pnpm workspaces, vitest.

## Global Constraints

- **Change is confined to `packages/connectors`.** No changes to core/store/scheduler/cli. New files `gmail.ts` + `calendar.ts` (+ tests); `index.ts` gains re-exports.
- **No new dependencies.** `mcpConnector`, `parseMcpJson`, and the `Connector`/`ConnectorId`/`Task` types already exist. `@modelcontextprotocol/sdk` is app-layer — do NOT import it.
- **Connector failure contract (empty-pull throws):** `pull()` MUST reject on auth/network/parse failure — never return `[]`. `[]` means the source genuinely has zero tasks and triggers deletion of all previously-synced tasks of that source. `mcpConnector` satisfies this by awaiting `callTool` directly; the Calendar fetcher satisfies it the same way (a failed fetch must reject, never silently yield `0`).
- **Element validation:** `extractThreads` validates each element via a `toGmailThread` guard that throws on a non-object or a missing `id` (mirrors GitHub's `toGithubIssue` — prevents silent `gmail:undefined` collisions). Calendar's `eventsToCommittedHours` instead **skips** malformed/all-day events defensively (one bad event must not kill the whole capacity calculation).
- **Node ≥ 22.** Language: English. Conventional Commits. No `Co-Authored-By: Claude` / "Generated with" trailers.
- **TDD:** failing test first, then minimal implementation.
- **Data shapes** target the real Google MCP tools: Gmail `search_threads` threads carry `id` + `subject` + `snippet`; Google Calendar v3 events carry `start`/`end` as `{ dateTime?, date? }` (timed events have `dateTime`; all-day events have only `date`). These field names may need a small tweak when live-wired against the actual server; the mappers are defensive so an unexpected wrapper shape throws a clear error rather than corrupting data.

---

### Task 1: Gmail connector (threads → tasks)

**Files:**
- Create: `packages/connectors/src/gmail.ts`
- Test: `packages/connectors/src/gmail.test.ts`

**Interfaces:**
- Consumes: `Task` (`@jarvis/core`); `Connector` (`./types`); `mcpConnector`, `parseMcpJson` (`./mcp`).
- Produces: `gmailThreadsToTasks(threads: GmailThread[], streamId: string): Task[]`; `extractThreads(parsed: unknown): GmailThread[]`; `gmailConnector(options: GmailConnectorOptions): Connector`; types `GmailThread`, `GmailConnectorOptions`.

- [ ] **Step 1: Write the failing tests**

Create `packages/connectors/src/gmail.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { gmailThreadsToTasks, extractThreads, gmailConnector } from './gmail';

describe('gmailThreadsToTasks', () => {
  it('maps a thread to a gmail task (subject → title, id → gmail:<id>, sourceRef, waitingSince, todo)', () => {
    const tasks = gmailThreadsToTasks(
      [{ id: 't1', subject: 'Reply to Alpha', lastMessageDate: '2026-07-10' }],
      'work',
    );
    expect(tasks).toStrictEqual([
      {
        id: 'gmail:t1',
        streamId: 'work',
        title: 'Reply to Alpha',
        source: 'gmail',
        sourceRef: 't1',
        status: 'todo',
        spentHours: 0,
        waitingSince: '2026-07-10',
      },
    ]);
  });

  it('falls back subject → snippet → placeholder, and omits waitingSince when absent', () => {
    expect(gmailThreadsToTasks([{ id: 'a', snippet: 'hi there' }], 'work')[0]).toStrictEqual({
      id: 'gmail:a',
      streamId: 'work',
      title: 'hi there',
      source: 'gmail',
      sourceRef: 'a',
      status: 'todo',
      spentHours: 0,
    });
    expect(gmailThreadsToTasks([{ id: 'b' }], 'work')[0]?.title).toBe('(no subject)');
  });
});

describe('extractThreads', () => {
  it('accepts a bare array and a { threads } wrapper', () => {
    expect(extractThreads([{ id: 'x', subject: 'S' }])).toStrictEqual([{ id: 'x', subject: 'S' }]);
    expect(extractThreads({ threads: [{ id: 'y' }] })).toStrictEqual([{ id: 'y' }]);
  });

  it('throws on an unexpected shape', () => {
    expect(() => extractThreads({ nope: 1 })).toThrow(/Unexpected Gmail MCP result shape/);
    expect(() => extractThreads(42)).toThrow(/Unexpected Gmail MCP result shape/);
  });

  it('throws on a malformed thread element (not an object / missing id)', () => {
    expect(() => extractThreads([null])).toThrow(/Malformed Gmail thread \(not an object\)/);
    expect(() => extractThreads([{ subject: 'no id' }])).toThrow(/Malformed Gmail thread \(missing id\)/);
  });
});

describe('gmailConnector', () => {
  it('id is gmail and pull maps a standard MCP result to tasks', async () => {
    const connector = gmailConnector({
      streamId: 'work',
      callTool: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ threads: [{ id: 't9', subject: 'Ping' }] }) }],
      }),
    });
    expect(connector.id).toBe('gmail');
    expect(await connector.pull()).toStrictEqual([
      { id: 'gmail:t9', streamId: 'work', title: 'Ping', source: 'gmail', sourceRef: 't9', status: 'todo', spentHours: 0 },
    ]);
  });

  it('pull rejects (never returns []) when the MCP call fails', async () => {
    const connector = gmailConnector({
      streamId: 'work',
      callTool: async () => {
        throw new Error('network down');
      },
    });
    await expect(connector.pull()).rejects.toThrow('network down');
  });

  it('pull rejects on an MCP error result', async () => {
    const connector = gmailConnector({
      streamId: 'work',
      callTool: async () => ({ content: [{ type: 'text', text: 'nope' }], isError: true }),
    });
    await expect(connector.pull()).rejects.toThrow(/MCP tool returned an error result/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/connectors test gmail`
Expected: FAIL — `./gmail` does not exist.

- [ ] **Step 3: Implement `packages/connectors/src/gmail.ts`**

```ts
import type { Task } from '@jarvis/core';
import type { Connector } from './types';
import { mcpConnector, parseMcpJson } from './mcp';

export interface GmailThread {
  id: string;
  subject?: string;
  snippet?: string;
  /** ISO date of the last message — when set, becomes the task's waitingSince. */
  lastMessageDate?: string;
}

export function gmailThreadsToTasks(threads: GmailThread[], streamId: string): Task[] {
  return threads.map((thread) => {
    const title = thread.subject ?? thread.snippet ?? '(no subject)';
    const task: Task = {
      id: `gmail:${thread.id}`,
      streamId,
      title,
      source: 'gmail',
      sourceRef: thread.id,
      status: 'todo',
      spentHours: 0,
    };
    if (thread.lastMessageDate !== undefined) task.waitingSince = thread.lastMessageDate;
    return task;
  });
}

function toGmailThread(raw: unknown): GmailThread {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`Malformed Gmail thread (not an object): ${JSON.stringify(raw)}`);
  }
  const thread = raw as { id?: unknown; subject?: unknown; snippet?: unknown; lastMessageDate?: unknown };
  if (typeof thread.id !== 'string') {
    throw new Error(`Malformed Gmail thread (missing id): ${JSON.stringify(raw)}`);
  }
  const result: GmailThread = { id: thread.id };
  if (typeof thread.subject === 'string') result.subject = thread.subject;
  if (typeof thread.snippet === 'string') result.snippet = thread.snippet;
  if (typeof thread.lastMessageDate === 'string') result.lastMessageDate = thread.lastMessageDate;
  return result;
}

export function extractThreads(parsed: unknown): GmailThread[] {
  let rawArray: unknown[];
  if (Array.isArray(parsed)) {
    rawArray = parsed;
  } else if (parsed !== null && typeof parsed === 'object') {
    const wrapped = parsed as { threads?: unknown };
    if (Array.isArray(wrapped.threads)) {
      rawArray = wrapped.threads;
    } else {
      throw new Error('Unexpected Gmail MCP result shape (expected an array or { threads })');
    }
  } else {
    throw new Error('Unexpected Gmail MCP result shape (expected an array or { threads })');
  }
  return rawArray.map(toGmailThread);
}

export interface GmailConnectorOptions {
  /** The stream all pulled Gmail tasks belong to. */
  streamId: string;
  /**
   * Calls the Gmail MCP server's thread-listing tool (e.g. `search_threads`
   * with a query like `is:unread -in:draft`) and resolves its raw result.
   * Wired to a real MCP client in the app layer. MUST reject on failure.
   */
  callTool: () => Promise<unknown>;
}

export function gmailConnector(options: GmailConnectorOptions): Connector {
  return mcpConnector({
    id: 'gmail',
    callTool: options.callTool,
    map: (raw) => gmailThreadsToTasks(extractThreads(parseMcpJson(raw)), options.streamId),
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/connectors test gmail`
Expected: PASS (all gmail tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @jarvis/connectors typecheck`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/gmail.ts packages/connectors/src/gmail.test.ts
git commit -m "feat(connectors): Gmail connector (threads → tasks)"
```

---

### Task 2: Calendar committed-hours provider (events → hours)

**Files:**
- Create: `packages/connectors/src/calendar.ts`
- Test: `packages/connectors/src/calendar.test.ts`

**Interfaces:**
- Consumes: `parseMcpJson` (`./mcp`).
- Produces: `eventsToCommittedHours(events: CalendarEvent[], date: string): number`; `extractEvents(parsed: unknown): CalendarEvent[]`; `calendarCommittedHours(options: CalendarCommittedHoursOptions): (date: string) => Promise<number>`; types `EventDateTime`, `CalendarEvent`, `CalendarCommittedHoursOptions`.
- Note: the returned number is meant to be passed to the scheduler's `runDailyPlan({ committedHoursToday })` (already a `number` option) — wiring is app-layer, not part of this task.

- [ ] **Step 1: Write the failing tests**

Create `packages/connectors/src/calendar.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { eventsToCommittedHours, extractEvents, calendarCommittedHours } from './calendar';

describe('eventsToCommittedHours', () => {
  it('sums durations of timed events that start on the date', () => {
    const events = [
      { start: { dateTime: '2026-07-14T10:00:00Z' }, end: { dateTime: '2026-07-14T11:00:00Z' } }, // 1h
      { start: { dateTime: '2026-07-14T13:00:00Z' }, end: { dateTime: '2026-07-14T13:30:00Z' } }, // 0.5h
    ];
    expect(eventsToCommittedHours(events, '2026-07-14')).toBe(1.5);
  });

  it('ignores events that start on other dates', () => {
    const events = [{ start: { dateTime: '2026-07-15T10:00:00Z' }, end: { dateTime: '2026-07-15T12:00:00Z' } }];
    expect(eventsToCommittedHours(events, '2026-07-14')).toBe(0);
  });

  it('ignores all-day events (date only, no dateTime)', () => {
    const events = [{ start: { date: '2026-07-14' }, end: { date: '2026-07-15' } }];
    expect(eventsToCommittedHours(events, '2026-07-14')).toBe(0);
  });

  it('skips null / malformed / non-positive-length events without throwing', () => {
    const events = [
      null,
      {},
      { start: { dateTime: 'not-a-date' }, end: { dateTime: 'also-bad' } },
      { start: { dateTime: '2026-07-14T10:00:00Z' }, end: { dateTime: '2026-07-14T09:00:00Z' } }, // negative
    ] as unknown as Parameters<typeof eventsToCommittedHours>[0];
    expect(eventsToCommittedHours(events, '2026-07-14')).toBe(0);
  });
});

describe('extractEvents', () => {
  it('accepts a bare array, { events }, and { items }', () => {
    expect(extractEvents([{ start: { date: '2026-07-14' } }])).toHaveLength(1);
    expect(extractEvents({ events: [1, 2] })).toStrictEqual([1, 2]);
    expect(extractEvents({ items: [3] })).toStrictEqual([3]);
  });

  it('throws on an unexpected shape', () => {
    expect(() => extractEvents({ nope: 1 })).toThrow(/Unexpected Calendar MCP result shape/);
    expect(() => extractEvents('x')).toThrow(/Unexpected Calendar MCP result shape/);
  });
});

describe('calendarCommittedHours', () => {
  it('returns a fetcher that parses an MCP result into committed hours', async () => {
    const fetchHours = calendarCommittedHours({
      callTool: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              events: [{ start: { dateTime: '2026-07-14T09:00:00Z' }, end: { dateTime: '2026-07-14T11:00:00Z' } }],
            }),
          },
        ],
      }),
    });
    expect(await fetchHours('2026-07-14')).toBe(2);
  });

  it('rejects (never yields 0) when the MCP call fails', async () => {
    const fetchHours = calendarCommittedHours({
      callTool: async () => {
        throw new Error('calendar offline');
      },
    });
    await expect(fetchHours('2026-07-14')).rejects.toThrow('calendar offline');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/connectors test calendar`
Expected: FAIL — `./calendar` does not exist.

- [ ] **Step 3: Implement `packages/connectors/src/calendar.ts`**

```ts
import { parseMcpJson } from './mcp';

export interface EventDateTime {
  /** RFC3339 timestamp for timed events, e.g. '2026-07-14T10:00:00+09:00'. */
  dateTime?: string;
  /** 'YYYY-MM-DD' for all-day events (no time — not counted as committed hours). */
  date?: string;
}

export interface CalendarEvent {
  start?: EventDateTime;
  end?: EventDateTime;
}

/**
 * Sum the duration (hours) of TIMED events whose start falls on `date`
 * (the local-date prefix of start.dateTime). All-day events (only `.date`)
 * are ignored — they don't consume the working day's hours. Malformed or
 * non-positive-length events are skipped, never thrown, so one bad event
 * can't wipe out the whole capacity calculation. Rounded to 0.1h.
 */
export function eventsToCommittedHours(events: CalendarEvent[], date: string): number {
  let hours = 0;
  for (const event of events) {
    const start = event?.start?.dateTime;
    const end = event?.end?.dateTime;
    if (typeof start !== 'string' || typeof end !== 'string') continue;
    if (!start.startsWith(date)) continue;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) continue;
    hours += (endMs - startMs) / 3_600_000;
  }
  return Math.round(hours * 10) / 10;
}

export function extractEvents(parsed: unknown): CalendarEvent[] {
  if (Array.isArray(parsed)) return parsed as CalendarEvent[];
  if (parsed !== null && typeof parsed === 'object') {
    const wrapped = parsed as { events?: unknown; items?: unknown };
    if (Array.isArray(wrapped.events)) return wrapped.events as CalendarEvent[];
    if (Array.isArray(wrapped.items)) return wrapped.items as CalendarEvent[];
  }
  throw new Error('Unexpected Calendar MCP result shape (expected an array, or { events } / { items })');
}

export interface CalendarCommittedHoursOptions {
  /**
   * Calls the Calendar MCP server's event-listing tool (e.g. `list_events`
   * for the day) and resolves its raw result. Wired to a real MCP client in
   * the app layer. MUST reject on failure — a bad fetch must never silently
   * yield 0 committed hours (which would overstate available capacity).
   */
  callTool: () => Promise<unknown>;
}

/**
 * Returns a fetcher `(date) => Promise<number>` giving the committed
 * (meeting) hours for a date. Feed the result to the scheduler's
 * `runDailyPlan({ committedHoursToday })` in the app layer.
 */
export function calendarCommittedHours(
  options: CalendarCommittedHoursOptions,
): (date: string) => Promise<number> {
  return async (date: string) =>
    eventsToCommittedHours(extractEvents(parseMcpJson(await options.callTool())), date);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/connectors test calendar`
Expected: PASS (all calendar tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @jarvis/connectors typecheck`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/calendar.ts packages/connectors/src/calendar.test.ts
git commit -m "feat(connectors): Calendar committed-hours provider (events → hours)"
```

---

### Task 3: Public API exports + coverage verification

**Files:**
- Modify: `packages/connectors/src/index.ts`
- Test: `packages/connectors/src/index.test.ts` (add assertions)

**Interfaces:**
- Consumes: everything produced by Tasks 1 and 2.
- Produces: `@jarvis/connectors` re-exports of the Gmail + Calendar entry points and their types.

- [ ] **Step 1: Add the failing export assertions**

In `packages/connectors/src/index.test.ts`: add `gmailConnector`, `calendarCommittedHours`, `eventsToCommittedHours` to the existing `from './index'` import, and add this `it` inside the existing top-level `describe` block:
```ts
  it('re-exports the Gmail and Calendar entry points', () => {
    expect(typeof gmailConnector).toBe('function');
    expect(typeof calendarCommittedHours).toBe('function');
    expect(eventsToCommittedHours([], '2026-07-14')).toBe(0);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarvis/connectors test index`
Expected: FAIL — `gmailConnector` / `calendarCommittedHours` / `eventsToCommittedHours` are not exported from `./index`.

- [ ] **Step 3: Add the re-exports to `index.ts`**

Append after the existing GitHub export block:
```ts
export {
  gmailConnector,
  gmailThreadsToTasks,
  extractThreads,
  type GmailThread,
  type GmailConnectorOptions,
} from './gmail';
export {
  calendarCommittedHours,
  eventsToCommittedHours,
  extractEvents,
  type EventDateTime,
  type CalendarEvent,
  type CalendarCommittedHoursOptions,
} from './calendar';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @jarvis/connectors test index`
Expected: PASS.

- [ ] **Step 5: Full package suite + typecheck + coverage**

Run: `pnpm --filter @jarvis/connectors typecheck && pnpm --filter @jarvis/connectors test -- --coverage`
Expected: no type errors; all connectors tests pass; `gmail.ts` and `calendar.ts` at 100% (or only defensive `??`/unreachable branches uncovered — record any residual in the report).

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/index.ts packages/connectors/src/index.test.ts
git commit -m "feat(connectors): export Gmail + Calendar entry points"
```

---

## What comes next (future plans, not this one)

- **MCP live wiring (app layer):** build real `callTool`s with `@modelcontextprotocol/sdk` for the GitHub / Gmail / Calendar MCP servers; add gmail + github connectors to `bin.ts`; call `calendarCommittedHours` and pass the result to `runDailyPlan({ committedHoursToday })`. Requires the user's tokens/OAuth setup and confirming the exact tool-result field shapes.
- Repo/label/query → stream mapping config for the source connectors.
- Single-binary distribution; `pollSources` / `endOfDayReview` jobs; Phase 2 (draft/execute).
