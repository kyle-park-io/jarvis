# Documentation map

Where a fact lives, and where a new document should go. Read this before
creating any `.md` file in this repository.

## The map

| File | Answers | Reader |
|---|---|---|
| [`README.md`](../README.md) | "What is this?" (30 seconds) | first-time visitor |
| [`docs/capabilities.md`](capabilities.md) | "What can it do?" | someone evaluating it |
| [`docs/getting-started.md`](getting-started.md) | "How do I start?" (prerequisites → first run) | someone adopting it |
| [`docs/data-contract.md`](data-contract.md) | "What gets created where?" | user, operator |
| [`docs/README.md`](README.md) (this file) | "Where does documentation go?" | contributor |
| [`docs/integrations.md`](integrations.md) | "What does it call out to?" | someone wiring up a service |
| [`docs/guides/*.md`](guides/) | "How do I set up X?" | someone doing a specific setup task |
| [`docs/plans/*.md`](plans/) | "How was it built?" (history, one file per dated task) | contributor tracing a decision |
| [`CLAUDE.md`](../CLAUDE.md) | working rules for agents/contributors | contributor, coding agent |
| `internal/*.md` (uncommitted; created by need, not yet present) | internal-only delta on top of `getting-started.md` | internal user |

`design/` (uncommitted, Korean) is the reference spec behind all of this — see
`CLAUDE.md` → Language convention. It is not part of the map above because it
isn't committed documentation.

### Status vocabulary

Three markers, used consistently across every document — never a fourth:
**✅ Live** · **⚠️ Gated** · **⛔ Not wired**.

## Should I create a new file?

Work through this in order. Most of the time the answer is "no, edit an
existing file."

1. **Does this belong to one of the four canonical documents** —
   `capabilities.md`, `getting-started.md`, `data-contract.md`,
   `integrations.md`? → **Edit that file. Do not create a new one.**
2. **Is it a self-contained setup procedure** (e.g. authorizing an external
   account)? → `docs/guides/<topic>.md`
3. **Is it an implementation plan?** → `docs/plans/YYYY-MM-DD-<topic>.md`.
   This is **immutable history** — write it once, don't edit it after the
   work lands.
4. **Is it personal or organizational context** (not useful to an outside
   reader, or not safe to publish)? → `design/` or `internal/`, both
   uncommitted.

## Conventions

- **Filenames:** kebab-case.
- **Date prefixes:** only in `docs/plans/` (`YYYY-MM-DD-<topic>.md`). No
  other directory dates its filenames.
- **Language:** every committed document is English. `design/` is the sole
  exception — it stays Korean (see `CLAUDE.md` → Language convention).

## The one rule

**One fact, one home — link, never restate.** Every fact has exactly one
canonical document. If you need a fact that lives elsewhere, link to it. The
moment a fact is written in two places, one of those copies will eventually
be wrong.
