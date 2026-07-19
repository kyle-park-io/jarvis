# Documentation Architecture — Design

**Goal:** give Jarvis a documentation set that answers four questions precisely — *what can it do*, *how do I start*, *what files does it touch*, and *where does new documentation go* — without the duplication that makes docs rot.

## The problem this solves

The root `README.md` currently claims Jarvis is in "design phase. Code is not scaffolded yet" and that execution runs on the Claude Agent SDK. Both are false: v0.2.0 shipped, and Phase 2 executes through the local `claude` CLI. It went stale because it restates facts owned elsewhere.

That is the failure mode to design against. Every fact restated in a second place is a fact that will eventually disagree with itself.

## Principle: one document answers one question

Each fact has exactly one **canonical** document. Everything else links to it rather than repeating it. `README.md` in particular keeps no facts of its own beyond a one-paragraph pitch — it becomes a link hub, so there is nothing in it left to go stale.

| File | Answers | Reader | State |
|---|---|---|---|
| `README.md` | "What is this?" (30 seconds) | first-time visitor | rewrite |
| `docs/capabilities.md` | **[0]** "What can it do?" | someone evaluating it | new |
| `docs/getting-started.md` | **[1]** "How do I start?" (prerequisites → first run) | someone adopting it | new |
| `docs/data-contract.md` | **[4a]** "What gets created where?" | user, operator | new |
| `docs/README.md` | **[3]** "Where does documentation go?" | contributor | new |
| `internal/usage-delta.md` | **[2]** internal-only delta | internal user | new, **uncommitted** |
| `docs/integrations.md` | "What does it call out to?" | — | exists |
| `docs/guides/*.md` | "How do I set up X?" | — | exists |
| `docs/plans/*.md` | "How was it built?" (history) | — | exists |
| `CLAUDE.md` | **[4b]** working rules for agents/contributors | — | add one section |

### Status vocabulary

Three markers, used consistently across every document: **✅ Live** · **⚠️ Gated** · **⛔ Not wired**.

`docs/integrations.md` already uses these; the other documents adopt them. This is the main reason `capabilities.md` exists as its own document: describing Google Calendar as "supported" would send a personal-Gmail user into a 30-minute dead end, because the official Calendar MCP server is gated to Workspace / Developer-Preview accounts. Capabilities must state what is *actually reachable*, not what code exists for.

## Public vs internal

An external user and an internal colleague overlap almost entirely — same install, same `config.yaml`, same commands, same local `~/jarvis`. Only three things differ: a Workspace account unlocks Google Calendar, org repositories may need SSO-authorized PATs and an execution-allowlist policy, and internal users escalate to a person rather than an issue.

Two parallel documents would therefore be ~85% duplicated and would drift. Instead, `docs/getting-started.md` is the single canonical guide, and `internal/usage-delta.md` carries only the delta.

`internal/` is **not committed** — added to `.gitignore`, following the existing precedent of `design/`, which stays local because it carries personal work context. Once the repository is public, organization names, repository allowlists, and internal conventions must not be in it.

## [3] Governance — `docs/README.md`

A decision tree that answers "should I even create a file?" before "where does it go?":

1. Does it belong to one of the four canonical documents (`capabilities`, `getting-started`, `data-contract`, `integrations`)? → **edit that file. Do not create a new one.**
2. Is it a self-contained setup procedure (e.g. an external account)? → `docs/guides/<topic>.md`
3. Is it an implementation plan? → `docs/plans/YYYY-MM-DD-<topic>.md` — **immutable history, not edited afterward**
4. Does it carry personal or organizational context? → `design/` or `internal/` (uncommitted)

Conventions: kebab-case filenames; date prefixes only in `plans/`; **committed documentation is English**, `design/` stays Korean (per `CLAUDE.md`).

## [4b] Development artifacts — `CLAUDE.md`

Documentation updates are pinned to triggers, so the obligation is mechanical rather than remembered:

| When this changes | Update |
|---|---|
| a command is added or changed | `capabilities.md` + `data-contract.md` + the CLI `HELP` string |
| prerequisites or secrets change | `getting-started.md` + `.env.example` + `integrations.md` |
| an integration's status changes | `integrations.md` (+ `capabilities.md` if it is user-visible) |
| anything user-facing | one `CHANGELOG.md` `[Unreleased]` line, tagged `(#N)` |

The existing changelog rule already lives in `CLAUDE.md` → Working rules; this extends it to the rest of the documentation set.

## [4a] Runtime contract — `docs/data-contract.md`

Classifies everything under `~/jarvis` (or `JARVIS_HOME`) by lifecycle, which is what a user actually needs to know to back up, reset, or debug it:

- **Input** (human-authored): `config.yaml`, `.env`, `streams/*.md`
- **State** (machine-owned; deleting loses history or forces re-auth): `jarvis.db`, `google-token.json`
- **Output** (machine-written, human-read): `plans/YYYY-MM-DD.md`, `audit.log`
- **Scratch** (safe to delete anytime): `work/<owner>-<repo>-<N>-<ts>/`

Plus a command → reads / writes / external side effects table, verified against the code. Two facts there are non-obvious and are the reason the document earns its place:

1. **`today`, `plan`, and `alerts` are all writes.** All three call `runDailyPlan`, which reconciles the database and writes `plans/<date>.md`. `alerts` is not read-only, and `jarvis plan --date=<past-date>` overwrites that date's plan file.
2. **Connector sync is source-authoritative.** `syncSourceTasks` deletes tasks that have disappeared from their source, so removing a repository from `config.yaml` removes its tasks on the next run.

The document also states what to back up (`config.yaml`, `streams/`, `jarvis.db`) versus what is disposable (`work/`, `plans/`), and notes that `work/` currently has no automatic cleanup — manual deletion is safe.

## Non-goals

- **Translations.** `docs/i18n/README.<lang>.md` arrives at v1.0.0 per `CLAUDE.md` → Versioning & release. Translating documents that are about to change is wasted work.
- **A documentation site generator.** Markdown on GitHub is sufficient pre-1.0.
- **Per-package READMEs.** Package boundaries are already described in `CLAUDE.md`; five thin READMEs would be five more things to keep in sync.
- **A CONTRIBUTING.md.** `CLAUDE.md` already carries the working rules. Revisit when outside contributors actually appear.
