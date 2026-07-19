# Documentation Architecture — Design & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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
- **Adding a `bin` entry to `@jarvis/cli`.** Today there is none, so the only way to run Jarvis is `pnpm jarvis <command>` (see Verified facts F1). Documenting reality is in scope; changing the CLI's packaging is a code change and belongs in its own PR.

---

# Implementation Plan

**Architecture:** Six documentation tasks, ordered so that canonical facts land before the documents that link to them. Tasks 1–3 write the three new canonical documents; Task 4 empties `README.md` into a link hub that points at them; Task 5 writes the governance rules that describe the resulting structure; Task 6 adds the uncommitted internal delta.

**Tech Stack:** Markdown only. No code changes, no dependency changes. Verification is `pnpm test` (must stay green — it should be untouched), plus running the documented commands to confirm they work as written.

## Global Constraints

- **English.** Every committed document is English (`CLAUDE.md` → Language convention). Only `design/` stays Korean.
- **Status vocabulary is exactly three markers:** `✅ Live`, `⚠️ Gated`, `⛔ Not wired`. Never invent a fourth.
- **No fact appears in two documents.** If a fact already has a canonical home, link to it — do not restate it. This is the entire point of the design; violating it recreates the bug being fixed.
- **Every command shown must run as written.** There is no `jarvis` binary — always `pnpm jarvis <command>` (Verified fact F1). Do not write `jarvis today`.
- **Cite nothing that was not checked.** Every factual claim about behaviour must come from the Verified facts table below or from a fresh reading of the code. Do not infer behaviour from names.
- **Conventional Commits**; no `Co-Authored-By: Claude` or "Generated with" trailers.
- **No `CHANGELOG.md` entry.** `CLAUDE.md` → Working rules exempts docs-only PRs.

## Verified facts

These were confirmed against the code on 2026-07-20. Every task depends on them; none of them is guessable from names.

| # | Fact | Evidence |
|---|---|---|
| **F1** | There is **no `bin` field** in `@jarvis/cli` and no global `jarvis` on PATH. The CLI runs via the root script `pnpm jarvis <command>` (`"jarvis": "pnpm --filter @jarvis/cli exec tsx src/bin.ts"`). | `apps/cli/package.json`; root `package.json` scripts |
| **F2** | `today`, `plan`, and `alerts` **all write**. Each calls `runDailyPlan`, which reconciles the DB and calls `writePlan` → `plans/<date>.md`. `alerts` is not read-only. | `apps/cli/src/cli.ts:33-55,109-119`; `packages/scheduler/src/pipeline.ts` |
| **F3** | `jarvis plan --date=<past-date>` writes/overwrites that date's plan file. | `packages/store/src/plan-writer.ts:38` |
| **F4** | Connector sync is **source-authoritative**: `syncSourceTasks` deletes rows whose id vanished from that source's pull. | `packages/store/src/repository.ts:100-111` |
| **F5** | A folder task's id is `folder:<streamId>:<title>` — **derived from the title**. Editing a title creates a new task and (via F4) deletes the old one, losing its logged history. | `packages/connectors/src/parse.ts:22` |
| **F6** | A stream file's id comes from its **filename** (`mantle.md` → `mantle`); it must match a `streams[].id` in `config.yaml`. Non-`.md` files are ignored. | `packages/connectors/src/folder.ts:11-13` |
| **F7** | Stream line grammar: `- [ ] Title @YYYY-MM-DD ~Nh`; `@` = deadline, `~` = estimate hours, both optional; `- [x]` = done. An invalid date is dropped silently, keeping the task. | `packages/connectors/src/parse.ts:3-5,27-30` |
| **F8** | Data root resolution: `JARVIS_HOME` env var, else `~/jarvis`. | `packages/store/src/paths.ts:5-7` |
| **F9** | Secrets load from `<dataRoot>/.env` via `process.loadEnvFile` — **not** from the repo. Missing file is fine. | `apps/cli/src/bin.ts:18-25` |
| **F10** | If `GITHUB_PERSONAL_ACCESS_TOKEN` is absent the GitHub connector is never registered, so (per F4) previously synced GitHub tasks are **not** deleted — they go stale in the DB rather than disappearing. | `apps/cli/src/bin.ts:36-40` |
| **F11** | Calendar failure is swallowed: committed hours fall back to `0` with a stderr warning; the plan still runs. | `apps/cli/src/bin.ts:52-59` |
| **F12** | `jarvis do` gates on `config.yaml` `execution.repos`; unreadable config falls back to an empty allowlist (refuse). It reads the issue via `gh issue view`. | `apps/cli/src/bin.ts:78-99` |
| **F13** | `do` writes `<dataRoot>/audit.log` and clones into `<dataRoot>/work/<owner>-<repo>-<N>-<ts>/`. Nothing deletes `work/`. | `apps/cli/src/bin.ts:107-111`; `packages/agent/src/executor.ts:87` |
| **F14** | Requires Node `>=20`, pnpm workspaces. Root scripts are only `test`, `typecheck`, `jarvis` — there is **no `build` script**. | root `package.json` |
| **F15** | Google Calendar's official MCP server is gated to Workspace / Developer-Preview accounts; personal Gmail gets `The caller does not have permission`. | `docs/integrations.md`; `apps/cli/src/calendar-mcp.ts` comment |

