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
- **Store** — `DocStore` interface decouples the editor from persistence. `MemDocStore` provides snapshot-based undo/redo for the in-package dev store; the production `YorkieDocStore` (frontend package) drives undo/redo through Yorkie `doc.history` (see [docs-collaboration.md](../../docs/design/docs/docs-collaboration.md)).
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

> The snippet above is the core surface. `src/index.ts` now exports many more
> shipped subsystems — tables (`TableMergeContext`), named styles
> (`StyleId`/`NamedStyleDef`/`DocStyles`), spell check, DOCX/PDF import-export,
> comments, find & replace, hyperlinks, and images. See the per-feature design
> docs indexed under **Docs** in [docs/design/README.md](../../docs/design/README.md).

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

- [docs.md](../../docs/design/docs/docs.md) — Full design document (data model, layout, rendering)
- [docs-pagination.md](../../docs/design/docs/docs-pagination.md) — Pagination design (page setup, coordinate mapping)

The complete set of per-feature docs design documents (collaboration, tables,
images, DOCX/PDF import-export, comments, spell check, named styles, font
controls, ruler, presence, header/footer, intent-preserving edits, context
menu, IME underline, …) is indexed under the **Docs** section of
[docs/design/README.md](../../docs/design/README.md).
