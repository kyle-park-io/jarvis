# External integrations

The exact external services, MCP servers, APIs, and credentials Jarvis uses (or
is built to use). Kept accurate to the code — update it when an integration
lands or changes.

**Design rule:** connectors pull *data* only through **MCP servers** (never
raw REST). MCP/SDK clients live only in the app layer (`apps/cli`);
`packages/connectors` and `packages/core` stay pure. OAuth token exchange is an
*auth* mechanism, not a data path. Everything is fail-safe: a missing
credential or config means Jarvis runs without that source, never crashes.

---

## At a glance

| Integration | Via | Server / endpoint | Tool(s) | Auth | Status |
|---|---|---|---|---|---|
| **GitHub** | Official remote MCP server | `https://api.githubcopilot.com/mcp/` | `list_issues` | `GITHUB_PERSONAL_ACCESS_TOKEN` (Bearer) | ✅ **Live** |
| **Google Calendar** | Official remote MCP server | `https://calendarmcp.googleapis.com/mcp/v1` | `list_events` | Google OAuth 2.0 (Bearer access token) | ⚠️ **Built, gated** |
| **Gmail** | Official remote MCP server (planned) | `https://gmailmcp.googleapis.com/mcp/v1` | TBD | Google OAuth 2.0 | ⛔ **Not wired** |
| **Claude Agent SDK** | Local library (Phase 2) | runs in-process | built-in Read/Write/Edit/Bash | `ANTHROPIC_API_KEY` | ⛔ **Not built** |
| **Folder** | Local filesystem | `<dataRoot>/streams/*` | — | none | ✅ Live (not external) |

---

## GitHub — live

- **What:** pulls open issues from configured repos and maps them to tasks.
- **MCP server:** the official GitHub remote MCP server, `https://api.githubcopilot.com/mcp/` (Streamable HTTP transport).
- **Tool:** `list_issues` (args `owner`, `repo`, `state`, `perPage`, cursor `after`). Cursor-paginated: Jarvis walks all pages (cap 10 pages / 1000 issues).
- **Auth:** a (fine-grained) **personal access token** with issue read — `GITHUB_PERSONAL_ACCESS_TOKEN`, sent as `Authorization: Bearer <token>`. Available to all GitHub accounts (no Copilot subscription needed for issue reads).
- **Client:** `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` in `apps/cli/src/github-mcp.ts`; pure mapper in `packages/connectors/src/github.ts`.
- **Config:** `config.yaml` `github: { repos: [{ repo: "owner/name", stream: "<id>" }] }`. No token or no config → folder-only (fail-safe).

## Google Calendar — built, gated

- **What:** committed-hours provider — sums the day's meeting hours and subtracts them from the day's capacity.
- **MCP server:** the official Calendar remote MCP server, `https://calendarmcp.googleapis.com/mcp/v1` (HTTP).
- **Tool:** `list_events` (args `calendarId: "primary"`, `startTime`, `endTime`).
- **Auth:** Google **OAuth 2.0** — a Bearer access token obtained once via `jarvis auth google` and auto-refreshed. Required scopes:
  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
  - `https://www.googleapis.com/auth/calendar.events.freebusy`
  - `https://www.googleapis.com/auth/calendar.events.readonly`
- **Required Google Cloud setup:** enable **Google Calendar API** *and* **Google Calendar MCP API** (`calendarmcp.googleapis.com`) in the OAuth client's project; a Desktop OAuth client. See [`docs/guides/google-calendar-setup.md`](guides/google-calendar-setup.md).
- **Client:** `@modelcontextprotocol/sdk` transport + `google-auth-library` in `apps/cli/src/{calendar-mcp,google-auth,auth-command}.ts`; pure mapper in `packages/connectors/src/calendar.ts`.
- **⚠️ Status:** the official remote server is **gated to Google Workspace / Developer-Preview accounts** — a personal `@gmail.com` account gets `The caller does not have permission`. Fail-safe (0 committed hours). The path to support personal accounts is a **local** Google MCP server wrapping the plain Calendar API.

## Google OAuth — auth mechanism (not a data path)

Backs Calendar (and future Gmail). `google-auth-library`'s `OAuth2Client` runs the one-time loopback consent (`jarvis auth google`), stores the refresh token in `~/jarvis/google-token.json`, and mints/refreshes access tokens against Google's OAuth endpoints. Client creds: `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.

## Gmail — planned

Pure mapper exists (`packages/connectors/src/gmail.ts`); not wired. The official Gmail MCP server (`https://gmailmcp.googleapis.com/mcp/v1`) almost certainly has the same Workspace gate as Calendar, so a **local** Google MCP server is the likely path.

## Claude Agent SDK — Phase 2 (not built)

The execution engine for Phase 2 (`jarvis do <issue>` → draft PR). `@anthropic-ai/claude-agent-sdk` runs the agent loop locally (built-in Read/Write/Edit/Bash tools), edits code in an isolated worktree, and a `PostToolUse` hook writes an audit log. **Auth = `ANTHROPIC_API_KEY`** (the Agent SDK does not permit claude.ai/subscription login for SDK-built agents). `gh` CLI is used to open the **draft PR** (the approval gate). Not yet in the code.

---

## Client libraries (app layer only)

| Library | Used for | Where |
|---|---|---|
| `@modelcontextprotocol/sdk` | MCP client transport (GitHub, Calendar) | `apps/cli` |
| `google-auth-library` | Google OAuth token lifecycle | `apps/cli` |
| `@anthropic-ai/claude-agent-sdk` | Phase 2 execution engine (planned) | `apps/cli` / `packages/agent` |
| `gh` CLI | draft-PR creation (Phase 2); dev/testing | external tool |

## Secrets & where they live

All secrets live in **`<dataRoot>/.env`** (default `~/jarvis/.env`), outside the code repo; loaded natively on startup. Template: [`.env.example`](../.env.example).

| Secret | Integration | Status |
|---|---|---|
| `GITHUB_PERSONAL_ACCESS_TOKEN` | GitHub MCP | used now |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google Calendar/Gmail MCP | used when Google is set up |
| `ANTHROPIC_API_KEY` | Claude Agent SDK (Phase 2) | not used yet |

Derived/stored credentials: `~/jarvis/google-token.json` (Google refresh token, written by `jarvis auth google`). Both `.env` and `google-token.json` sit in the data directory and are never committed.
