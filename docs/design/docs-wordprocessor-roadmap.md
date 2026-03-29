---
title: docs-wordprocessor-roadmap
target-version: 0.4.0
---

# Docs Word Processor Roadmap

## Summary

A roadmap to evolve Wafflebase Docs into a full-featured word processor on par
with Google Docs. The editor already supports basic paragraph editing, inline
formatting, pagination, and real-time collaboration. This document describes a
six-phase plan to close the remaining feature gap.

### Goals

- Reach feature parity with Google Docs for document editing
- Incrementally extend the existing data model (`Document → Block → Inline`)
- Keep each phase independently releasable
- Maintain compatibility with Yorkie CRDTs

### Non-Goals

- Google Docs ancillary services (Google Drive integration, Add-on marketplace, etc.)
- Offline editing
- Native mobile apps

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
| IME support (Korean, Japanese, Chinese) | ✅ |
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

## Data Model Evolution

Current model:

```typescript
type BlockType = 'paragraph' | 'title' | 'subtitle' | 'heading'
  | 'list-item' | 'horizontal-rule';

interface Block {
  id: string;
  type: BlockType;
  inlines: Inline[];
  style: BlockStyle;        // alignment now includes 'justify'
  headingLevel?: HeadingLevel;
  listKind?: 'ordered' | 'unordered';
  listLevel?: number;       // 0–8
}

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  superscript?: boolean;   // Phase 2
  subscript?: boolean;     // Phase 2
  href?: string;           // Phase 2
}
```

Target model (incrementally extended across phases):

```typescript
// Extend Block.type as a discriminated union
type BlockType =
  | 'paragraph'       // Phase 0 (current)
  | 'heading'         // Phase 1
  | 'list-item'       // Phase 1
  | 'horizontal-rule' // Phase 1
  | 'image'           // Phase 3
  | 'table'           // Phase 3
  | 'code-block'      // Phase 3
  | 'page-break';     // Phase 4

interface Block {
  id: string;
  type: BlockType;
  inlines: Inline[];
  style: BlockStyle;
  // Phase 1: Heading
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  // Phase 1: List
  listKind?: 'ordered' | 'unordered';
  listLevel?: number;  // 0–8
  // Phase 3: Image
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlign?: 'left' | 'center' | 'right';
  // Phase 3: Table
  tableData?: TableData;
}

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  // Phase 2
  href?: string;
  backgroundColor?: string;
  superscript?: boolean;
  subscript?: boolean;
}
```

> **Note**: Exact type definitions will be finalized in each phase's dedicated
> design document. The above is a directional sketch and may change during
> implementation (e.g., splitting Block into a union of per-type interfaces).

## Phase 1: Block Type Extensions ✅

**Goal**: Support headings, lists, and horizontal rules so documents can express
structural hierarchy.

**Status**: Complete — shipped in PR #83.

### 1.1 Heading (H1–H6) ✅

- `Block.type = 'heading'`, `headingLevel: 1–6`
- Default font-size mapping per level (H1: 24pt, H2: 20pt, H3: 16pt, H4: 14pt, H5: 12pt, H6: 11pt)
- Default weight per level (H1–H4: bold, H5–H6: normal)
- Layout engine applies heading defaults before reusing paragraph layout
- Google Docs-style dropdown with Title, Subtitle, H1–H3 (with styled previews and shortcut hints)
- Shortcut: Ctrl+Alt+0 (normal), Ctrl+Alt+1–6 (headings)

### 1.2 List (Ordered / Unordered) ✅

