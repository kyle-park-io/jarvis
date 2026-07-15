import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  googleTokenPath,
  readGoogleToken,
  writeGoogleToken,
  mergeCreds,
  googleClientConfigFromEnv,
  hasGoogleAuth,
  createOAuthClient,
} from './google-auth';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-goog-'));
}

describe('google token store', () => {
  it('round-trips creds to <dataRoot>/google-token.json', () => {
    const dir = tmp();
    expect(readGoogleToken(dir)).toBeUndefined();
    writeGoogleToken(dir, { refresh_token: 'r', access_token: 'a', expiry_date: 123 });
    expect(googleTokenPath(dir)).toBe(path.join(dir, 'google-token.json'));
    expect(readGoogleToken(dir)).toEqual({ refresh_token: 'r', access_token: 'a', expiry_date: 123 });
  });

  it('returns undefined for an unreadable/absent token file', () => {
    expect(readGoogleToken(tmp())).toBeUndefined();
  });
});

describe('mergeCreds', () => {
  it('keeps the existing refresh_token when a refresh response omits it', () => {
    const merged = mergeCreds({ refresh_token: 'keep', access_token: 'old' }, { access_token: 'new', expiry_date: 9 });
    expect(merged).toEqual({ refresh_token: 'keep', access_token: 'new', expiry_date: 9 });
  });

  it('lets an incoming refresh_token override', () => {
    expect(mergeCreds({ refresh_token: 'old' }, { refresh_token: 'new' }).refresh_token).toBe('new');
  });
});

describe('googleClientConfigFromEnv', () => {
  it('reads the OAuth client id/secret', () => {
    expect(googleClientConfigFromEnv({ GOOGLE_OAUTH_CLIENT_ID: 'i', GOOGLE_OAUTH_CLIENT_SECRET: 's' })).toEqual({
      clientId: 'i',
      clientSecret: 's',
    });
  });

  it('returns undefined when either is missing/empty', () => {
    expect(googleClientConfigFromEnv({ GOOGLE_OAUTH_CLIENT_ID: 'i' })).toBeUndefined();
    expect(googleClientConfigFromEnv({ GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: 's' })).toBeUndefined();
    expect(googleClientConfigFromEnv({})).toBeUndefined();
  });
});

describe('hasGoogleAuth', () => {
  it('is true only with client creds AND a stored refresh_token', () => {
    const dir = tmp();
    const env = { GOOGLE_OAUTH_CLIENT_ID: 'i', GOOGLE_OAUTH_CLIENT_SECRET: 's' };
    expect(hasGoogleAuth(dir, env)).toBe(false); // no token yet
    writeGoogleToken(dir, { access_token: 'a' }); // no refresh_token
    expect(hasGoogleAuth(dir, env)).toBe(false);
    writeGoogleToken(dir, { refresh_token: 'r' });
    expect(hasGoogleAuth(dir, env)).toBe(true);
    expect(hasGoogleAuth(dir, {})).toBe(false); // no client creds
  });
});

describe("createOAuthClient 'tokens' listener", () => {
  it('persists refreshed tokens, merging so refresh_token is never dropped', () => {
    const dir = tmp();
    writeGoogleToken(dir, { refresh_token: 'keep', access_token: 'old' });
    const client = createOAuthClient({ clientId: 'i', clientSecret: 's', dataRoot: dir });
    client.emit('tokens', { access_token: 'new', expiry_date: 42 });
    expect(readGoogleToken(dir)).toEqual({ refresh_token: 'keep', access_token: 'new', expiry_date: 42 });
  });
});
