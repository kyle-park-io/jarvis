import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dayWindow, createCalendarProvider } from './calendar-mcp';

describe('dayWindow', () => {
  it('spans the UTC day for a date', () => {
    expect(dayWindow('2026-07-15')).toEqual({ timeMin: '2026-07-15T00:00:00Z', timeMax: '2026-07-15T23:59:59Z' });
  });
});

describe('createCalendarProvider (gating)', () => {
  const env = { GOOGLE_OAUTH_CLIENT_ID: 'i', GOOGLE_OAUTH_CLIENT_SECRET: 's' };

  it('returns undefined without client creds', () => {
    expect(createCalendarProvider({ dataRoot: os.tmpdir(), env: {} })).toBeUndefined();
  });

  it('returns undefined without a stored refresh token', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cal-'));
    expect(createCalendarProvider({ dataRoot: dir, env })).toBeUndefined();
  });

  it('returns a provider when creds + token are present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cal-'));
    fs.writeFileSync(path.join(dir, 'google-token.json'), JSON.stringify({ refresh_token: 'r' }));
    const provider = createCalendarProvider({ dataRoot: dir, env });
    expect(typeof provider?.committedHours).toBe('function');
  });
});
