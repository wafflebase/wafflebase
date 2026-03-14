# Design Documents

Technical design documents for the Wafflebase project. These go deeper than package READMEs, covering architecture decisions, data models, and implementation details.

## Documents

| Document                                               | Description                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [sheet.md](sheet.md)                                   | Sheet package — data model, Store interface, rendering pipeline, coordinate system                |
| [sheet-style.md](sheet-style.md)                       | Sheet style system — style layers, merge semantics, range-style compaction, rendering, formatting  |
| [formula.md](formula.md)                               | Formula engine — ANTLR grammar, evaluation pipeline, built-in functions, cross-sheet references    |
| [calculator.md](calculator.md)                         | Calculator — dependency graph, topological sort, single-sheet and cross-sheet cycle detection       |
| [scroll-and-rendering.md](scroll-and-rendering.md)     | Viewport-based Canvas rendering and proportional scroll remapping for large grids                  |
| [frontend.md](frontend.md)                             | Frontend package — app architecture, Yorkie integration, presence system, auth flow                |
| [collaboration.md](collaboration.md)                       | Yorkie collaboration — worksheet storage, structural concurrency, and test strategy              |
| [batch-transactions.md](batch-transactions.md)         | Store-level batch transactions for atomic undo/redo grouping                                       |
| [backend.md](backend.md)                               | Backend package — NestJS modules, API reference, auth system, database schema, security            |
| [sharing.md](sharing.md)                               | URL-based token sharing with anonymous access and role-based permissions                           |
| [datasource.md](datasource.md)                         | External PostgreSQL datasources, multi-tab documents, SQL editor, ReadOnlyStore                    |
| [harness-engineering.md](harness-engineering.md)       | Verification lane strategy, phase roadmap, rollout status, and harness v1 completion criteria      |
| [formula-coverage.md](formula-coverage.md)             | Google Sheets function parity — current coverage, tier plan, per-function status                   |
| [charts.md](charts.md)                                 | Chart system — registry architecture, chart types, editor panel, phased roadmap                    |
| [context-menu.md](context-menu.md)                     | Unified context menu — Radix ContextMenu, desktop/mobile parity, menu items                       |
| [pivot-table.md](pivot-table.md)                       | Pivot table — materialized cells, calculation engine, side panel editor, collaboration             |
| [rest-api-and-cli.md](rest-api-and-cli.md)             | REST API, API key auth, and CLI — external access, Yorkie service, Go CLI tool                     |
| [docs-site.md](docs-site.md)                           | Documentation site — VitePress setup, screenshot pipeline, build & deployment                      |

## Template

Design documents use YAML frontmatter and follow this structure:

```markdown
---
title: feature-name
target-version: 0.1.0
---

# Feature Name

## Summary

## Goals / Non-Goals

## Proposal Details

## Risks and Mitigation
```
