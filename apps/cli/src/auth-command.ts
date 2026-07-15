import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OAuth2Client } from 'google-auth-library';
import {
  createOAuthClient,
  writeGoogleToken,
  mergeCreds,
  readGoogleToken,
  googleClientConfigFromEnv,
  type GoogleCreds,
} from './google-auth';

export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

export function buildConsentUrl(client: OAuth2Client, scopes: string[]): string {
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes });
}

export type Callback =
  | { kind: 'code'; code: string }
  | { kind: 'error'; error: string }
  | { kind: 'ignore' };

/** Classify an OAuth loopback callback URL: an auth code, a denial/error, or a stray request. */
export function classifyCallback(rawUrl: string): Callback {
  const params = new URL(rawUrl, 'http://localhost').searchParams;
  const code = params.get('code');
  if (code) return { kind: 'code', code };
  const error = params.get('error');
  if (error) return { kind: 'error', error };
  return { kind: 'ignore' };
}

/** Run the loopback OAuth consent flow and persist the resulting tokens. */
export async function runGoogleAuth(deps: {
  dataRoot: string;
  env: Record<string, string | undefined>;
  out: (s: string) => void;
}): Promise<number> {
  const cfg = googleClientConfigFromEnv(deps.env);
  if (!cfg) {
    deps.out('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in <dataRoot>/.env first.\n');
    return 1;
  }

  return new Promise<number>((resolve) => {
    // Assigned in listen() (which runs before any request) so the handler closure sees it.
    let client: OAuth2Client | undefined;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const server = http.createServer((req, res) => {
      void (async () => {
        const result = classifyCallback(req.url ?? '/');
        if (!client || result.kind === 'ignore') {
          res.writeHead(404).end('Waiting for the OAuth callback...');
          return;
        }
        if (result.kind === 'error') {
          res.writeHead(400).end('Authorization denied.');
          deps.out(`Authorization denied: ${result.error}\n`);
          settle(1);
          return;
        }
        try {
          const { tokens } = await client.getToken(result.code);
          writeGoogleToken(deps.dataRoot, mergeCreds(readGoogleToken(deps.dataRoot) ?? {}, tokens as GoogleCreds));
          res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Jarvis is authorized. You can close this tab.');
          deps.out('Authorized — tokens saved.\n');
          settle(0);
        } catch (error) {
          res.writeHead(500).end('Authorization failed.');
          deps.out(`Authorization failed: ${error instanceof Error ? error.message : String(error)}\n`);
          settle(1);
        }
      })();
    });

    // Clear the timeout, close the server, and resolve — at most once.
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      server.close();
      resolve(code);
    };

    server.on('error', (error) => {
      deps.out(`Auth server error: ${error.message}\n`);
      settle(1);
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      client = createOAuthClient({ ...cfg, redirectUri: `http://127.0.0.1:${port}/oauth2callback`, dataRoot: deps.dataRoot });
      deps.out(`\nOpen this URL, sign in, and approve:\n\n  ${buildConsentUrl(client, CALENDAR_SCOPES)}\n\nWaiting for the redirect...\n`);
      timer = setTimeout(() => {
        deps.out('Timed out waiting for authorization (5 min). Run `jarvis auth google` again.\n');
        settle(1);
      }, 5 * 60_000);
    });
  });
}
