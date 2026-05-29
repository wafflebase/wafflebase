---
title: docs-wordprocessor-roadmap
target-version: 0.4.0
---

# Docs Word Processor Roadmap

## Summary

A roadmap to evolve Wafflebase Docs into a full-featured word processor
on par with Google Docs. The editor already supports basic paragraph
editing, inline formatting, pagination, real-time collaboration,
tables, images, headers/footers, and comments. This document tracks
the remaining feature gap as a compact index; each in-flight or
planned item links to (or will link to) its own design doc.

### Goals

- Reach feature parity with Google Docs for document editing.
- Incrementally extend the existing data model (`Document → Block →
  Inline`).
- Keep each phase independently releasable.
- Maintain compatibility with Yorkie CRDTs.

### Non-Goals

- Google Docs ancillary services (Google Drive integration, Add-on
  marketplace, etc.).
- Offline editing.
- Native mobile apps.

## Current State

| Area | Status |
|------|--------|
| Text editing (insert / delete / block split & merge) | ✅ |
| Inline formatting (Bold, Italic, Underline, Strikethrough, color, font, size) | ✅ |
| Inline highlight (backgroundColor) | ✅ |
| Block formatting (alignment incl. justify, line height, margins, indent) | ✅ |
| Headings (H1–H6), Title, Subtitle | ✅ |
| Lists (ordered / unordered, nested levels, marker rendering) | ✅ |
| Horizontal rule | ✅ |
| Pagination (Letter / A4 / Legal, margins, page shadows) | ✅ |
| IME support (Korean, Japanese, Chinese — partial) | ✅ |
| Real-time collaboration (Yorkie CRDT, peer cursors & selections) | ✅ |
| Undo / Redo (snapshot-based) | ✅ |
| Ruler & draggable margin / indent controls | ✅ |
| Dark mode | ✅ |
| Canvas rendering optimizations (incremental layout, viewport culling) | ✅ |
| Keyboard shortcuts (Google Docs compatible) | ✅ Partial |
| Superscript / Subscript | ✅ |
| Hyperlinks (href, popover, Ctrl+K, auto-detect) | ✅ |
| Clipboard (JSON, HTML paste, format painter) | ✅ |
| Find & Replace (Ctrl+F/H, match highlighting) | ✅ |
| Tables (cells as Block[], row/column ops, nesting, copy-paste, row split) | ✅ |
| Images (insert, resize, rotate, crop, alignment) | ✅ |
| Header / Footer (per-page editable regions) | ✅ |
| Comments (text-range threads, posRange anchors) | ✅ |
| Code block | ❌ Planned |
| Page break (manual `Ctrl+Enter`) | ❌ Planned |
| Section break (per-section PageSetup) | ❌ Planned |
| Table of contents | ❌ Planned |
| Suggestion mode (track changes) | ❌ Planned |
| Version history | ❌ Planned |
| Multi-column layout, footnotes, spell check, named styles | ❌ Planned |

## Shipped Phases

The phase numbering below matches the original 6-phase plan. Each
shipped phase has its own design doc(s) under `docs/design/docs/` or
in the README index — the roadmap no longer duplicates their content.

| Phase | Scope | Where it lives now |
|------|------|----|
| Phase 1: Block type extensions | Headings, lists, horizontal rule, title/subtitle, layout-engine branching, toolbar grouping, markdown auto-conversion | This `Current State` table; PR #83 in git history |
| Phase 2: Inline + clipboard + find-replace | Hyperlinks, highlight, superscript/subscript, JSON+HTML clipboard, format painter, Find & Replace | This `Current State` table; PR notes in git history |
| Phase 3.2: Tables | Cells as `Block[]` containers, row/column ops, cell merge, Tree CRDT | [`docs-tables.md`](docs-tables.md) (umbrella) and the per-feature docs under [`tables/`](tables/) — UI, resize, copy-paste, row splitting, nested tables |
| Phase 3.1: Images | Insert, resize, rotate, crop, Image Options panel | [`docs-image-editing.md`](docs-image-editing.md) |
| Phase 4.1: Header / Footer | Editable per-page header/footer regions | [`docs-header-footer.md`](docs-header-footer.md) |
| Phase 5.1: Comments | Text-range threads, posRange anchors, orphan preservation | [`docs-comments.md`](docs-comments.md) |

## Planned Phases

Compact stubs for items not yet in flight. Each gets its own design
doc when it picks up an owner.

### Phase 3.3: Code Block

`Block.type = 'code-block'`. Monospace font, distinct background,
inline formatting disabled inside the block, auto-convert on ``` ` ` ` ```
input. Syntax highlighting is a follow-up.

### Phase 4.2: Page Break

`Block.type = 'page-break'`. Forces a page split. Shortcut:
`Ctrl+Enter`. Already handled at the layout level via `page-break`
blocks injected by find/replace; needs a first-class UI affordance.

### Phase 4.3: Section Break

Per-section `PageSetup` (orientation, margins, paper size). Continuous
and next-page section break types. Depends on extending
[`docs-pagination.md`](docs-pagination.md) to multi-section documents.

### Phase 4.4: Table of Contents

Auto-generated from heading blocks; click to scroll. Document outline
sidebar for heading navigation.

### Phase 5.2: Suggestion Mode

Track insertions / deletions (green for inserts, red strikethrough for
deletions). Accept / reject UI. Mode switching: Editing / Suggesting /
Viewing.

### Phase 5.3: Version History

Snapshot list from Yorkie document history. Timeline UI, restore
previous versions, name versions.

### Phase 6: Advanced

Multi-column layouts (2–3 columns), footnotes / endnotes, spell check
(external API), named styles (cascading style edits), shortcut help
dialog (`Ctrl+/`).

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data model extensions break backward compatibility | Existing documents fail to load | Extend with optional fields; provide migration utilities |
| Yorkie Tree CRDT sync for complex blocks | Conflict resolution difficulties | Run Yorkie integration tests first in each phase |
| Canvas rendering performance (images, tables) | Scroll jank | Viewport culling + image caching; see [`docs-rendering-optimization.md`](docs-rendering-optimization.md) |
| Clipboard HTML parsing differs across browsers | Formatting loss | Parse only standard tags; fall back to plain text |

## Phase Dependencies

```text
Phase 1 (Block Types) ✅ ──┐
                           ├──→ Phase 3 (Complex Blocks) ──→ Phase 4 (Page Features)
Phase 2 (Inline + Clipboard) ✅ ┘                                    │
                                                                      ↓
                                                       Phase 5 (Collaboration) ──→ Phase 6 (Advanced)
```

Phases 1, 2, 3.1/3.2, 4.1, 5.1 have shipped. Phases 3.3, 4.2–4.4, 5.2,
5.3, 6 remain in this roadmap.
