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
   * Calls the Calendar MCP server's event-listing tool for `date` (e.g.
   * list_events over that day) and resolves its raw result. Wired to a real
   * MCP client in the app layer. MUST reject on failure — a bad fetch must
   * never silently yield 0 committed hours (which would overstate capacity).
   */
  callTool: (date: string) => Promise<unknown>;
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
    eventsToCommittedHours(extractEvents(parseMcpJson(await options.callTool(date))), date);
}
