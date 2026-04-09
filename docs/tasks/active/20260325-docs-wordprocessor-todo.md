# Docs Word Processor Roadmap — Task Tracking

Design doc: [docs-wordprocessor-roadmap.md](../../design/docs-wordprocessor-roadmap.md)

## Phase 1: Block Type Extensions ✅

- [x] 1.1 Heading (H1–H6) — data model, layout, rendering, toolbar dropdown
- [x] 1.2 List (Ordered/Unordered) — data model, marker rendering, Tab level control
- [x] 1.3 Horizontal Rule — data model, rendering, `---` auto-convert
- [x] 1.4 Title / Subtitle — data model, style defaults, dropdown
- [x] 1.5 Layout engine block-type branching + justify alignment
- [x] 1.6 Yorkie serialization / deserialization + backward compatibility
- [x] 1.7 Toolbar grouping (Undo/Redo | Styles | Font Styles | Block Styles)
- [x] 1.8 Highlight color (backgroundColor) — pulled forward from Phase 2
- [x] 1.9 Keyboard shortcuts — align (⌘⇧L/E/R/J), indent (⌘]/[), lists (⌘⇧7/8), headings (⌘⌥0-6)
- [x] 1.10 Shortcut hints in toolbar tooltips and dropdown items

## Phase 2: Inline Extensions & Clipboard ✅

- [x] 2.1 Hyperlink — href, popover, Ctrl+K, URL auto-detect
- [x] 2.2 Background Color (Highlight) — *completed in Phase 1*
- [x] 2.3 Superscript / Subscript — font scaling, baseline offset
- [x] 2.4 Clipboard — internal formatted copy/paste, external HTML parsing, format painting
- [x] 2.5 Find & Replace — search bar, match highlight, replace

## Phase 3: Complex Blocks

- [x] 3.1 Image — insert, resize, alignment, backend storage
- [x] 3.2 Table — data model, cell editing, row/column CRUD, cell merge
- [ ] 3.3 Code Block — monospace, background color, ``` auto-convert

## Phase 4: Page Features

- [x] 4.1 Header / Footer — fixed regions, page numbers
- [x] 4.2 Page Break — Ctrl+Enter, forced split
- [ ] 4.3 Section Break — per-section PageSetup
- [ ] 4.4 Table of Contents — heading-based auto-generation, outline sidebar

## Phase 5: Advanced Collaboration

- [ ] 5.1 Comments — text anchors, threads, resolve / reopen
- [ ] 5.2 Suggestion Mode — change tracking, accept / reject
- [ ] 5.3 Version History — snapshot list, preview, restore

## Phase 6: Advanced Features

- [ ] 6.1 Multi-Column Layout
- [ ] 6.2 Footnotes / Endnotes
- [ ] 6.3 Spell Check
- [ ] 6.4 Print / PDF Export
- [ ] 6.5 Named Styles
- [ ] 6.6 Full Keyboard Shortcuts mapping