---

### Task 1: `docs/capabilities.md` — what Jarvis can do

**Files:**
- Create: `docs/capabilities.md`

**Interfaces:**
- Produces: the canonical list of commands and feature status. Tasks 4 and 5 link here; no other document may restate the command list.

- [ ] **Step 1: Write the command reference**

One row per command, taken from the CLI `HELP` string in `apps/cli/src/cli.ts:18-28` — `today`, `plan [--date=D]`, `alerts`, `log <stream> <hours> [--date=D]`, `auth google`, `do <owner/repo#N>`, `help`. For each: what it does, and its status marker.

Write commands as `pnpm jarvis <command>` (F1).

State plainly that `today`/`plan`/`alerts` write a plan file (F2) — link to `data-contract.md` for the detail rather than repeating it. That link will resolve once Task 3 lands; write it now.

- [ ] **Step 2: Write the capability/status table**

Cover, with honest markers:

- Weekly-budget allocation, daily plan, time logging, alerts (dropped balls / falling behind) — `✅ Live`
- Folder connector (`streams/*.md`) — `✅ Live`
- GitHub issues connector — `✅ Live`, needs a PAT
- Google Calendar committed hours — `⚠️ Gated`, and say why in one sentence: the official MCP server is restricted to Workspace / Developer-Preview accounts, so a personal `@gmail.com` cannot use it (F15). Link to `integrations.md` for the full story.
- Gmail — `⛔ Not wired`
- `jarvis do` → draft PR — `✅ Live`, experimental, allowlist-gated (F12)
- Scheduler daemon (unattended runs) — `⛔ Not wired`: the package exists but nothing in the CLI starts it

- [ ] **Step 3: Verify every status claim**

Run each command and confirm the documented status:

```bash
pnpm jarvis help
pnpm jarvis today
pnpm jarvis alerts
```

Expected: `help` prints the same command list the document contains; `today` and `alerts` succeed. Confirm the scheduler claim: `grep -rn "startScheduler\|croner" apps/cli/src/` returns nothing, proving the daemon is genuinely not wired.

If any command's real behaviour differs from what you wrote, the document is wrong — fix the document, not the command.

- [ ] **Step 4: Commit**

```bash
git add docs/capabilities.md
git commit -m "docs: add a capabilities reference with honest status markers"
```

---

### Task 2: `docs/getting-started.md` — prerequisites through first run

**Files:**
- Create: `docs/getting-started.md`

**Interfaces:**
- Consumes: the command names from Task 1 (link, do not restate the full list).
- Produces: the canonical prerequisites and setup sequence. Task 4 and Task 6 link here.

- [ ] **Step 1: Write the prerequisites section**

Required: Node `>=20`, pnpm, git (F14). Optional, each with what it unlocks:

- a GitHub PAT with issue read → the GitHub connector
- `gh` CLI, logged in → `jarvis do`
- `claude` CLI, logged in → `jarvis do` (subscription login; **no `ANTHROPIC_API_KEY`**)
- a Google **Workspace** account → Calendar (F15); say explicitly that personal Gmail will not work, so nobody burns time on it

- [ ] **Step 2: Write the setup sequence**

Clone → `pnpm install` → create the data directory → write `config.yaml` → run. There is no build step (F14).

Explain the data root: `~/jarvis` by default, overridable with `JARVIS_HOME` (F8). Secrets go in `<dataRoot>/.env`, never in the repo (F9) — link to `.env.example` rather than duplicating it.

