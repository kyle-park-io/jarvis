# Jarvis

A personal chief-of-staff task agent. It manages several concurrent work streams by their **weekly time budgets** — computing how much of what to do today, surfacing things about to slip through the cracks, and executing some tasks on your behalf behind an approval gate.

> **Status:** v0.2.0 released. Phase 2 (semi-autonomous execution) has shipped and is experimental. See [`CLAUDE.md`](./CLAUDE.md) for the current working plan and engineering rules.

## Why

Juggling several commitments at once, it's easy to (a) drop things, (b) spend effort on the wrong thing, and (c) burn energy just deciding what to do next. That's a scheduling problem, not a discipline problem — so Jarvis computes each day's allocation from every stream's weekly budget, deadlines, and your calendar. Works for developers and non-developers alike.

## Documentation

Each document below owns a set of facts and is the only place those facts are stated — start here, not in this file:

| Document | Answers |
|---|---|
| [Capabilities](docs/capabilities.md) | What can Jarvis do right now, command by command and feature by feature, with an honest status for each? |
| [Getting started](docs/getting-started.md) | How do you go from a fresh clone to your first daily plan? |
| [Data contract](docs/data-contract.md) | What files and database rows does Jarvis create, and what happens if you delete them? |
| [Integrations](docs/integrations.md) | What external services, MCP servers, and credentials does it use? |
| [Guides](docs/guides/) | Step-by-step instructions for specific setup tasks (e.g. Google Calendar OAuth). |
| [Plans](docs/plans/) | The implementation plan behind each shipped or in-progress piece of the system. |

## Structure

```
packages/{core, store, connectors, agent, scheduler}
apps/cli
```

`core` is a pure allocation engine (no I/O); everything else — connectors, scheduler, frontends — plugs in behind interfaces.

## Roadmap

1. **Phase 1** — intelligent planner (read-only): ingest tasks + time, compute the daily allocation, detect dropped balls.
2. **Phase 2** — semi-auto: drafts + small dev tasks via an isolated branch → draft PR (the PR is the approval gate).
3. **Phase 3** — autonomous for trusted task types.

## License

[MIT](./LICENSE)
