import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { calendarCommittedHours } from '@jarvis/connectors';
import { createOAuthClient, googleClientConfigFromEnv, hasGoogleAuth } from './google-auth';

// LIMITATION (verified 2026-07-16): the official remote Calendar MCP server
// below is gated to Google Workspace accounts / the Workspace Developer Preview
// Program. A personal @gmail account gets "The caller does not have permission"
// on every tool call even with both APIs enabled and the three required scopes
// granted — that is Google's account restriction, not a client bug (the token,
// scopes, connection, and tool-call format are all verified correct). Jarvis
// stays fail-safe: no usable token → 0 committed hours; a runtime permission
// error is caught in bin.ts → 0 hours + a stderr warning, so `jarvis plan`
// never breaks. To support personal accounts, point this at a LOCAL Google MCP
// server that wraps the plain Calendar API (which does work for personal
// accounts). See docs/guides/google-calendar-setup.md.
export const CALENDAR_MCP_URL = 'https://calendarmcp.googleapis.com/mcp/v1';

/**
 * `list_events` time bounds (its arg names are `startTime`/`endTime`) covering
 * `date` with a ±1-day margin, so events aren't missed when the user's timezone
 * offsets the day out of a strict UTC window; the mapper then filters to the
 * exact local date.
 */
export function dayWindow(date: string): { startTime: string; endTime: string } {
  const base = Date.parse(`${date}T00:00:00Z`);
  return {
    startTime: new Date(base - 86_400_000).toISOString(),
    endTime: new Date(base + 86_400_000).toISOString(),
  };
}

/**
 * Build the live Calendar committed-hours provider, or undefined when Google
 * isn't set up (no client creds or no stored token) — Jarvis then assumes 0
 * committed hours. The MCP client connects lazily on the first query, so
 * commands that never query touch no network.
 */
export function createCalendarProvider(params: {
  dataRoot: string;
  env: Record<string, string | undefined>;
  url?: string;
}): { committedHours: (date: string) => Promise<number>; close: () => Promise<void> } | undefined {
  const cfg = googleClientConfigFromEnv(params.env);
  if (!cfg || !hasGoogleAuth(params.dataRoot, params.env)) return undefined;

  const oauth = createOAuthClient({ ...cfg, dataRoot: params.dataRoot });
  const url = params.url ?? CALENDAR_MCP_URL;
  let client: Client | undefined;
  let connecting: Promise<Client> | undefined;

  const ensureClient = async (): Promise<Client> => {
    if (client) return client;
    if (!connecting) {
      connecting = (async () => {
        // Fetch a valid access token (refreshing + persisting via the client's
        // 'tokens' listener if the stored one has expired). It's valid ~1h —
        // longer than any single CLI run — so a static Bearer header suffices,
        // exactly like the GitHub connector.
        const { token } = await oauth.getAccessToken();
        if (token === null || token === undefined) {
          throw new Error('Google access token unavailable — run `jarvis auth google`');
        }
        const c = new Client({ name: 'jarvis', version: '0.1.0' });
        await c.connect(
          new StreamableHTTPClientTransport(new URL(url), {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
          }),
        );
        client = c;
        return c;
      })();
    }
    return connecting;
  };

  const committedHours = calendarCommittedHours({
    callTool: async (date) => {
      const c = await ensureClient();
      return c.callTool({
        name: 'list_events',
        arguments: { calendarId: 'primary', ...dayWindow(date) },
      });
    },
  });

  return {
    committedHours,
    close: async () => {
      if (client) await client.close();
    },
  };
}