Include a minimal working `config.yaml`. Keys and defaults come from `packages/store/src/config.ts`; the schema is `.strict()`, so an unknown key is a hard parse error — say so.

```yaml
dailyCapacityHours: 8
streams:
  - id: personal
    name: Personal
    weeklyBudgetHours: 8
```

Then the first stream file, `<dataRoot>/streams/personal.md`. State the two rules that are invisible otherwise: the **filename** is the stream id and must match a `streams[].id` (F6), and the line grammar is `- [ ] Title @YYYY-MM-DD ~Nh` with both modifiers optional, `- [x]` meaning done (F7).

```markdown
# Personal
- [ ] Draft the quarterly plan @2026-07-24 ~3h
- [ ] Reply to the design thread
```

Finish with `pnpm jarvis today`.

- [ ] **Step 3: Add the optional GitHub and execution sections**

GitHub: put `GITHUB_PERSONAL_ACCESS_TOKEN` in `<dataRoot>/.env`, add a `github.repos` entry mapping a repository to a stream. `jarvis do`: add the repository to `execution.repos`, and state the safety property — Jarvis only ever pushes a branch and opens a **draft** PR; `main` is never modified (F12).

For Calendar, link to `docs/guides/google-calendar-setup.md`. Do not restate the setup steps.

- [ ] **Step 4: Verify the guide by following it literally**

Use a throwaway data root so your real `~/jarvis` is untouched:

```bash
export JARVIS_HOME=$(mktemp -d)
mkdir -p "$JARVIS_HOME/streams"
# write config.yaml and streams/personal.md exactly as the document shows them
pnpm jarvis today
```

Expected: a plan referencing the tasks you wrote, and `$JARVIS_HOME/plans/<today>.md` created (F2). Then `unset JARVIS_HOME`.

Every copy-pasted block must work unmodified. If one does not, fix the document.

- [ ] **Step 5: Commit**

```bash
git add docs/getting-started.md
git commit -m "docs: add a getting-started guide verified end to end"
```

---

### Task 3: `docs/data-contract.md` — what gets created where

**Files:**
- Create: `docs/data-contract.md`

**Interfaces:**
- Produces: the canonical description of the data root. Tasks 1, 4, and 5 link here.

- [ ] **Step 1: Write the lifecycle classification**

Open by resolving the data root: `JARVIS_HOME`, else `~/jarvis` (F8). Then classify every path by lifecycle, because that is what tells a reader whether losing it matters:

- **Input** (human-authored): `config.yaml`, `.env`, `streams/*.md`
- **State** (machine-owned; deleting loses history or forces re-auth): `jarvis.db`, `google-token.json`
- **Output** (machine-written, human-read): `plans/YYYY-MM-DD.md`, `audit.log`
- **Scratch** (safe to delete anytime): `work/<owner>-<repo>-<N>-<ts>/`

- [ ] **Step 2: Write the command → effects table**

Columns: command · reads · writes · external side effects. Fill from F2, F9, F12, F13. The rows that matter most:

- `today` / `plan` / `alerts`: read `config.yaml`, `streams/*.md`, `jarvis.db`; **write** `plans/<date>.md` and `jarvis.db`; call the GitHub MCP server and Calendar when configured
- `log`: reads `config.yaml`, writes `jarvis.db`, no external calls
- `auth google`: writes `google-token.json`, talks to Google OAuth
- `do`: reads `config.yaml` (allowlist) and `.env`; writes `audit.log` and `work/…`; externally clones, pushes a branch, and opens a **draft PR**

Call out that `alerts` writing a plan file is deliberate, not a bug (F2).

- [ ] **Step 3: Write the surprises section**

These are the failure modes a user cannot deduce, and the strongest reason this document exists:

1. **Renaming a task loses its history.** A folder task's id is `folder:<streamId>:<title>` (F5), and sync deletes ids that disappear (F4) — so an edited title is a brand-new task and the old one's logged hours go with it.
2. **Removing a source removes its tasks.** Drop a repository from `config.yaml` and its issues vanish from the DB on the next run (F4).
3. **But a missing token strands them instead.** With no `GITHUB_PERSONAL_ACCESS_TOKEN` the connector is never registered, so nothing syncs that source and its old tasks linger stale (F10).
4. **A past-dated `plan` overwrites that day's file** (F3).
5. **Calendar failures are silent by design** — 0 committed hours plus a stderr warning; the plan still runs (F11).
6. **`work/` is never cleaned up** (F13). Deleting it is always safe.

