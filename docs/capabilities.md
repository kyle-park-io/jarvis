# Capabilities

What Jarvis can actually do today, command by command and feature by feature,
with an honest status marker for each. This is the canonical list — other
documents link here rather than restate it.

## Status legend

- **✅ Live** — shipped and working.
- **⚠️ Gated** — built, but blocked by something outside this codebase (an
  account tier, a permission, an allowlist).
- **⛔ Not wired** — code may exist somewhere in the repo, but nothing calls
  it from the CLI.

## Commands

Every command Jarvis has, run as `pnpm jarvis <command>` (there is no `jarvis`
binary on `PATH`).

| Command | What it does | Status |
|---|---|---|
| `pnpm jarvis today` | Show today's plan | ✅ Live |
| `pnpm jarvis plan [--date=D]` | Show the plan for a date (default: today) | ✅ Live |
| `pnpm jarvis alerts` | Show today's alerts | ✅ Live |
| `pnpm jarvis log <stream> <hours> [--date=D]` | Log hours worked on a stream | ✅ Live |
| `pnpm jarvis auth google` | Authorize Google (Calendar) once | ✅ Live |
| `pnpm jarvis do <owner/repo#N>` | Draft a PR for an issue (allowlisted repos) | ✅ Live (experimental) |
| `pnpm jarvis help` | Show this help | ✅ Live |

**`today`, `plan`, and `alerts` all write** — despite `alerts` sounding
read-only, all three call the same daily-plan pipeline, which reconciles the
database against every connector and (re)writes that date's `plans/<date>.md`
file. `log` is the odd one out: it only appends a time-log entry to the
database and does not regenerate the plan file. See
[data-contract.md](data-contract.md) for the exact file/DB format and what
each command reads and writes.

## Capabilities

| Capability | Status | Notes |
|---|---|---|
| Weekly-budget allocation, daily plan, time logging, alerts (dropped balls / falling behind) | ✅ Live | The core planning engine — computes each day's allocation from every stream's weekly budget and flags streams that are falling behind or have a dropped ball. |
| Folder connector (`streams/*.md`) | ✅ Live | Reads tasks from `<dataRoot>/streams/*.md`. |
| GitHub issues connector | ✅ Live | Needs a GitHub personal access token. See [integrations.md](integrations.md). |
| Google Calendar committed hours | ⚠️ Gated | The official Calendar MCP server is restricted to Google Workspace / Developer-Preview accounts, so a personal `@gmail.com` account cannot use it. See [integrations.md](integrations.md) for the full story. |
| Gmail | ⛔ Not wired | No connector is wired in. |
| `jarvis do` → draft PR | ✅ Live (experimental) | Allowlist-gated: the target repo must be listed under `execution.repos` in `config.yaml`, and a missing or unreadable config falls back to an empty allowlist — refusing by default rather than executing. |
| Scheduler daemon (unattended runs) | ⛔ Not wired | The `@jarvis/scheduler` package exists, but no CLI command starts it — every run today is triggered manually. |
