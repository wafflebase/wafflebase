# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Teams that want an office suite they run on their own infrastructure: small
teams and organizations that would otherwise use Google Workspace but need
their documents and data to stay where they choose. They work in Wafflebase
day to day — editing spreadsheets, documents, decks, notes and boards
together in real time — and someone on the team operates the deployment.

## Product Purpose

Wafflebase is a web-based collaborative office suite: spreadsheets, word
documents, presentations, markdown notes and an infinite-canvas board, plus
viewers for uploaded PDFs, images and other files. It exists so a team can
have the collaborative editing it expects from a hosted suite without handing
its documents to someone else's cloud. Success is a team doing its everyday
document work in Wafflebase on its own deployment.

## Positioning

Three things together, which a hosted suite cannot truthfully claim:

- **Self-hosted and open source.** Apache-2.0; the whole stack ships as a
  Docker image (`yorkieteam/wafflebase`) and the data stays on the team's own
  infrastructure.
- **Every document type in one place.** Sheets, Docs, Slides, Notes, Board and
  files share one workspace, one sharing model, one comment and notification
  system, and one version history, all on Yorkie CRDTs.
- **Agents are first-class users.** The `wafflebase` CLI, the workspace-scoped
  `/api/v1` REST surface and the Claude Code plugin let an agent create and
  edit the same documents people are editing live.

## Operating Context

- Real-time co-editing with peer cursors and name labels, threaded comments
  with `@user` mentions, in-app notifications, and revision history with
  preview and restore.
- Workspaces, folders, URL share links with viewer/editor roles and anonymous
  access, and a template gallery.
- Interop with the formats teams already hold: `.xlsx` (with styles), CSV,
  JSON and Parquet import; DOCX import/export; PPTX import/export; PDF export;
  best-effort Miro board import.
- Spreadsheets can read external data directly: a SQL tab over PostgreSQL /
  MySQL / BigQuery, and Iceberg / Delta tables from object storage through
  the lakehouse connector.
- Sign-in through GitHub OAuth (GitHub Enterprise supported) and optionally
  Google.

## Capabilities and Constraints

- **Google parity is the default for editor behavior.** Keyboard shortcuts,
  selection, clipboard and editing behavior in Sheets, Docs and Slides follow
  Google Sheets / Docs / Slides unless there is a stated reason not to.
- Editors render to Canvas (with a DOM overlay for Slides text editing);
  document state lives in Yorkie CRDTs, so features must hold up under
  concurrent editing.
- Pre-1.0: tagged releases, an npm-published CLI and a public site at
  wafflebase.io, but not declared production-ready.
- Terminology: a "document" is any of sheet / doc / slides / note / board /
  pdf / image / file; a "workspace" holds documents, folders, members and API
  keys.

## Brand Commitments

The product name is Wafflebase. No other brand commitment was made binding
during init.

## Evidence on Hand

- A public live demo:
  `https://wafflebase.io/shared/bed3dbe8-bdce-46ef-a76e-65fd67178cde`.
- The open-source repository, `github.com/wafflebase/wafflebase`.
- Public developer docs at `wafflebase.io/docs` (`packages/documentation`).
- No customers, testimonials, partner logos, benchmarks or pricing exist.
  Wafflebase is free OSS, so future work must not invent any of these.

## Product Principles

1. **Your data stays where you put it.** Self-hosting is the point, not an
   add-on; nothing should assume a vendor cloud.
2. **Familiar before novel.** In the editors, behaving the way Google's
   suite does beats a cleverer interaction people have to learn.
3. **One suite, not six apps.** Collaboration, sharing, comments and history
   work the same way across every document type.
4. **Agents and people edit the same thing.** Anything a person can do to a
   document should be reachable through the CLI / API too.