- [ ] **Step 4: Write the backup and reset section**

Back up: `config.yaml`, `streams/`, `jarvis.db`. Disposable: `work/`, `plans/` (regenerated on the next run), `google-token.json` (re-run `pnpm jarvis auth google`). Never commit `.env` or `google-token.json`.

- [ ] **Step 5: Verify the table against a real run**

```bash
export JARVIS_HOME=$(mktemp -d)
mkdir -p "$JARVIS_HOME/streams"
printf 'dailyCapacityHours: 8\nstreams:\n  - id: personal\n    name: Personal\n    weeklyBudgetHours: 8\n' > "$JARVIS_HOME/config.yaml"
printf '# Personal\n- [ ] Test task ~2h\n' > "$JARVIS_HOME/streams/personal.md"
pnpm jarvis alerts
ls -R "$JARVIS_HOME"
```

Expected: `alerts` created both `jarvis.db` and `plans/<today>.md` — the direct proof of F2. Then verify F5 by editing the task's title, re-running, and confirming via `sqlite3 "$JARVIS_HOME/jarvis.db" 'select id from tasks'` that the old id is gone and a new one exists. Then `unset JARVIS_HOME`.

- [ ] **Step 6: Commit**

```bash
git add docs/data-contract.md
git commit -m "docs: document the runtime data contract and its surprises"
```

---

### Task 4: rewrite `README.md` as a link hub

**Files:**
- Modify: `README.md` (full rewrite)

**Interfaces:**
- Consumes: `docs/capabilities.md`, `docs/getting-started.md`, `docs/data-contract.md`, `docs/integrations.md`.

- [ ] **Step 1: Delete the false claims**

The current file says Jarvis is in "design phase. Code is not scaffolded yet" (line 5) and that execution uses the **Claude Agent SDK** (line 14). Both are wrong: v0.2.0 shipped and Phase 2 runs on the local `claude` CLI with no API key. Remove them.

- [ ] **Step 2: Rewrite as a hub**

Keep: the one-paragraph pitch, the "Why" paragraph, the roadmap phases, the licence. Replace the status line with the real state (v0.2.0 released; Phase 2 shipped and experimental).

Add a documentation table linking to the four canonical documents plus `docs/guides/` and `docs/plans/`.

Everything else becomes a link. The README must contain **no** command list, **no** installation steps, **no** stack version numbers and **no** integration status — every one of those is owned by another document now. That is what stops it going stale again.

Leave the `packages/{…}` / `apps/{…}` structure sketch, but drop the word "planned" — the packages exist.

- [ ] **Step 3: Verify no duplication and no dead links**

```bash
grep -nE "pnpm jarvis|jarvis (today|plan|alerts|log|do|auth)" README.md
```

Expected: **no output**. Any hit means a command list crept back in.

Then confirm every relative link resolves:

```bash
grep -oE '\]\([^):]+\)' README.md | sed -E 's/^\]\(//; s/\)$//' | while read -r f; do
  test -e "$f" || echo "DEAD: $f"
done
```

