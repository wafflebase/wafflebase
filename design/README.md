# Design Documents

Technical design documents for the Wafflebase project. These go deeper than package READMEs, covering architecture decisions, data models, and implementation details.

## Documents

| Document | Description |
|----------|-------------|
| [sheet.md](sheet.md) | Sheet package — data model, Store interface, formula engine, rendering pipeline, coordinate system |
| [frontend.md](frontend.md) | Frontend package — app architecture, Yorkie integration, presence system, auth flow |
| [backend.md](backend.md) | Backend package — NestJS modules, API reference, auth system, database schema, security |
| [scroll-and-rendering.md](scroll-and-rendering.md) | Viewport-based Canvas rendering and proportional scroll remapping for large grids |
| [batch-transactions.md](batch-transactions.md) | Store-level batch transactions for atomic undo/redo grouping |

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
