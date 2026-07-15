import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { calendarCommittedHours } from '@jarvis/connectors';
import { createOAuthClient, googleClientConfigFromEnv, hasGoogleAuth } from './google-auth';

export const CALENDAR_MCP_URL = 'https://calendarmcp.googleapis.com/mcp/v1';

/** UTC day bounds for a `YYYY-MM-DD` date, used as the list_events window. */
export function dayWindow(date: string): { timeMin: string; timeMax: string } {
  return { timeMin: `${date}T00:00:00Z`, timeMax: `${date}T23:59:59Z` };
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
        arguments: { calendarId: 'primary', singleEvents: true, ...dayWindow(date) },
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