Expected: no `DEAD:` lines. (The `[^):]` class skips `http:` links, so only relative paths are checked.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README as a link hub and drop stale claims"
```

---

### Task 5: governance — `docs/README.md` and the `CLAUDE.md` section

**Files:**
- Create: `docs/README.md`
- Modify: `CLAUDE.md` (add one section under Working rules)

**Interfaces:**
- Consumes: every document from Tasks 1–4.
- Produces: the rules that keep the structure intact.

- [ ] **Step 1: Write the documentation map**

`docs/README.md` opens with the map: each file, the one question it answers, and its reader. Copy the table from the design section above.

- [ ] **Step 2: Write the decision tree**

Verbatim from the design — it answers "should I create a file at all?" before "where does it go?":

1. Belongs to one of the four canonical documents (`capabilities`, `getting-started`, `data-contract`, `integrations`)? → **edit that file; do not create a new one**
2. A self-contained setup procedure? → `docs/guides/<topic>.md`
3. An implementation plan? → `docs/plans/YYYY-MM-DD-<topic>.md`, **immutable history — not edited after the work lands**
4. Personal or organizational context? → `design/` or `internal/`, uncommitted

Then the conventions: kebab-case; date prefixes only in `plans/`; committed docs in English, `design/` in Korean.

State the single rule the whole structure rests on: **one fact, one home — link, never restate.**

- [ ] **Step 3: Add the trigger table to `CLAUDE.md`**

Add a `## Documentation` section immediately after `## Working rules`, containing the trigger table from the design (command changed → `capabilities.md` + `data-contract.md` + CLI `HELP`; prerequisites/secrets changed → `getting-started.md` + `.env.example` + `integrations.md`; integration status changed → `integrations.md` + `capabilities.md`; anything user-facing → `CHANGELOG.md`).

The existing changelog bullet in Working rules already states the changelog rule — link to it, do not restate it. Add one line pointing at `docs/README.md` as the map.

- [ ] **Step 4: Verify the map matches reality**

```bash
find docs -name '*.md' | sort
```

Expected: every file listed appears in the `docs/README.md` map, and every file in the map exists. A file in one but not the other is a defect — fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add docs/README.md CLAUDE.md
git commit -m "docs: add the documentation map and update triggers"
```

---

### Task 6: internal delta — `internal/usage-delta.md`, uncommitted

**Files:**
- Create: `internal/usage-delta.md` (**never committed**)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `docs/getting-started.md` (Task 2) as the base guide.

- [ ] **Step 1: Ignore `internal/` first**

Do this **before** creating the file, so it can never be staged by accident. Add to `.gitignore`, next to the existing `design/` entry and following its comment style:

```gitignore
# Internal-only docs (org names, repo allowlists) — kept out of the public repo
internal/
```

- [ ] **Step 2: Write the delta — only what differs**

`internal/usage-delta.md` opens by pointing at `docs/getting-started.md` as the base and stating that only differences live here. Then the three real deltas:

1. **Google Calendar works here.** A Workspace account clears the gate that blocks personal Gmail (F15), so Calendar committed-hours is usable internally. Link to `docs/guides/google-calendar-setup.md`.
2. **Org repositories need an SSO-authorized PAT.** A PAT must be authorized for the organization before the GitHub connector can read its issues.
3. **Execution allowlist policy.** Which repositories may appear in `execution.repos`, and who decides. Keep this short — the safety property (draft PR only, `main` untouched) is already in `getting-started.md`; do not restate it.

Close with who to ask when stuck.

Resist adding anything that is not a difference. Every sentence duplicated from the public guide is a sentence that will drift.

- [ ] **Step 3: Verify it is genuinely ignored**

```bash
git status --porcelain
git check-ignore -v internal/usage-delta.md
```

Expected: `git status` shows **only** the `.gitignore` change — `internal/` must not appear as untracked. `git check-ignore` must print the matching rule. If the file shows up as untracked, the ignore rule is wrong; fix it before continuing.

- [ ] **Step 4: Commit the ignore rule only**

```bash
git add .gitignore
git commit -m "chore: keep internal-only docs out of the repo"
```

---

### Task 7: final consistency pass

**Files:**
- Modify: any document found inconsistent

- [ ] **Step 1: Check the whole suite for restated facts**

The design's core rule is one fact, one home. Verify it held:

```bash
grep -rn "ANTHROPIC_API_KEY\|Agent SDK" README.md docs/*.md
```

Expected: mentions only in `docs/integrations.md` (which owns the "not used" explanation). Any other hit is duplication or a stale claim.

```bash
grep -rln "pnpm jarvis" README.md docs/*.md
```

Expected: `capabilities.md`, `getting-started.md`, `data-contract.md` — **not** `README.md`.

- [ ] **Step 2: Check status markers are the agreed three**

```bash
grep -rhoE "✅ [A-Za-z]+|⚠️ [A-Za-z]+|⛔ [A-Za-z ]+" README.md docs/*.md | sort -u
```

Expected: only `✅ Live`, `⚠️ Gated`, `⛔ Not wired`. A fourth marker means the vocabulary drifted — fix it.

- [ ] **Step 3: Confirm no code was touched**

```bash
git diff --stat main -- '*.ts' '*.json'
```

Expected: empty. This is a docs-only change; a `.ts` or `package.json` diff means something out of scope crept in.

```bash
pnpm test
```

Expected: all suites pass, unchanged from `main`.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "docs: fix cross-document inconsistencies"
```

Skip this commit if the checks were clean.
