# Google OAuth Foundation + Live Calendar Committed-Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed real Google Calendar meeting hours into Jarvis's daily capacity via the official remote Calendar MCP server (`https://calendarmcp.googleapis.com/mcp/v1`), authenticated with a Google OAuth token Jarvis obtains once (`jarvis auth google`) and refreshes headlessly.

**Architecture:** `google-auth-library`'s `OAuth2Client` holds the client creds + tokens (persisted to `<dataRoot>/google-token.json`); its auto-refreshing access token is handed to the MCP SDK's `StreamableHTTPClientTransport` as a bearer `authProvider` — the same client pattern as the GitHub connector, only the token source differs. Calendar is a committed-hours *provider* `(date) => Promise<number>` (NOT a Connector: events aren't tasks); it feeds `runDailyPlan({ committedHoursToday })`. All of this lives in `apps/cli`; `packages/connectors` stays pure. This PR does Calendar only; Gmail reuses the same OAuth foundation next.

**Tech Stack:** TypeScript (ES2022, strict, `noUncheckedIndexedAccess`), pnpm, vitest, `@modelcontextprotocol/sdk` + `google-auth-library` (app layer only), Node ≥ 22 (native `http`, `URL`).

## Global Constraints

- **`packages/connectors` depends on `@jarvis/core` only.** `google-auth-library` and `@modelcontextprotocol/sdk` live ONLY in `apps/cli`.
- **MCP-only for data.** Calendar events are fetched via the MCP server. OAuth token exchange/refresh (google-auth-library ↔ Google's token endpoint) is *authentication*, not a data path.
- **Calendar is a committed-hours provider**, `(date) => Promise<number>`, feeding `runDailyPlan({ committedHoursToday })`. It is NOT a `Connector` and does NOT participate in source-authoritative task reconciliation.
- **Fail-safe gating:** with no Google OAuth client creds (env) OR no stored token, Jarvis behaves exactly as today (committed hours = 0, full capacity). A *runtime* calendar error must NOT break `jarvis plan` — the app layer catches it, uses 0, and warns on stderr.
- **OAuth:** `google-auth-library` `OAuth2Client`; `generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope })` to guarantee a refresh token; persist tokens to `<dataRoot>/google-token.json`; on the client's `'tokens'` event, MERGE into the stored creds so a refresh (which may omit `refresh_token`) never drops it.
- **Scope (this PR):** `https://www.googleapis.com/auth/calendar.readonly`.
- **Endpoint:** `https://calendarmcp.googleapis.com/mcp/v1`; bearer via SDK `authProvider: { token: async () => <access token> }`.
- **Node ≥ 22. English. Conventional Commits. No `Co-Authored-By: Claude` / "Generated with" trailers.**
- **TDD:** failing test first for every pure unit. The interactive OAuth loopback and the live MCP call are NOT unit-tested (they need Google creds + consent); they are verified once by the manual smoke test (final section). Unit tests cover: the connector date-passthrough, the token store, token-merge, env/gating, the auth-URL builder, the day-window builder, and the safe-provider wrapper.

---

### Task 1: `calendarCommittedHours` passes the date to its `callTool`

The committed-hours provider is called with a `date`, but its injected `callTool` currently takes no argument — so the app layer can't query that specific day. Thread the date through.

**Files:**
- Modify: `packages/connectors/src/calendar.ts`
- Modify: `packages/connectors/src/calendar.test.ts`

**Interfaces:**
- Produces: `CalendarCommittedHoursOptions { callTool: (date: string) => Promise<unknown> }`; `calendarCommittedHours(options): (date: string) => Promise<number>` (unchanged return, now passes `date` to `callTool`).

- [ ] **Step 1: Update the test to assert the date is forwarded**

In `packages/connectors/src/calendar.test.ts`, find the test(s) that build a `calendarCommittedHours` fetcher with a fake `callTool` and update them so `callTool` receives the date. Add/adjust a case:

```ts
it('passes the queried date to callTool and sums that day’s timed events', async () => {
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
```

(Keep the existing `eventsToCommittedHours` / `extractEvents` tests — only the `calendarCommittedHours` wiring changes.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @jarvis/connectors test -- calendar`
Expected: FAIL — the fake `callTool` now takes `date`, which the current arg-less signature doesn't pass (TS error / the `seen` assertion fails).

- [ ] **Step 3: Thread the date through**

In `packages/connectors/src/calendar.ts`, change the option type and the call:

```ts
export interface CalendarCommittedHoursOptions {
  /**
   * Calls the Calendar MCP server's event-listing tool for `date` (e.g.
   * list_events over that day) and resolves its raw result. Wired to a real
   * MCP client in the app layer. MUST reject on failure — a bad fetch must
   * never silently yield 0 committed hours (which would overstate capacity).
   */
  callTool: (date: string) => Promise<unknown>;
}

export function calendarCommittedHours(
  options: CalendarCommittedHoursOptions,
): (date: string) => Promise<number> {
  return async (date: string) =>
    eventsToCommittedHours(extractEvents(parseMcpJson(await options.callTool(date))), date);
}
```

- [ ] **Step 4: Run tests + typecheck to verify pass**

Run: `pnpm --filter @jarvis/connectors test -- calendar`
Expected: PASS.
Run: `pnpm --filter @jarvis/connectors typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/calendar.ts packages/connectors/src/calendar.test.ts
git commit -m "feat(connectors): calendarCommittedHours forwards the date to its callTool"
```

---

### Task 2: Google token store + OAuth client factory (`google-auth.ts`)

**Files:**
- Create: `apps/cli/src/google-auth.ts`
- Test: `apps/cli/src/google-auth.test.ts`
- Modify: `apps/cli/package.json` (add `google-auth-library`)

**Interfaces:**
- Produces:
  - `interface GoogleCreds { refresh_token?: string; access_token?: string; expiry_date?: number; scope?: string; token_type?: string }`
  - `googleTokenPath(dataRoot): string` — `<dataRoot>/google-token.json`
  - `readGoogleToken(dataRoot): GoogleCreds | undefined` — undefined if the file is absent/unreadable
  - `writeGoogleToken(dataRoot, creds): void`
  - `mergeCreds(existing, incoming): GoogleCreds` — incoming wins, but a missing `incoming.refresh_token` keeps `existing.refresh_token`
  - `googleClientConfigFromEnv(env): { clientId: string; clientSecret: string } | undefined`
  - `hasGoogleAuth(dataRoot, env): boolean` — true iff client creds present AND a stored refresh_token exists
  - `createOAuthClient(params: { clientId: string; clientSecret: string; redirectUri?: string; dataRoot: string }): OAuth2Client` — loads stored creds, persists merged creds on the `'tokens'` event
  - `googleAuthProvider(client: OAuth2Client): { token: () => Promise<string> }`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @jarvis/cli add google-auth-library`
Expected: `apps/cli/package.json` gains `google-auth-library`; lockfile updates.

- [ ] **Step 2: Write the failing tests**

Create `apps/cli/src/google-auth.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @jarvis/cli test -- google-auth`
Expected: FAIL (`./google-auth` does not exist).

- [ ] **Step 4: Implement `google-auth.ts`**

Create `apps/cli/src/google-auth.ts`:

```ts
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

/** Bearer provider for the MCP transport: an auto-refreshing access token. */
export function googleAuthProvider(client: OAuth2Client): { token: () => Promise<string> } {
  return {
    token: async () => {
      const { token } = await client.getAccessToken();
      if (!token) throw new Error('Google access token unavailable (run `jarvis auth google`)');
      return token;
    },
  };
}
```

- [ ] **Step 5: Run tests + typecheck to verify pass**

Run: `pnpm --filter @jarvis/cli test -- google-auth`
Expected: PASS.
Run: `pnpm --filter @jarvis/cli typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/google-auth.ts apps/cli/src/google-auth.test.ts apps/cli/package.json pnpm-lock.yaml
git commit -m "feat(cli): Google OAuth token store + client factory (auto-refresh, merge-safe)"
```

---

### Task 3: `jarvis auth google` one-time consent command (`auth-command.ts`)

**Files:**
- Create: `apps/cli/src/auth-command.ts`
- Test: `apps/cli/src/auth-command.test.ts`

**Interfaces:**
- Consumes: `createOAuthClient`, `writeGoogleToken`, `mergeCreds`, `readGoogleToken`, `googleClientConfigFromEnv` (google-auth.ts); `OAuth2Client` (google-auth-library).
- Produces:
  - `CALENDAR_SCOPES: string[]` — `['https://www.googleapis.com/auth/calendar.readonly']`
  - `buildConsentUrl(client: OAuth2Client, scopes: string[]): string` — offline + consent
  - `runGoogleAuth(deps: { dataRoot: string; env: Record<string, string | undefined>; out: (s: string) => void }): Promise<number>` — runs the loopback consent flow, stores tokens, returns an exit code.

- [ ] **Step 1: Write the failing tests (pure helper only)**

Create `apps/cli/src/auth-command.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { buildConsentUrl, CALENDAR_SCOPES } from './auth-command';

describe('buildConsentUrl', () => {
  it('requests offline access + consent + the calendar scope', () => {
    const client = new OAuth2Client({ clientId: 'i', clientSecret: 's', redirectUri: 'http://localhost:9/x' });
    const url = new URL(buildConsentUrl(client, CALENDAR_SCOPES));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:9/x');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @jarvis/cli test -- auth-command`
Expected: FAIL (`./auth-command` does not exist).

- [ ] **Step 3: Implement `auth-command.ts`**

Create `apps/cli/src/auth-command.ts`. The token exchange happens INSIDE the request handler because `getToken` must use the same `redirectUri` that was on the consent URL:

```ts
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
```

- [ ] **Step 4: Run tests + typecheck to verify the pure helper passes and the module compiles**

Run: `pnpm --filter @jarvis/cli test -- auth-command`
Expected: PASS (the `buildConsentUrl` test).
Run: `pnpm --filter @jarvis/cli typecheck`
Expected: no errors (the interactive flow compiles; it is exercised by the smoke test, not unit tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/auth-command.ts apps/cli/src/auth-command.test.ts
git commit -m "feat(cli): jarvis auth google — loopback OAuth consent, stores refresh token"
```

---

### Task 4: Calendar MCP committed-hours provider (`calendar-mcp.ts`)

**Files:**
- Create: `apps/cli/src/calendar-mcp.ts`
- Test: `apps/cli/src/calendar-mcp.test.ts`

**Interfaces:**
- Consumes: `Client`, `StreamableHTTPClientTransport` (SDK); `createOAuthClient`, `googleAuthProvider`, `googleClientConfigFromEnv`, `hasGoogleAuth` (google-auth.ts); `calendarCommittedHours` (`@jarvis/connectors`).
- Produces:
  - `dayWindow(date: string): { timeMin: string; timeMax: string }` — `${date}T00:00:00Z` .. `${date}T23:59:59Z`
  - `CALENDAR_MCP_URL = 'https://calendarmcp.googleapis.com/mcp/v1'`
  - `createCalendarProvider(params: { dataRoot: string; env: Record<string, string | undefined>; url?: string }): { committedHours: (date: string) => Promise<number>; close: () => Promise<void> } | undefined`

- [ ] **Step 1: Write the failing tests (pure + gating)**

Create `apps/cli/src/calendar-mcp.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @jarvis/cli test -- calendar-mcp`
Expected: FAIL (`./calendar-mcp` does not exist).

- [ ] **Step 3: Implement `calendar-mcp.ts`**

Create `apps/cli/src/calendar-mcp.ts`:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { calendarCommittedHours } from '@jarvis/connectors';
import { createOAuthClient, googleAuthProvider, googleClientConfigFromEnv, hasGoogleAuth } from './google-auth';

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
        const c = new Client({ name: 'jarvis', version: '0.1.0' });
        await c.connect(new StreamableHTTPClientTransport(new URL(url), { authProvider: googleAuthProvider(oauth) }));
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
```

- [ ] **Step 4: Run tests + typecheck to verify pass**

Run: `pnpm --filter @jarvis/cli test -- calendar-mcp`
Expected: PASS.
Run: `pnpm --filter @jarvis/cli typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/calendar-mcp.ts apps/cli/src/calendar-mcp.test.ts
git commit -m "feat(cli): live Calendar committed-hours provider via remote MCP + OAuth"
```

---

### Task 5: Wire `auth` command + committed-hours into the CLI

**Files:**
- Modify: `apps/cli/src/cli.ts`
- Modify: `apps/cli/src/cli.test.ts`
- Modify: `apps/cli/src/bin.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `runGoogleAuth` (auth-command.ts), `createCalendarProvider` (calendar-mcp.ts).
- `CliDeps` gains `committedHoursProvider?: (date: string) => Promise<number>` and `runAuth?: (provider: string) => Promise<number>`.

- [ ] **Step 1: Write the failing CLI tests**

In `apps/cli/src/cli.test.ts`, add:

```ts
it('threads committedHoursToday from the provider into the plan', async () => {
  let seenDate = '';
  const deps = makeDeps({
    committedHoursProvider: async (date) => {
      seenDate = date;
      return 2;
    },
  });
  // `plan` should invoke the provider with the plan date. Assert via a spy on runDailyPlan
  // is not available here; instead assert the provider was called with the right date.
  await runCli(['plan', '--date=2026-07-15'], deps);
  expect(seenDate).toBe('2026-07-15');
});

it('routes `auth google` to runAuth', async () => {
  let called = '';
  const deps = makeDeps({ runAuth: async (p) => { called = p; return 0; } });
  const code = await runCli(['auth', 'google'], deps);
  expect(called).toBe('google');
  expect(code).toBe(0);
});
```

> **Implementer note:** match the existing `cli.test.ts` style for building `deps` (there is already a helper/pattern for a fake `CliDeps` with a temp dataRoot + connectors). Add `committedHoursProvider` / `runAuth` to that pattern. If the existing tests construct deps inline rather than via a `makeDeps` helper, follow that inline style instead — do not introduce a helper the file doesn't already have.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @jarvis/cli test -- cli`
Expected: FAIL (`committedHoursProvider`/`runAuth` not on `CliDeps`; no `auth` route).

- [ ] **Step 3: Thread the provider + auth route through `cli.ts`**

In `apps/cli/src/cli.ts`:
- Extend `CliDeps`:
  ```ts
  export interface CliDeps {
    dataRoot: string;
    connectors: Connector[];
    today: string;
    out: (text: string) => void;
    committedHoursProvider?: (date: string) => Promise<number>;
    runAuth?: (provider: string) => Promise<number>;
  }
  ```
- Add an `auth` case to the command switch (before `help`):
  ```ts
  case 'auth': {
    const provider = argv[1];
    if (provider === undefined || deps.runAuth === undefined) {
      deps.out('Usage: jarvis auth google\n');
      return 1;
    }
    return deps.runAuth(provider);
  }
  ```
- In `showPlan` (and the `alerts` case) compute committed hours from the provider and pass it in:
  ```ts
  async function showPlan(deps: CliDeps, date: string): Promise<number> {
    const committedHoursToday = deps.committedHoursProvider ? await deps.committedHoursProvider(date) : undefined;
    const result = await runDailyPlan({ dataRoot: deps.dataRoot, connectors: deps.connectors, date, committedHoursToday });
    deps.out(fs.readFileSync(result.planPath, 'utf8'));
    return 0;
  }
  ```
  And in the `alerts` case, likewise compute `committedHoursToday = deps.committedHoursProvider ? await deps.committedHoursProvider(deps.today) : undefined` and pass it to `runDailyPlan`.
- Add `auth` to the `HELP` text: `  jarvis auth google       Authorize Google (Calendar) once`.

- [ ] **Step 4: Run tests + typecheck to verify pass**

Run: `pnpm --filter @jarvis/cli test -- cli`
Expected: PASS.
Run: `pnpm --filter @jarvis/cli typecheck`
Expected: no errors.

- [ ] **Step 5: Wire `bin.ts` (safe provider + auth command + lifecycle)**

In `apps/cli/src/bin.ts`, inside `main()` (after building connectors), add — and adjust the existing `runCli(...)`/`finally` to include these:

```ts
import { createCalendarProvider } from './calendar-mcp';
import { runGoogleAuth } from './auth-command';
// ...
const calendar = createCalendarProvider({ dataRoot, env: process.env });

// A calendar hiccup must never break the daily plan: fall back to 0 + warn.
const committedHoursProvider = calendar
  ? async (date: string): Promise<number> => {
      try {
        return await calendar.committedHours(date);
      } catch (error) {
        process.stderr.write(
          `Calendar unavailable, assuming 0 committed hours: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        return 0;
      }
    }
  : undefined;

try {
  return await runCli(process.argv.slice(2), {
    dataRoot,
    connectors,
    today: toISODate(new Date()),
    out: (text) => process.stdout.write(text),
    committedHoursProvider,
    runAuth: async (provider) =>
      provider === 'google'
        ? runGoogleAuth({ dataRoot, env: process.env, out: (t) => process.stdout.write(t) })
        : (process.stdout.write(`Unknown auth provider: ${provider}\n`), 1),
  });
} finally {
  if (github) await github.close();
  if (calendar) await calendar.close();
}
```

> **Implementer note:** merge this into the existing `main()` (which already builds `github` and has the `try/finally`). Keep the existing `github` wiring intact; add `calendar` alongside. Preserve the existing github `close()` guard.

- [ ] **Step 6: Add the changelog entry**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, append:

```markdown
- Google Calendar committed-hours: `jarvis auth google` (one-time OAuth) then real meeting hours reduce the day's capacity, via the remote Calendar MCP server (#15)
```

(Use the actual PR number when opening the PR.)

- [ ] **Step 7: Verify the whole package + folder-only/no-Google path**

Run: `pnpm --filter @jarvis/cli test`
Expected: PASS.
Run: `pnpm --filter @jarvis/cli typecheck`
Expected: no errors.
Run: `env -u GITHUB_PERSONAL_ACCESS_TOKEN -u GOOGLE_OAUTH_CLIENT_ID -u GOOGLE_OAUTH_CLIENT_SECRET JARVIS_HOME=$(mktemp -d) pnpm --filter @jarvis/cli exec tsx src/bin.ts help`
Expected: prints help (now including `auth google`), exit 0, no network.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/cli.ts apps/cli/src/cli.test.ts apps/cli/src/bin.ts CHANGELOG.md
git commit -m "feat(cli): wire jarvis auth google + calendar committed-hours into the plan"
```

---

## Final verification — live smoke test (manual, needs Kyle's Google setup)

Unit tests never touch Google. Verify the live path once (orchestrator + Kyle).

**One-time Google setup (Kyle):**
1. In Google Cloud Console: create/select a project → enable the **Google Calendar API**.
2. Configure the **OAuth consent screen** (External, add yourself as a test user).
3. Create an **OAuth client ID** of type **Desktop app** → copy the client ID + secret.
4. Put them in `~/jarvis/.env`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   ```

**Authorize + smoke:**
5. `pnpm jarvis auth google` → open the printed URL, sign in, approve → tokens land in `~/jarvis/google-token.json`.
6. `pnpm jarvis plan` → the plan's capacity is reduced by today's real meeting hours; the header shows the reduced capacity.

**If the live result differs from assumptions, adjust + add a regression test:**
- **Tool name/args:** if the server rejects `list_events` or the arg names (`timeMin`/`timeMax`/`calendarId`/`singleEvents`), probe the server's tool list, correct `calendar-mcp.ts`, and note it.
- **Result shape:** `extractEvents` accepts an array, `{ events }`, or `{ items }`. If the real payload nests differently (e.g. `{ items: [...] }` is already handled; a deeper wrapper is not), extend `extractEvents` in `packages/connectors/src/calendar.ts` and add a test with the captured shape.
- **Event time fields:** the mapper reads `start.dateTime` / `end.dateTime` (RFC3339). If the server returns a different field, adjust `eventsToCommittedHours` and test.
- **structuredContent vs text block:** if `parseMcpJson` throws "no text content", extend it (mcp.ts) to prefer `structuredContent`; add a test.

Then: `pnpm test && pnpm typecheck` (all green) and finish the branch.

---

## Self-review notes

- **Spec coverage:** date-passthrough (Task 1), OAuth token store + client (Task 2), consent command (Task 3), Calendar MCP provider + gating (Task 4), CLI/bin wiring + safe fallback + changelog (Task 5), live smoke (final). DIP honored — google-auth-library only in apps/cli.
- **Type consistency:** `GoogleCreds` produced in Task 2 is consumed in Tasks 3–4; `committedHoursProvider: (date) => Promise<number>` is produced in Task 4/5 and consumed by `runDailyPlan({ committedHoursToday })`; `createCalendarProvider` returns `{ committedHours, close }`, wrapped by bin.ts into the safe provider.
- **Fail-safe:** three gates — no client creds → provider undefined; no stored token → provider undefined; runtime error → 0 + stderr warning. None break `plan`/`help`.
- **Known limitation:** `dayWindow` uses UTC day bounds; the mapper filters by the event's local-date prefix (documented cross-midnight caveat carries over). Calendar id is hard-coded to `primary` (no multi-calendar config yet).
