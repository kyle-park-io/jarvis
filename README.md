# Jarvis

A personal chief-of-staff task agent. It manages several concurrent work streams by their **weekly time budgets** — computing how much of what to do today, surfacing things about to slip through the cracks, and (later) executing small tasks on your behalf behind an approval gate.

> **Status:** design phase. Code is not scaffolded yet. See [`CLAUDE.md`](./CLAUDE.md) for the working plan.

## Why

Juggling several commitments at once, it's easy to (a) drop things, (b) spend effort on the wrong thing, and (c) burn energy just deciding what to do next. That's a scheduling problem, not a discipline problem — so Jarvis computes each day's allocation from every stream's weekly budget, deadlines, and your calendar. Works for developers and non-developers alike.

## Stack

- **TypeScript** monorepo (**pnpm** workspaces)
- Agent execution: **Claude Agent SDK**
- Scheduler **croner** · store **better-sqlite3** · validation **zod** · tests **vitest** · build **tsup**

## Structure (planned)

```
packages/{core, store, connectors, agent, scheduler}
apps/{cli, web, bot, mcp}
```

`core` is a pure allocation engine (no I/O); everything else — connectors, scheduler, frontends — plugs in behind interfaces.

## Roadmap

1. **Phase 1** — intelligent planner (read-only): ingest tasks + time, compute the daily allocation, detect dropped balls.
2. **Phase 2** — semi-auto: drafts + small dev tasks via an isolated branch → draft PR (the PR is the approval gate).
3. **Phase 3** — autonomous for trusted task types.

## License

[MIT](./LICENSE)
