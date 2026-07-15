# Changelog

All notable changes to Jarvis are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
Maintenance: every PR adds a one-line entry under the matching category in
[Unreleased] — Added / Changed / Fixed / Deprecated / Removed / Security —
tagged with its PR number (#N). On release, rename [Unreleased] to
`## [x.y.z] - YYYY-MM-DD` and start a fresh [Unreleased] block on top.
See CLAUDE.md -> Working rules.
-->

## [Unreleased]

### Added

- Live GitHub connector via the official remote MCP server (PAT auth), mapping configured repos to streams (#13)
- Google Calendar committed-hours: `jarvis auth google` (one-time OAuth) then real meeting hours reduce the day's capacity, via the remote Calendar MCP server. Note: that server is gated to Google Workspace / Developer-Preview accounts — personal Gmail is blocked by Google, and Jarvis stays fail-safe (0 hours) then. See `docs/guides/google-calendar-setup.md` (#15)

### Changed

- GitHub connector paginates `list_issues`, pulling all open issues per repo instead of only the first 100 (#14)

## [0.1.0] - 2026-07-15

First tagged release — the read-only MVP. Jarvis reads tasks from sources,
computes each stream's daily time allocation against its weekly budget, and
writes a human-readable plan; time can be logged back with self-correcting pace.

### Added

- Pure allocation engine (`core`) — the I/O-free budgeting core (#1)
- Persistence layer: config, SQLite store, plan writer (`store`) (#2)
- Connector interface + folder connector (`connectors`) (#3)
- Daily-plan scheduler: croner pipeline + source reconciliation (`scheduler`) (#4)
- `jarvis` CLI — completes the read-only MVP (#5)
- `jarvis log` — time logging with self-correcting pace (#6)
- MCP connector framework + GitHub issue mapper (#7)
- Gmail connector + Calendar committed-hours provider (#8)
- Secret loading from `<dataRoot>/.env` + `.env.example` template (#9)

[unreleased]: https://github.com/kyle-park-io/jarvis/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kyle-park-io/jarvis/releases/tag/v0.1.0
