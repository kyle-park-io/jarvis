# Data contract

What Jarvis creates on disk, where, and what breaks if you delete it. This is
the canonical description of the data root — [capabilities.md](capabilities.md)
owns what each command does and its status, [getting-started.md](getting-started.md)
owns setup steps, and [integrations.md](integrations.md) owns external
services, MCP servers, and secrets. None of those facts are repeated here;
only reads/writes/deletion consequences are.

## The data root

Every path below is relative to the data root, resolved once at process
startup: the `JARVIS_HOME` environment variable if it's set, otherwise
`~/jarvis` (`packages/store/src/paths.ts`). It's an ordinary directory that
Jarvis creates lazily, entirely separate from this code repo. One consequence
worth flagging up front: secrets load from `<dataRoot>/.env`, not from a
`.env` in this repo (`apps/cli/src/bin.ts`) — see
[integrations.md](integrations.md) for what belongs in it.

## Lifecycle

What matters about a path isn't its format, it's what you lose by deleting it.

| Path | Lifecycle | Written by | If you delete it |
|---|---|---|---|
| `config.yaml` | **Input** (human-authored) | you | no streams, budgets, or connector config until you rewrite it — nothing regenerates it. |
| `.env` | **Input** (human-authored) | you | every credential-gated feature reverts to its unconfigured state (fail-safe, not a crash). |
| `streams/*.md` | **Input** (human-authored) | you | that stream's folder tasks disappear from the database on the next sync, not just from the file. |
| `jarvis.db` | **State** (machine-owned) | `today` / `plan` / `alerts` / `log` | all logged history — every task's status and every logged hour — is gone; every connector re-syncs from scratch next run. |
| `google-token.json` | **State** (machine-owned) | `auth google` | Calendar stops working until you run `pnpm jarvis auth google` again — re-auth, not data loss. |
| `plans/YYYY-MM-DD.md` | **Output** (machine-written, human-read) | `today` / `plan` / `alerts` | nothing of lasting value — regenerated the next time any of those three runs for that date. |
| `audit.log` | **Output** (machine-written, human-read) | `do` | that run's Phase 2 execution record is gone; nothing regenerates it, so it's worth backing up if that history matters to you. |
| `work/<owner>-<repo>-<N>-<ts>/` | **Scratch** | `do` | nothing. Safe to delete anytime — nothing reads it back. |

## Command → effects

| Command | Reads | Writes | External side effects |
|---|---|---|---|
| `pnpm jarvis today` | `config.yaml`, `streams/*.md`, `jarvis.db` | `jarvis.db`, `plans/<date>.md` | GitHub MCP server + Calendar MCP server, each only when configured |
| `pnpm jarvis plan [--date=D]` | `config.yaml`, `streams/*.md`, `jarvis.db` | `jarvis.db`, `plans/<D>.md` | same as `today` |
| `pnpm jarvis alerts` | `config.yaml`, `streams/*.md`, `jarvis.db` | `jarvis.db`, `plans/<date>.md` | same as `today` |
| `pnpm jarvis log <stream> <hours>` | `jarvis.db` | `jarvis.db` | none |
| `pnpm jarvis auth google` | `.env` (client id/secret), `google-token.json` (existing creds, if any) | `google-token.json` | Google OAuth consent + token exchange, via a local loopback server |
| `pnpm jarvis do <owner/repo#N>` | `config.yaml` (`execution.repos` allowlist), the issue itself via `gh issue view` | `audit.log`, `work/<owner>-<repo>-<N>-<ts>/` | `gh` (clone, push, draft-PR creation) and the local `claude` CLI, confined to the isolated clone |

`today`, `plan`, and `alerts` all reconcile the database and (re)write that
date's plan file — `alerts` writing a file despite its read-only-sounding name
is deliberate, not a bug: all three run the identical daily-plan pipeline
(`apps/cli/src/cli.ts`, `packages/scheduler/src/pipeline.ts`).

One nuance the table simplifies: `log`'s own command logic never reads
`config.yaml` — only `jarvis.db`. `config.yaml` is read at process startup
(`apps/cli/src/bin.ts`) to wire up the GitHub connector before dispatching to
*any* command, `log` included, but that read is defensive — a missing or
unreadable `config.yaml` is swallowed there, not surfaced as an error, so
`log` works with or without one. Similarly, although `.env` is loaded at
process startup, the `do` command never reads any `.env`-sourced value.

## Surprises

The failure modes below can't be deduced from the CLI's output — each one is
a real way to lose data or get confusing results without an error message
telling you why.

1. **Renaming a task loses its history.** A folder task's id is
   `folder:<streamId>:<title>` — derived from the title, not a stable
   identifier (`packages/connectors/src/parse.ts`). Combined with the next
   surprise, editing a task's title in `streams/*.md` creates a brand-new
   task on the next sync and deletes the old one — its logged hours and
   status go with it.

2. **Removing a source removes its tasks.** Sync is source-authoritative:
   after pulling from a source, Jarvis deletes every database row from that
   source whose id didn't come back in this pull (`packages/store/src/repository.ts`).
   Drop a repository from `config.yaml`, or rename a task's title as above,
   and its rows vanish from `jarvis.db` on the very next run — not just from
   the plan.

3. **But a missing token strands them instead.** With no
   `GITHUB_PERSONAL_ACCESS_TOKEN`, the GitHub connector is never registered
   at all (`apps/cli/src/bin.ts`), so nothing syncs that source — its issues
   don't get deleted like surprise #2, they just linger in `jarvis.db`
   forever, stale and un-updated, until the token comes back.

4. **A past-dated `plan` overwrites that day's file.** `pnpm jarvis plan
   --date=2026-01-01` writes straight to `plans/2026-01-01.md`
   (`packages/store/src/plan-writer.ts`) — there's no "don't touch history"
   guard. Re-running a plan for a past date replaces whatever was there.

5. **Calendar failures are silent by design.** If the Calendar MCP call
   throws, Jarvis catches it, assumes 0 committed hours, prints one warning
   to stderr, and lets the plan run anyway (`apps/cli/src/bin.ts`) — it never
   fails the command. Fail-safe on purpose, but it means a broken Calendar
   integration can go unnoticed unless you're watching stderr.

6. **`work/` is never cleaned up.** Every `do` run leaves its isolated clone
   behind under `work/<owner>-<repo>-<N>-<ts>/`; nothing in Jarvis deletes it,
   ever (`packages/agent/src/executor.ts`). It grows one directory per run.
   Deleting any or all of it is always safe — see Lifecycle above.

## Backup and reset

**Back up:** `config.yaml`, `streams/`, `jarvis.db`. These are the only paths
Jarvis cannot regenerate on its own — `jarvis.db` in particular holds every
logged hour and every task's status, not just a cache of it.

**Disposable** — delete freely, Jarvis rebuilds or you re-run one command:

- `work/` — scratch clones; see Surprises #6.
- `plans/` — every file regenerates the next time `today`, `plan`, or
  `alerts` runs for that date.
- `google-token.json` — delete it, then run `pnpm jarvis auth google` again.

**Never commit** `.env` or `google-token.json` to any git repository — both
are live credentials, not application data. Jarvis never writes them into
this code repo itself; the only risk is a user copying them somewhere they
shouldn't.

**Full reset:** delete the entire data root and start over from
[getting-started.md](getting-started.md).
