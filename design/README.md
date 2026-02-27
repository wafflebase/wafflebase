# Design Documents

Technical design documents for the Wafflebase project. These go deeper than package READMEs, covering architecture decisions, data models, and implementation details.

## Documents

| Document                                               | Description                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [sheet.md](sheet.md)                                   | Sheet package — data model, Store interface, formula engine, rendering pipeline, coordinate system |
| [sheet-style.md](sheet-style.md)                       | Sheet style system — style layers, merge semantics, range-style compaction, rendering, formatting  |
| [formula-and-calculator.md](formula-and-calculator.md) | Formula engine and calculator — parsing, evaluating, and recalculating formulas                    |
| [scroll-and-rendering.md](scroll-and-rendering.md)     | Viewport-based Canvas rendering and proportional scroll remapping for large grids                  |
| [frontend.md](frontend.md)                             | Frontend package — app architecture, Yorkie integration, presence system, auth flow                |
| [batch-transactions.md](batch-transactions.md)         | Store-level batch transactions for atomic undo/redo grouping                                       |
| [backend.md](backend.md)                               | Backend package — NestJS modules, API reference, auth system, database schema, security            |
| [sharing.md](sharing.md)                               | URL-based token sharing with anonymous access and role-based permissions                           |
| [datasource.md](datasource.md)                         | External PostgreSQL datasources, multi-tab documents, SQL editor, ReadOnlyStore                    |
| [harness-engineering.md](harness-engineering.md)       | Verification lane strategy, phase roadmap, rollout status, and harness v1 completion criteria      |

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
