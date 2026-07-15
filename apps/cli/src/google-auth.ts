import fs from 'node:fs';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';

/** The subset of OAuth2 credentials Jarvis persists. */
export interface GoogleCreds {
  refresh_token?: string;
  access_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
}

export function googleTokenPath(dataRoot: string): string {
  return path.join(dataRoot, 'google-token.json');
}

export function readGoogleToken(dataRoot: string): GoogleCreds | undefined {
  try {
    return JSON.parse(fs.readFileSync(googleTokenPath(dataRoot), 'utf8')) as GoogleCreds;
  } catch {
    return undefined;
  }
}

export function writeGoogleToken(dataRoot: string, creds: GoogleCreds): void {
  fs.writeFileSync(googleTokenPath(dataRoot), `${JSON.stringify(creds, null, 2)}\n`);
}

/** Incoming creds win, except a missing refresh_token keeps the existing one. */
export function mergeCreds(existing: GoogleCreds, incoming: GoogleCreds): GoogleCreds {
  return { ...existing, ...incoming, refresh_token: incoming.refresh_token ?? existing.refresh_token };
}

export function googleClientConfigFromEnv(
  env: Record<string, string | undefined>,
): { clientId: string; clientSecret: string } | undefined {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (clientId === undefined || clientId === '' || clientSecret === undefined || clientSecret === '') {
    return undefined;
  }
  return { clientId, clientSecret };
}

export function hasGoogleAuth(dataRoot: string, env: Record<string, string | undefined>): boolean {
  return googleClientConfigFromEnv(env) !== undefined && readGoogleToken(dataRoot)?.refresh_token !== undefined;
}

/**
 * Build an OAuth2Client seeded with any stored creds. Refreshed tokens are
 * merged back into <dataRoot>/google-token.json via the 'tokens' event so a
 * refresh that omits refresh_token never drops it.
 */
export function createOAuthClient(params: {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  dataRoot: string;
}): OAuth2Client {
  const client = new OAuth2Client({
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    redirectUri: params.redirectUri,
  });
  const stored = readGoogleToken(params.dataRoot);
  if (stored) client.setCredentials(stored);
  client.on('tokens', (tokens) => {
    writeGoogleToken(params.dataRoot, mergeCreds(readGoogleToken(params.dataRoot) ?? {}, tokens as GoogleCreds));
  });
  return client;
}
