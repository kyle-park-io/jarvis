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

    const server = http.createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const code = url.searchParams.get('code');
        if (!code || !client) {
          res.writeHead(400).end('Missing ?code');
          return;
        }
        try {
          const { tokens } = await client.getToken(code);
          writeGoogleToken(deps.dataRoot, mergeCreds(readGoogleToken(deps.dataRoot) ?? {}, tokens as GoogleCreds));
          res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Jarvis is authorized. You can close this tab.');
          deps.out('Authorized — tokens saved.\n');
          server.close();
          resolve(0);
        } catch (error) {
          res.writeHead(500).end('Authorization failed.');
          deps.out(`Authorization failed: ${error instanceof Error ? error.message : String(error)}\n`);
          server.close();
          resolve(1);
        }
      })();
    });

    server.on('error', (error) => {
      deps.out(`Auth server error: ${error.message}\n`);
      resolve(1);
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      client = createOAuthClient({ ...cfg, redirectUri: `http://localhost:${port}/oauth2callback`, dataRoot: deps.dataRoot });
      deps.out(`\nOpen this URL, sign in, and approve:\n\n  ${buildConsentUrl(client, CALENDAR_SCOPES)}\n\nWaiting for the redirect...\n`);
    });
  });
}
