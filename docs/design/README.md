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
| [batch-transactions.md](sheets/batch-transactions.md)                | Store-level batch transactions for atomic undo/redo grouping                                       |
| [collaboration.md](sheets/collaboration.md)                          | Yorkie collaboration — worksheet storage, structural concurrency, and test strategy              |
| [datasource.md](sheets/datasource.md)                                | External PostgreSQL datasources, multi-tab documents, SQL editor, ReadOnlyStore                    |
| [axis-id-selection.md](sheets/axis-id-selection.md)                  | Axis ID based selection & presence — stable selection across remote structural edits              |
| [comments.md](sheets/comments.md)                                    | Sheet cell comments — threaded comments, resolve flow, anchor stability, side panel UI            |

## Docs

Word processor engine — rich text, tables, pagination, collaboration.

| Document                                                                         | Description                                                                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [docs.md](docs/docs.md)                                                          | Docs package — Canvas-based document editor, data model, layout engine, rendering pipeline         |
| [docs-pagination.md](docs/docs-pagination.md)                                    | Docs pagination — page setup, line-level page splitting, paginated rendering pipeline              |
| [docs-header-footer.md](docs/docs-header-footer.md)                              | Docs header & footer — editable per-page header/footer regions in the paginated editor             |
| [docs-rendering-optimization.md](docs/docs-rendering-optimization.md)            | Docs rendering optimization — scroll repaint, measureText cache, incremental layout               |
| [docs-tables.md](docs/docs-tables.md)                                            | Docs tables — umbrella: data model, Yorkie Tree structure, cursor/navigation, layout, granular store ops, pagination. Per-feature docs under [`docs/tables/`](docs/tables/) |
| [docs-image-editing.md](docs/docs-image-editing.md)                              | Docs image editing — toolbar insert, selection handles, resize, rotation, crop, Image Options panel |
| [docs-docx-import-export.md](docs/docs-docx-import-export.md)                    | DOCX import/export — round-trip mapping between DOCX and the Docs data model                       |
| [docs-pdf-export.md](docs/docs-pdf-export.md)                                    | PDF export — vector PDF via pdf-lib + fontkit, reuses `paginateLayout`, lazy Noto KR fonts        |
| [docs-collaboration.md](docs/docs-collaboration.md)                              | Docs collaboration — Yorkie Tree CRDT, `YorkieDocStore`, snapshot/restore (block-level history; current text-edit path lives in docs-intent-preserving-edits.md) |
| [docs-intent-preserving-edits.md](docs/docs-intent-preserving-edits.md)          | Intent-preserving Yorkie edits — character-level Tree editing for concurrent same-paragraph edits |
| [docs-presence.md](docs/docs-presence.md)                                        | Docs presence — peer cursor carets + name labels and avatar click-to-jump in the collaborative docs editor |
| [docs-wordprocessor-roadmap.md](docs/docs-wordprocessor-roadmap.md)              | Docs word processor roadmap — current state + remaining phases for Google Docs parity              |
| [docs-ruler.md](docs/docs-ruler.md)                                              | Docs ruler design                                                                                 |
| [docs-comments.md](docs/docs-comments.md)                                        | Docs comments — text-range threads, CRDT-stable posRange anchors, orphan preservation, shared frontend module |
| [docs-font-controls.md](docs/docs-font-controls.md)                              | Docs font controls — curated family picker (14 fonts), Google-Docs-style size input, line spacing, clear formatting, shared text-formatting components |
| [docs-pending-inline-style.md](docs/docs-pending-inline-style.md)                | Pending inline style at a collapsed caret — stored marks for toolbar toggles, IME-aware, view-local            |
| [docs-local-caret-anchoring.md](docs/docs-local-caret-anchoring.md)              | Local caret anchoring — Yorkie Tree-anchored caret/selection, resolves to DocPosition at render time (issue #237) |

## Slides

Presentation engine — slides, free-position elements, presentation mode, collaboration.

| Document                                                                              | Description                                                                                        |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [slides.md](slides/slides.md)                                                         | Slides package (v1) — data model, Yorkie schema, Canvas+DOM editor, two-pane layout, PDF export    |
| [slides-collaboration.md](slides/slides-collaboration.md)                             | Slides collaboration — current concurrent-editing state vs `slides/slides.md` intent: notes live-sync fix, LWW-on-blur text bodies, half-wired presence; reconciles stale claims + remaining work |
| [slides-themes-layouts-import.md](slides/slides-themes-layouts-import.md)             | Themes (4-tier) + 11 Google-Slides-parity layouts + PPTX best-effort import; 3-PR rollout plan      |
| [slides-layout-change.md](slides/slides-layout-change.md)                             | Layout change UI — placeholder identity tracking, type-first matching, split-button + context menu  |
| [slides-shapes.md](slides/slides-shapes.md)                                           | Shape library — 55 OOXML-aligned `ShapeKind` values, path-builder registry, `data.adjustments` storage, yellow-diamond drag handles, picker UX, phased roadmap to ~100-shape GS parity |
| [slides-keyboard-shortcuts.md](slides/slides-keyboard-shortcuts.md)                   | Slides keyboard shortcuts — Google Slides parity pass, single catalog source, help modal, link popover wiring                                                                          |
| [slides-presentation-mode.md](slides/slides-presentation-mode.md)                     | Slides presentation mode v1 — local-only fullscreen player, keyboard nav, click-to-advance, end screen, fullscreen-overlay fallback                                                    |
| [slides-connectors.md](slides/slides-connectors.md)                                   | Slides connectors — endpoint-driven Line/Arrow/Elbow/Curved with per-shape connection sites, auto routing, snap-on-draw UX, 3-PR rollout                                              |
| [slides-toolbar-redesign.md](slides/slides-toolbar-redesign.md)                       | Slides toolbar redesign — single morphing toolbar (Idle / Object / Text-editing) replacing the always-on layout, Arrange dropdown consolidating align/distribute/order/rotate, shared text-formatting components |
| [slides-mobile.md](slides/slides-mobile.md)                                           | Mobile view + light edit — viewport-768 branch, MobileSlidesView shell with `mode: 'view' \| 'edit'`, bottom-sheet text formatting, slide-ops FAB, undo/redo header, perm-gated read-only fallback           |
| [slides-group.md](slides/slides-group.md)                                             | Group / ungroup — nested element tree with group-local child coords, Google Slides drill-in selection, distinct group/member/context selection overlay, PPTX `<p:grpSp>` preservation, recursive renderer / hit-test / PDF export |
| [slides-ruler.md](slides/slides-ruler.md)                                             | Slides ruler — H/V rulers (corner origin, inch/cm), presentation-wide draggable guides, snap integration, read-only mount handling                                                                          |
| [slides-text-autofit.md](slides/slides-text-autofit.md)                               | Text autofit — three-mode `autofit` selector (none/shrink/grow), insert-to-edit + drag sizing + content-fit auto-grow via docs `onContentHeightChange` hook (grow mode), placeholder=shrink / textbox=grow defaults, PPTX bodyPr import |
| [slides-format-options-panel.md](slides/slides-format-options-panel.md)               | Right-side Format options panel v1 — Size & Position (W/H/X/Y/Rotation, in/cm toggle), Text fitting, Image opacity, Alt text; shares right slot with ThemePanel; single `Meta.unit` field added            |
| [slides-format-effects.md](slides/slides-format-effects.md)                            | Format options per-type parity — shared `effects` model (Drop shadow + Reflection), image Recolor + Brightness/Contrast, Alt text on all object types; element-type section routing; 2-PR rollout          |
| [slides-smart-guides.md](slides/slides-smart-guides.md)                               | Smart guides v1 — equal-spacing trios + equal-distance pairs during drag + equal-size during resize, PowerPoint-style red arrow / dashed outline overlays, reuses snap-candidates pipeline                  |
| [slides-hover-and-text-edit-entry.md](slides/slides-hover-and-text-edit-entry.md)     | Hover preview + text-edit entry parity with Google Slides — idle hover outline, text-region I-beam, Enter/F2 entry, empty-placeholder 1-click, slow double-click, printable-char typing; 3-phase rollout (P0/P1/P2) |
| [slides-tables.md](slides/slides-tables.md)                                           | Slides tables — structured `TableElement` (rows × cols, per-cell `TextBody`, per-side borders, merges), Yorkie granular schema, PPTX import upgrade (replaces flatten path), 6-phase rollout                          |
| [slides-fonts.md](slides/slides-fonts.md)                                             | Rich fonts — data-driven Google Fonts catalog, per-font lazy loading, "More fonts…" search dialog, per-doc/used + recent accumulation, license-aware (OFL/Apache/UFL) build-time metadata + export embedding; shared with Docs |
| [slides-multi-select-resize.md](slides/slides-multi-select-resize.md)                 | Multi-select resize + rotate — wire the bbox handles for `> 1` selection: per-child bbox-relative scale, type dispatch (shape/text/group/table + connector endpoints), rigid bbox-centre rotate, Shift modifiers, single batched undo. Also unifies live preview: every resize / rotate routes through one `GHOST_ALPHA` paint path (original full opacity, ghost on top, handles on ghost) matching move + single-table-resize |
| [slides-theme-catalog.md](slides/slides-theme-catalog.md)                             | Theme catalog — de-brand the `default-light`/`default-dark` defaults (move waffle palette into one `wafflebase` theme), expand to ~23 Google-Slides-parity built-in themes, GS-style flat ordering; pure-data, no model change |

## Common

Infrastructure, frontend/backend, and cross-cutting concerns.

| Document                                               | Description                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [frontend.md](frontend.md)                             | Frontend package — app architecture, Yorkie integration, presence system, auth flow                |
| [backend.md](backend.md)                               | Backend package — NestJS modules, API reference, auth system, database schema, security            |
| [sharing.md](sharing.md)                               | URL-based token sharing with anonymous access and role-based permissions                           |
| [context-menu.md](context-menu.md)                     | Unified context menu — Radix ContextMenu, desktop/mobile parity, menu items                       |
| [rest-api.md](rest-api.md)                             | REST API v1 — workspace-scoped API keys, `/api/v1/` documents/tabs/cells/content endpoints, Yorkie service, CLI auth endpoints |
| [cli.md](cli.md)                                       | `wafflebase` CLI — OAuth login + API keys, ctx switching, docs/sheets/api-keys namespaces, content/export/import, agent integration |
| [harness-engineering.md](harness-engineering.md)       | Verification lane strategy, phase roadmap, rollout status, and harness v1 completion criteria      |
| [homepage.md](homepage.md)                             | Homepage landing page — sections, live demo, theme support, developer examples                     |
| [docs-site.md](docs-site.md)                           | Documentation site — VitePress setup, package structure, deployment under /docs subpath            |
| [design-system-unification.md](design-system-unification.md) | Design-system unification — shared tokens package, toolbar/popover consolidation, mobile and a11y roadmap |

## Archive

Single-PR design notes for shipped features whose ongoing design
surface lives elsewhere now sit under
[`archive/`](archive/README.md). They are kept for historical
context; they are not part of the load-bearing design surface a new
contributor should read first.

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
