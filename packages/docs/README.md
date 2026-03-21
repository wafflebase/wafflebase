# @wafflebase/docs

Canvas-based document editor for Wafflebase. Provides a paragraph-level rich-text editor with inline formatting, word-processor-style pagination, and a store abstraction for persistence.

## Architecture

```
┌─────────────────┐ ┌─────────────────┐ ┌────────────────┐
│    Editor       │ │    Layout       │ │     Store      │
│ ┌─────────────┐ │ │ ┌─────────────┐ │ │ ┌────────────┐ │
│ │ initialize()│ │ │ │ Word-wrap   │ │ │ │ Snapshot   │ │
│ │ EditorAPI   │ │ │ │ Measurement │ │ │ │ Undo/Redo  │ │
│ └─────────────┘ │ │ └─────────────┘ │ │ └────────────┘ │
│                 │ │                 │ └────────────────┘
│ ┌─────────────┐ │ │ ┌─────────────┐ │ ┌────────────────┐
│ │ TextEditor  │ │ │ │ Pagination  │ │ │   Doc Model    │
│ │ Input/IME   │ │ │ │ Pages/Gaps  │ │ │ ┌────────────┐ │
│ └─────────────┘ │ │ └─────────────┘ │ │ │ Block →    │ │
│                 │ │                 │ │ │   Inline   │ │
│ ┌─────────────┐ │ │ ┌─────────────┐ │ │ └────────────┘ │
│ │ DocCanvas   │ │ │ │ Cursor      │ │ └────────────────┘
│ │ Rendering   │ │ │ │ Selection   │ │
│ └─────────────┘ │ │ └─────────────┘ │
└─────────────────┘ └─────────────────┘
```

- **Editor** — Top-level entry point. `initialize(container, store?)` mounts the editor and returns `EditorAPI`.
- **Layout** — Measures text with Canvas `measureText()`, word-wraps into lines, then paginates into discrete pages.
- **Store** — `DocStore` interface decouples the editor from persistence. `MemDocStore` provides snapshot-based undo/redo.
- **Doc Model** — `Document → Block → Inline` hierarchy. Blocks are paragraphs; inlines carry styled text segments.

## Key Concepts

| Concept | Description |
|---------|-------------|
| `Document` | Root model — array of `Block`s + optional `PageSetup` |
| `Block` | Paragraph with `id`, `inlines[]`, and `BlockStyle` (alignment, line height, margins) |
| `Inline` | Text segment with `InlineStyle` (bold, italic, underline, fontSize, color) |
| `DocPosition` | `{ blockId, offset }` — cursor position within a block |
| `DocRange` | `{ anchor, focus }` — text selection range |
| `PageSetup` | Paper size, orientation, margins (Letter/A4/Legal presets) |
| `PaginatedLayout` | Pages of lines split at line boundaries with gap/shadow rendering |

## Public API

Exports from `src/index.ts`:

```typescript
// View
initialize, type EditorAPI

// Data model
type Document, Block, Inline, BlockStyle, InlineStyle, DocPosition, DocRange
type PageSetup, PageMargins, PaperSize
Doc, DEFAULT_BLOCK_STYLE, DEFAULT_INLINE_STYLE, DEFAULT_PAGE_SETUP, PAPER_SIZES

// Store
type DocStore
MemDocStore

// Layout & Pagination
computeLayout, paginateLayout, getTotalHeight
type DocumentLayout, LayoutBlock, LayoutLine, LayoutRun
type PaginatedLayout, LayoutPage, PageLine

// Rendering
DocCanvas, Cursor, Selection, Theme, buildFont
```

## Usage

```typescript
import { initialize, MemDocStore } from '@wafflebase/docs';

const store = new MemDocStore();
const container = document.getElementById('editor')!;
const editor = initialize(container, store);

editor.applyStyle({ bold: true });              // Format selection
editor.applyBlockStyle({ alignment: 'center' }); // Align paragraph
editor.undo();
editor.redo();
editor.dispose();                                // Clean up
```

## Development

```bash
pnpm install              # Install dependencies (from monorepo root)
pnpm --filter @wafflebase/docs dev          # Start Vite dev server with demo
pnpm --filter @wafflebase/docs test         # Run unit tests (Vitest)
pnpm --filter @wafflebase/docs build        # Library build (ESM + CJS)
pnpm --filter @wafflebase/docs typecheck    # TypeScript check
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (ES2020, strict) |
| Rendering | HTML5 Canvas |
| Build | Vite (library mode) |
| Tests | Vitest + jsdom |
| IME | Custom Korean Hangul assembler for Mobile Safari |

## Further Reading

- [docs.md](../../docs/design/docs.md) — Full design document (data model, layout, rendering)
- [docs-pagination.md](../../docs/design/docs-pagination.md) — Pagination design (page setup, coordinate mapping)
