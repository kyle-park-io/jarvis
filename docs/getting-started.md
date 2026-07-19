# Getting started

The path from a fresh clone to your first daily plan.

For what each command does once it's running, see
[capabilities.md](capabilities.md) — this document does not restate the
command list.

## Prerequisites

Required:

- Node **>=20**
- pnpm
- git

Everything else is optional, and only unlocks a specific feature:

| Optional | Unlocks |
|---|---|
| A GitHub personal access token with issue read | The GitHub issues connector |
| `gh` CLI, logged in | `pnpm jarvis do` |
| `claude` CLI, logged in (Claude subscription) | `pnpm jarvis do` |
| A Google **Workspace** account | Calendar committed-hours |

**Personal `@gmail.com` accounts cannot use Calendar.** The official Calendar
MCP server is gated to Workspace / Developer-Preview accounts and returns
`The caller does not have permission` for personal Gmail — this is Google's
restriction, not a misconfiguration. Don't spend time on it unless you have a
Workspace account. See [integrations.md](integrations.md) for the full story.

## Setup

There is no build step — the CLI runs directly from source via `tsx`.

### 1. Clone and install

```bash
git clone https://github.com/kyle-park-io/jarvis.git
cd jarvis
pnpm install
```

### 2. Create the data directory

Jarvis keeps all runtime data (config, tasks, plans) **outside this code
repo**, in a data root: `~/jarvis` by default, or the `JARVIS_HOME`
environment variable if set. This guide uses the default.

```bash
mkdir -p ~/jarvis/streams
```

### 3. Write `~/jarvis/config.yaml`

Keys and defaults are defined in `packages/store/src/config.ts`. The schema
is strict — an unknown key is a hard parse error, so start from exactly this
and add to it deliberately:

```yaml
dailyCapacityHours: 8
streams:
  - id: personal
    name: Personal
    weeklyBudgetHours: 8
```

### 4. Write your first stream file

Create `~/jarvis/streams/personal.md`. Two rules aren't obvious from looking
at the file, so both matter:

- The **filename** (minus `.md`) is the stream id, and it must match a
  `streams[].id` in `config.yaml` — `streams/personal.md` pairs with the
  `personal` stream above.
- Each line is `- [ ] Title @YYYY-MM-DD ~Nh`: `@date` is an optional
  deadline, `~Nh` is an optional hour estimate, and `- [x]` marks a task
  done. Both modifiers can be omitted, as in the second line below.

```markdown
# Personal
- [ ] Draft the quarterly plan @2026-07-24 ~3h
- [ ] Reply to the design thread
```

### 5. Run it

```bash
pnpm jarvis today
```

This prints today's plan and writes `~/jarvis/plans/<today's date>.md`. There
is no `jarvis` binary on `PATH` — every command is invoked through the root
`pnpm jarvis <command>` script.

## Secrets

Secrets live in `<dataRoot>/.env` (default `~/jarvis/.env`), never in this
repo. Copy the template and fill in only what you need:

```bash
cp .env.example ~/jarvis/.env
```

See [`.env.example`](../.env.example) for the full list of variables and what
each one is for.

## Optional: the GitHub connector

1. Put `GITHUB_PERSONAL_ACCESS_TOKEN` in `~/jarvis/.env`.
2. Add a `github.repos` entry to `config.yaml`, mapping a repository to a
   stream:

   ```yaml
   github:
     repos:
       - repo: owner/name
         stream: personal
   ```

## Optional: `jarvis do` (execution)

`jarvis do <owner/repo#N>` drafts a PR for a GitHub issue. It requires the
`gh` and `claude` CLIs from the prerequisites above, plus an explicit
allowlist entry — add the repository to `execution.repos`:

```yaml
execution:
  repos:
    - owner/name
```

**Safety property:** Jarvis only ever pushes a new branch and opens a
**draft** PR in an isolated clone. It never modifies `main`, and a repository
not listed in `execution.repos` is refused outright — including when
`config.yaml` itself is missing or unreadable, which falls back to an empty
allowlist rather than an open one.

## Optional: Google Calendar

Committed-hours support requires a Google **Workspace** account (see
Prerequisites above) and a one-time OAuth setup. Follow
[`docs/guides/google-calendar-setup.md`](guides/google-calendar-setup.md) —
that guide owns the setup steps, so they aren't repeated here.

## Next steps

- [capabilities.md](capabilities.md) — every command and feature, with an
  honest status marker for each.
- [integrations.md](integrations.md) — the external services, MCP servers,
  and credentials behind those features.
