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
| [sheet-image.md](sheets/sheet-image.md)                              | Sheet image — floating images, workspace image API, insertion paths, phased roadmap               |
| [pivot-table.md](sheets/pivot-table.md)                              | Pivot table — materialized cells, calculation engine, side panel editor, collaboration             |
| [conditional-format-multi-range.md](sheets/conditional-format-multi-range.md) | Conditional formatting multi-range support                                                |
| [batch-transactions.md](sheets/batch-transactions.md)                | Store-level batch transactions for atomic undo/redo grouping                                       |
| [collaboration.md](sheets/collaboration.md)                          | Yorkie collaboration — worksheet storage, structural concurrency, and test strategy              |
| [datasource.md](sheets/datasource.md)                                | External PostgreSQL datasources, multi-tab documents, SQL editor, ReadOnlyStore                    |
| [peer-cursor-labels.md](sheets/peer-cursor-labels.md)               | Peer cursor name labels — transient username tags on collaborative sheet cursors                  |
| [axis-id-selection.md](sheets/axis-id-selection.md)                  | Axis ID based selection & presence — stable selection across remote structural edits              |
| [comments.md](sheets/comments.md)                                    | Sheet cell comments — threaded comments, resolve flow, anchor stability, side panel UI            |

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
| [docs-docx-import-export.md](docs/docs-docx-import-export.md)                    | DOCX import/export — round-trip mapping between DOCX and the Docs data model                       |
| [docs-pdf-export.md](docs/docs-pdf-export.md)                                    | PDF export — vector PDF via pdf-lib + fontkit, reuses `paginateLayout`, lazy Noto KR fonts        |
| [docs-frontend-integration.md](docs/docs-frontend-integration.md)                | Docs frontend integration — document type field, list UI, routing, backend API changes            |
| [docs-collaboration.md](docs/docs-collaboration.md)                              | Docs collaboration design                                                                         |
| [docs-remote-cursor.md](docs/docs-remote-cursor.md)                              | Docs remote cursor — peer cursor carets + name labels in collaborative docs editor                |
| [docs-mobile-zoom-to-fit.md](docs/docs-mobile-zoom-to-fit.md)                    | Docs mobile zoom-to-fit — Canvas scale transform for narrow viewports                             |
| [docs-intent-preserving-edits.md](docs/docs-intent-preserving-edits.md)          | Intent-preserving Yorkie edits — character-level Tree editing, 5-phase migration                  |
| [docs-wordprocessor-roadmap.md](docs/docs-wordprocessor-roadmap.md)              | Docs word processor roadmap — 6-phase plan for Google Docs parity                                 |
| [docs-ruler.md](docs/docs-ruler.md)                                              | Docs ruler design                                                                                 |
| [docs-table-copy-paste.md](docs/docs-table-copy-paste.md)                        | Docs table copy-paste — cell-range clipboard, whole-table block, external HTML table paste        |
| [docs-table-row-splitting.md](docs/docs-table-row-splitting.md)                  | Table row splitting — split tall table rows across pages, recursive nested table support          |
| [docs-peer-jump.md](docs/docs-peer-jump.md)                                      | Click peer avatar to scroll to that collaborator's caret in the docs editor                       |
| [docs-comments.md](docs/docs-comments.md)                                        | Docs comments — text-range threads, CRDT-stable posRange anchors, orphan preservation, shared frontend module |

## Slides

Presentation engine — slides, free-position elements, presentation mode, collaboration.