- `Block.type = 'list-item'`, `listKind`, `listLevel`
- Bullet markers: unordered (●, ○, ■ by level), ordered (1. a. i. cycling by level)
- Indent: 36px left margin per level
- Tab/Shift+Tab and Cmd+]/Cmd+[ to change indent level
- Enter on empty list item exits list (converts to paragraph)
- Auto-numbering: consecutive ordered list-items at the same level share a counter
- Toolbar toggle buttons with shortcuts (Cmd+Shift+7/8)

### 1.3 Horizontal Rule ✅

- `Block.type = 'horizontal-rule'`
- Content-free block with a fixed height (1px line + vertical padding)
- Markdown-style shortcut: typing `---` then Enter auto-converts

### 1.4 Title / Subtitle ✅

- `Block.type = 'title'` (26pt), `Block.type = 'subtitle'` (15pt, gray)
- Style defaults merged as base layer under explicit inline styles
- Available in the styles dropdown

### 1.5 Layout Engine Changes ✅

- Branch on block type inside `computeLayout()`
- Heading/Title/Subtitle: apply default style overrides via `resolveBlockInlines()`
- List: reserve marker area (left margin), render marker, adjust text region
- Horizontal rule: fixed-height block in layout
- Justify alignment: distribute extra space across word gaps (except last line)

### 1.6 Yorkie Integration ✅

- Serialize / deserialize new block-type attributes in the Yorkie Tree
- Backward compatibility: treat missing `type` as `'paragraph'`

### 1.7 Toolbar & Shortcuts ✅

- Toolbar grouped: Undo/Redo | Styles | Font Styles | Block Styles
- Highlight color picker (backgroundColor) — pulled forward from Phase 2
- Alignment dropdown with Left/Center/Right/Justify and shortcut hints
- All shortcuts: Cmd+Shift+L/E/R/J (align), Cmd+]/[ (indent), Cmd+Shift+7/8 (lists)
- Markdown auto-conversion: `#`→H1, `##`→H2, `-`→bullet, `1.`→ordered, `---`→HR

## Phase 2: Inline Extensions & Clipboard ✅

**Goal**: Support links, highlights, and clipboard operations for a practical
editing experience.

**Status**: Complete.

### 2.1 Hyperlink ✅

- `InlineStyle.href: string` — link rendering with blue text + underline
- Hover popover: URL preview with open / edit / remove buttons
- Ctrl+K: insert / edit link dialog
- Ctrl+Click / Cmd+Click: open link in new tab
- Auto-detect URLs: convert `https://...` to a link on Space or Enter
- Yorkie serialization for `href` attribute

### 2.2 Background Color (Highlight) ✅

- Add `InlineStyle.backgroundColor: string`
- Render colored rectangle behind text (independent of selection highlight)
- Toolbar highlight color picker
- *Completed in Phase 1 PR*

### 2.3 Superscript / Subscript ✅

- `InlineStyle.superscript` and `InlineStyle.subscript` (mutually exclusive)
- 60% font size reduction with baseline offset (up 40% / down 20%)
- Layout engine preserves original font size for line height
- Shortcuts: Cmd+. (superscript), Cmd+, (subscript)
- Toolbar toggle buttons
- Yorkie serialization

### 2.4 Clipboard ✅

- **Internal copy / paste**: JSON serialization with `application/x-waffledocs` MIME type
- **External HTML paste**: parses bold, italic, underline, strikethrough, color, fontSize, href
- **Copy formatting**: Cmd+Shift+C copies style, Cmd+Alt+V applies it
- **Plain-text paste**: Cmd+Shift+V strips all formatting

### 2.5 Find & Replace ✅

- Cmd+F: search bar at top-right of document
- Cmd+H: search + replace bar
- Match highlighting (yellow inactive, orange active) with prev/next navigation
- Replace and Replace All with undo support
- Case-sensitive and regex toggle options
- Auto-invalidation on document mutation

## Phase 3: Complex Blocks

**Goal**: Support images, tables, and code blocks for rich, mixed-content
documents.

### 3.1 Image

- `Block.type = 'image'`
- Source: URL or file upload (backend storage)
- Alignment: left / center / right
- Resize: corner handle drag
- Canvas rendering via `drawImage()`, layout reserves space for image dimensions
- Alt text support

### 3.2 Table ✅

- `Block.type = 'table'`
- `TableData`: `{ rows: TableRow[], columnWidths: number[] }`
- `TableRow`: `{ cells: TableCell[] }`
- `TableCell`: `{ blocks: Block[], style: CellStyle, rowSpan?, colSpan? }`
- Cells as Block[] containers (paragraphs, lists, headings inside cells)
- Inline formatting inside cells
- Row / column add & delete, cell merge / split
- Table selection: cell / row / column / whole table
- Tab to move to next cell
- Layout: column-width-based cell layout, auto-calculated row height
- Yorkie Tree CRDT: row → cell → block → inline → text node hierarchy
- Granular store updates: cell-level `editByPath` for concurrent editing
- See `docs-tables.md`, `docs-table-ui.md`, `docs-table-crdt.md` for details

### 3.3 Code Block

- `Block.type = 'code-block'`
- Monospace font with distinct background color
- Inline formatting disabled (plain text inside code blocks)
- Auto-convert on ` ``` ` input
- Future extension: syntax highlighting (Phase 6+)

## Phase 4: Page Features

**Goal**: Provide print-ready page features for professional documents.

### 4.1 Header / Footer

- Fixed regions at page top / bottom
- Editable inline content (text, page-number variable)
- Different header for odd / even pages option
- Different first-page header option

### 4.2 Page Break

- `Block.type = 'page-break'`
- Forces a page split at the insertion point
- Shortcut: Ctrl+Enter

### 4.3 Section Break

- Per-section PageSetup (orientation, margins, paper size)
- Continuous and next-page section break types

### 4.4 Table of Contents

- Auto-generated from heading blocks
- Click to scroll to the corresponding heading
- Document outline sidebar (heading navigation)

## Phase 5: Advanced Collaboration

**Goal**: Provide review and feedback features for team collaboration.

### 5.1 Comments

- Anchor comments to text ranges
- Display comment threads in a right sidebar
- Reply, resolve, and reopen
- Highlight anchored text
- Real-time comment sync via Yorkie

### 5.2 Suggestion Mode

- Track insertions / deletions (green for inserts, red strikethrough for deletions)
- Accept / reject UI
- Mode switching: Editing / Suggesting / Viewing

### 5.3 Version History

- Snapshot list based on Yorkie document history
- Timeline UI to preview previous versions
- Restore to a previous version
- Name versions

## Phase 6: Advanced Features

**Goal**: Provide power-user features for professional document authoring.

### 6.1 Multi-Column Layout

- 2–3 column layouts
- Column configuration per section

### 6.2 Footnotes / Endnotes

- Footnotes: numbered references at page bottom
- Endnotes: collected at the end of the document

### 6.3 Spell Check

- Integration with an external spell-check API
- Red underline indicators with right-click correction suggestions

### 6.4 Print / PDF Export

- Browser-based printing via `window.print()`
- Canvas-to-PDF conversion (server-side or client-side)

### 6.5 Named Styles

- Preset styles: "Heading 1", "Heading 2", "Body", "Quote", etc.
- Editing a style cascades to all blocks using it
- Style dropdown UI

### 6.6 Keyboard Shortcuts

- Full formatting shortcut mapping (Google Docs compatible)
- Shortcut help dialog (Ctrl+/)

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data model extensions break backward compatibility | Existing documents fail to load | Extend with optional fields; provide migration utilities |
| Table layout complexity | Implementation delays | Start with simple fixed column widths; iterate |
| Yorkie Tree CRDT sync for complex blocks | Conflict resolution difficulties | Run Yorkie integration tests first in each phase |
| Canvas rendering performance (images, tables) | Scroll jank | Viewport culling + image caching |
| Clipboard HTML parsing differs across browsers | Formatting loss | Parse only standard tags; fall back to plain text |
| Inter-phase dependencies limit parallel work | Schedule delays | Phases 1 & 2 are independent; phase 3+ is sequential |

## Phase Dependencies

```text
Phase 1 (Block Types) ──┐
                        ├──→ Phase 3 (Complex Blocks) ──→ Phase 4 (Page Features)
Phase 2 (Inline + Clipboard) ┘                                    │
                                                                   ↓
                                                   Phase 5 (Collaboration) ──→ Phase 6 (Advanced)
```

Phases 1 and 2 can proceed in parallel. Phase 3 onward is sequential.
