# Design Documents

Technical design documents for the Wafflebase project. These go deeper than package READMEs, covering architecture decisions, data models, and implementation details.

## Sheets

Spreadsheet engine — data model, formulas, rendering, collaboration.

| Document                                                             | Description                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [sheet.md](sheets/sheet.md)                                          | Sheet package — data model, Store interface, rendering pipeline, coordinate system                |
| [sheet-style.md](sheets/sheet-style.md)                              | Sheet style system — style layers, merge semantics, range-style compaction, rendering, formatting  |
| [formula.md](sheets/formula.md)                                      | Formula engine — ANTLR grammar, evaluation pipeline, built-in functions, cross-sheet references    |
| [formula-coverage.md](sheets/formula-coverage.md)                    | Google Sheets function parity — current coverage, tier plan, per-function status                   |
| [calculator.md](sheets/calculator.md)                                | Calculator — dependency graph, topological sort, single-sheet and cross-sheet cycle detection       |
| [scroll-and-rendering.md](sheets/scroll-and-rendering.md)            | Viewport-based Canvas rendering and proportional scroll remapping for large grids                  |
| [charts.md](sheets/charts.md)                                        | Chart system — registry architecture, chart types, editor panel, phased roadmap                    |
| [pivot-table.md](sheets/pivot-table.md)                              | Pivot table — materialized cells, calculation engine, side panel editor, collaboration             |
| [conditional-format-multi-range.md](sheets/conditional-format-multi-range.md) | Conditional formatting multi-range support                                                |
| [batch-transactions.md](sheets/batch-transactions.md)                | Store-level batch transactions for atomic undo/redo grouping                                       |
| [collaboration.md](sheets/collaboration.md)                          | Yorkie collaboration — worksheet storage, structural concurrency, and test strategy              |
| [datasource.md](sheets/datasource.md)                                | External PostgreSQL datasources, multi-tab documents, SQL editor, ReadOnlyStore                    |
| [peer-cursor-labels.md](sheets/peer-cursor-labels.md)               | Peer cursor name labels — transient username tags on collaborative sheet cursors                  |
| [axis-id-selection.md](sheets/axis-id-selection.md)                  | Axis ID based selection & presence — stable selection across remote structural edits              |

## Docs

Word processor engine — rich text, tables, pagination, collaboration.

| Document                                                                         | Description                                                                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [docs.md](docs/docs.md)                                                          | Docs package — Canvas-based document editor, data model, layout engine, rendering pipeline         |
| [docs-pagination.md](docs/docs-pagination.md)                                    | Docs pagination — page setup, line-level page splitting, paginated rendering pipeline              |
| [docs-rendering-optimization.md](docs/docs-rendering-optimization.md)            | Docs rendering optimization — scroll repaint, measureText cache, incremental layout               |
| [docs-tables.md](docs/docs-tables.md)                                            | Docs tables — data model, cell merge, layout, rendering, extensibility path                       |
| [docs-table-ui.md](docs/docs-table-ui.md)                                        | Docs table UI — grid picker, context menu, IME cell routing                                       |
| [docs-table-crdt.md](docs/docs-table-crdt.md)                                    | Table CRDT collaboration — Tree node structure, container cells, concurrent editing               |
| [docs-table-resize.md](docs/docs-table-resize.md)                                | Docs table resize — column/row border drag handles, guideline rendering                           |
| [docs-nested-tables.md](docs/docs-nested-tables.md)                              | Nested tables — recursive nesting, layout, rendering, editing, CRDT synchronization               |
| [docs-image-editing.md](docs/docs-image-editing.md)                              | Docs image editing — toolbar insert, selection handles, resize, rotation, crop, Image Options panel |
| [docs-frontend-integration.md](docs/docs-frontend-integration.md)                | Docs frontend integration — document type field, list UI, routing, backend API changes            |
| [docs-collaboration.md](docs/docs-collaboration.md)                              | Docs collaboration design                                                                         |
| [docs-remote-cursor.md](docs/docs-remote-cursor.md)                              | Docs remote cursor — peer cursor carets + name labels in collaborative docs editor                |
| [docs-mobile-zoom-to-fit.md](docs/docs-mobile-zoom-to-fit.md)                    | Docs mobile zoom-to-fit — Canvas scale transform for narrow viewports                             |
| [docs-intent-preserving-edits.md](docs/docs-intent-preserving-edits.md)          | Intent-preserving Yorkie edits — character-level Tree editing, 5-phase migration                  |
| [docs-wordprocessor-roadmap.md](docs/docs-wordprocessor-roadmap.md)              | Docs word processor roadmap — 6-phase plan for Google Docs parity                                 |
| [docs-ruler.md](docs/docs-ruler.md)                                              | Docs ruler design                                                                                 |

## Common

Infrastructure, frontend/backend, and cross-cutting concerns.

| Document                                               | Description                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [frontend.md](frontend.md)                             | Frontend package — app architecture, Yorkie integration, presence system, auth flow                |
| [backend.md](backend.md)                               | Backend package — NestJS modules, API reference, auth system, database schema, security            |
| [sharing.md](sharing.md)                               | URL-based token sharing with anonymous access and role-based permissions                           |
| [context-menu.md](context-menu.md)                     | Unified context menu — Radix ContextMenu, desktop/mobile parity, menu items                       |
| [rest-api-and-cli.md](rest-api-and-cli.md)             | REST API, API key auth, and CLI — external access, Yorkie service, Go CLI tool                     |
| [cli-oauth-login.md](cli-oauth-login.md)               | CLI OAuth login — browser-based GitHub auth, JWT session storage, workspace context switching      |
| [harness-engineering.md](harness-engineering.md)       | Verification lane strategy, phase roadmap, rollout status, and harness v1 completion criteria      |
| [homepage.md](homepage.md)                             | Homepage landing page — sections, live demo, theme support, developer examples                     |
| [docs-site.md](docs-site.md)                           | Documentation site — VitePress setup, package structure, deployment under /docs subpath            |

## Template

Design documents use YAML frontmatter and follow this structure:

```markdown
---
title: feature-name
target-version: 0.2.0
---

# Feature Name

## Summary

## Goals / Non-Goals

## Proposal Details

## Risks and Mitigation
```