| Document                                                                              | Description                                                                                        |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [slides.md](slides/slides.md)                                                         | Slides package (v1) — data model, Yorkie schema, Canvas+DOM editor, two-pane layout, PDF export    |
| [slides-themes-layouts-import.md](slides/slides-themes-layouts-import.md)             | Themes (4-tier) + 11 Google-Slides-parity layouts + PPTX best-effort import; 3-PR rollout plan      |
| [slides-layout-change.md](slides/slides-layout-change.md)                             | Layout change UI — placeholder identity tracking, type-first matching, split-button + context menu  |
| [slides-shapes.md](slides/slides-shapes.md)                                           | Shape library — 55 OOXML-aligned `ShapeKind` values, path-builder registry, `data.adjustments` storage, yellow-diamond drag handles, picker UX, phased roadmap to ~100-shape GS parity |
| [slides-keyboard-shortcuts.md](slides/slides-keyboard-shortcuts.md)                   | Slides keyboard shortcuts — Google Slides parity pass, single catalog source, help modal, link popover wiring                                                                          |
| [slides-presentation-mode.md](slides/slides-presentation-mode.md)                     | Slides presentation mode v1 — local-only fullscreen player, keyboard nav, click-to-advance, end screen, fullscreen-overlay fallback                                                    |
| [slides-connectors.md](slides/slides-connectors.md)                                   | Slides connectors — endpoint-driven Line/Arrow/Elbow/Curved with per-shape connection sites, auto routing, snap-on-draw UX, 3-PR rollout                                              |
| [slides-toolbar-redesign.md](slides/slides-toolbar-redesign.md)                       | Slides toolbar redesign — single morphing toolbar (Idle / Object / Text-editing) replacing the always-on layout, Arrange dropdown consolidating align/distribute/order/rotate, shared text-formatting components |
| [slides-text-engine-audit.md](slides/slides-text-engine-audit.md)                     | Spike audit (Phase 5 prep) — docs RichText reuse plan: extract `paintLayout`/`findPositionAtPixel`/`initializeTextBox`, no fork                                                                              |
| [slides-mobile-view.md](slides/slides-mobile-view.md)                                 | Mobile view (read-only) — viewport-768 branch in SlidesView, dedicated MobileSlidesView reusing SlideRenderer, swipe nav, Present entry, no editor mount                                                    |
| [slides-mobile-edit.md](slides/slides-mobile-edit.md)                                 | Mobile light edit (Phase B) — mount full SlidesEditor on touch, hit-test tolerance, bottom-sheet text formatting, slide-ops FAB, undo/redo header, perm-gated read-only fallback                            |
| [slides-group.md](slides/slides-group.md)                                             | Group / ungroup — nested element tree with group-local child coords, Google Slides drill-in selection, PPTX `<p:grpSp>` preservation, recursive renderer / hit-test / PDF export                              |
| [slides-group-selection-ui.md](slides/slides-group-selection-ui.md)                   | Group selection overlay — distinct visuals for group (member outlines) vs drilled-in child (context box); overlay-only change reusing existing world-frame math                                              |
| [slides-shape-move.md](slides/slides-shape-move.md)                                   | Shape drag-move — `move` hover cursor on selected shapes, ghost preview at `GHOST_ALPHA` follows pointer, commit only on release                                                                            |
| [slides-ruler.md](slides/slides-ruler.md)                                             | Slides ruler — H/V rulers (corner origin, inch/cm), presentation-wide draggable guides, snap integration, read-only mount handling                                                                          |
| [slides-textbox-autogrow.md](slides/slides-textbox-autogrow.md)                       | Text box authoring — insert-to-edit focus, drag sizing (width+position), content-fit auto-grow height via a docs `onContentHeightChange` callback                                                            |
| [slides-text-autofit.md](slides/slides-text-autofit.md)                               | Text autofit — adds `shrink` (font auto-scales to fit a fixed box) + a 3-mode `autofit` selector (none/shrink/grow) layered on the auto-grow feature; placeholder=shrink / textbox=grow defaults, PPTX bodyPr import |
| [slides-shift-modifiers.md](slides/slides-shift-modifiers.md)                         | Shift modifiers during drag — 1:1 shape draw, 15° line/connector angle snap, 15° endpoint snap, axis-locked move; pure constraint helpers reused at four call sites                                        |

## Common

Infrastructure, frontend/backend, and cross-cutting concerns.

| Document                                               | Description                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [frontend.md](frontend.md)                             | Frontend package — app architecture, Yorkie integration, presence system, auth flow                |
| [backend.md](backend.md)                               | Backend package — NestJS modules, API reference, auth system, database schema, security            |
| [sharing.md](sharing.md)                               | URL-based token sharing with anonymous access and role-based permissions                           |
| [context-menu.md](context-menu.md)                     | Unified context menu — Radix ContextMenu, desktop/mobile parity, menu items                       |
| [rest-api-and-cli.md](rest-api-and-cli.md)             | REST API, API key auth, and CLI — external access, Yorkie service, Go CLI tool                     |
| [docs-cli.md](docs-cli.md)                             | Docs CLI support and namespace restructure — `docs`/`sheets` plural namespaces, content/export/import for Docs |
| [cli-oauth-login.md](cli-oauth-login.md)               | CLI OAuth login — browser-based GitHub auth, JWT session storage, workspace context switching      |
| [harness-engineering.md](harness-engineering.md)       | Verification lane strategy, phase roadmap, rollout status, and harness v1 completion criteria      |
| [homepage.md](homepage.md)                             | Homepage landing page — sections, live demo, theme support, developer examples                     |
| [docs-site.md](docs-site.md)                           | Documentation site — VitePress setup, package structure, deployment under /docs subpath            |
| [design-system-unification.md](design-system-unification.md) | Design-system unification — shared tokens package, toolbar/popover consolidation, mobile and a11y roadmap |

## Template

New design documents should be based on [template.md](template.md). YAML frontmatter and structure:

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
