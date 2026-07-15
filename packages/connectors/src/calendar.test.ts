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

  it("passes the queried date to callTool and sums that day's timed events", async () => {
    const seen: string[] = [];
    const fetch = calendarCommittedHours({
      callTool: async (date) => {
        seen.push(date);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                events: [
                  { start: { dateTime: `${date}T09:00:00Z` }, end: { dateTime: `${date}T10:30:00Z` } },
                ],
              }),
            },
          ],
        };
      },
    });
    await expect(fetch('2026-07-15')).resolves.toBe(1.5);
    expect(seen).toEqual(['2026-07-15']);
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
