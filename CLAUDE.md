# CLAUDE.md — Jarvis

A personal chief-of-staff task agent. It manages several concurrent work streams by their **weekly time budgets** — computing "how much of what to do today," detecting dropped balls (cracks), and executing some tasks on your behalf. For developers and non-developers alike.

> **Full spec + the "why" behind every decision: `design/jarvis-task-agent-design.md`** (Korean; kept local, not committed — it carries personal work context).
> **Implementation plans are committed** in [`docs/plans/`](./docs/plans/) (English). Only the personal-context spec stays local in `design/`.
> This file is the summary + working rules. Read the design doc when you need detail.

## Language convention

- **Code, comments, identifiers, and this `CLAUDE.md` → English.**
- The design doc (`design/jarvis-task-agent-design.md`, local-only) stays in Korean as the reference spec.
- Commit messages → English.

## Current status

Design v0.1 done. **Code is not scaffolded yet.** Next step = write the implementation plan → **Phase 1 (MVP)**.

## Locked stack

- **TypeScript monorepo + pnpm workspaces** (this is the agent-orchestration layer, so not Go).
- Execution engine: the **local `claude` CLI** driven headlessly (`claude -p … --output-format json` in an isolated worktree — Claude Code as the agent harness). Auth = ① a Claude subscription login — what Phase 2 shipped with, **no API key** — or ② `ANTHROPIC_API_KEY` / the Claude Agent SDK for always-on/serverless (design §8.2, §12.2).
- Scheduler **croner** (⚠️ not node-cron — DST/timezone correctness) · store **better-sqlite3** (`node:sqlite` optional on Node 26+) · validation **zod** · file-watch **chokidar** · tests **vitest** · build **tsup** (2026 alternative: tsdown).

## Structure (planned)

```
packages/{core, store, connectors, agent, scheduler}
apps/{cli, web, bot, mcp}
```

- **`core`** = the pure allocation engine. **No I/O, no external deps.** Dependency arrows always point toward `core`. **Target 100% test coverage.**
- Runtime data source: **`~/jarvis`** — SQLite `tasks.db` + human-readable `plans/YYYY-MM-DD.md`. **Separate from this code repo.**

## Automation phases

Phase 1 intelligent planner (MVP, read-only) → Phase 2 semi-auto (drafts + isolated-branch → draft PR, where **the PR itself is the approval gate**) → Phase 3 autonomous.

## Versioning & release

Pre-1.0, unreleased. All packages are `private` at `0.0.0`; nothing is published or tagged yet. SemVer is declared (see `CHANGELOG.md`) but not yet practiced.

- **Scheme: git tags, no tooling.** To release: cut `CHANGELOG.md`'s `[Unreleased]` into `## [x.y.z] - YYYY-MM-DD`, bump the workspace `package.json` versions, then `git tag vX.Y.Z` + a GitHub Release. Version-automation (changesets etc.) waits until we publish to npm — YAGNI until then.
- **Milestones:** `v0.1.0` = first tagged MVP release → … → `v1.0.0` = first stable.
- **README at v1.0.0:** at v1.0.0 the root `README.md` becomes a polished, multi-language landing page (in the spirit of [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)). GitHub markdown is static, so "language selection" = a language-switcher row at the top linking per-language files. Languages: **English (default, `README.md`), Korean, Chinese, Japanese**, with translations under `docs/i18n/README.<lang>.md` (`ko` / `zh` / `ja`).

## Engineering principles

These are SOLID applied to this codebase, plus the ones that matter more for an agent. Concrete and checkable — not slogans.

- **Single responsibility (SRP).** One package = one purpose; one file = one focus. When a file grows past its focus, split it.
- **Dependency inversion (DIP).** All dependency arrows point at `core`; `core` depends on nothing. I/O is injected via interfaces (`store`, `connectors`) — never imported into `core`.
- **Open/closed via plugins (OCP).** Add a connector, scheduler backend, or frontend by *implementing an interface*, not by editing `core`. A new source must not require a core change.
- **Small, segregated interfaces (ISP).** Keep contracts minimal (e.g. `Connector.pull/watch/act`); don't force implementers to stub methods they don't use.
- **YAGNI.** Build the current phase only — no speculative abstraction. Phases 2–3 are roadmap, not scaffolding to write now.
- **Testable by construction.** Pure `core` + injected I/O means logic is unit-testable without mocks. TDD `core`, target 100%.
- **Fail safe.** Execution (Phase 2/3) is a no-op outside the config allowlist; never mutate `main` or send anything without passing an approval gate.

## Working rules

- **Phase 2 execution runs only within a config allowlist (permitted repos / task types) + audit log.** `main` never changes until a human merges.
- Prefer human-readable output — also emit state as `plans/*.md` (the folder is the dashboard).
- When a decision changes, update the design doc first, then refresh this summary.
- **Changelog:** every PR with a user-facing change adds a one-line entry to `CHANGELOG.md` under the matching `[Unreleased]` category (Added / Changed / Fixed / Deprecated / Removed / Security), tagged `(#N)`; pure docs / meta / CI-only PRs are exempt. Follows [Keep a Changelog](https://keepachangelog.com); release mechanics live in **Versioning & release** above.
