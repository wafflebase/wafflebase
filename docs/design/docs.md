---
title: docs
target-version: 0.2.0
---

# Canvas-Based Document Editor (Docs Package)

## Summary

A new `packages/docs` package (`@wafflebase/document`) that provides a Canvas-based rich-text document
editor, following the same architectural patterns as the existing `packages/sheets`.
The initial prototype focuses on paragraph-level text editing with inline
formatting, cursor/selection management, and undo/redo — all rendered on a
single HTML Canvas element.

### Goals

- Provide a minimal but functional Canvas-based document editor as a new
  monorepo package (`@wafflebase/document`).
- Support paragraph editing: text input/deletion, Enter to split blocks,
  Backspace to merge blocks.
- Support inline text formatting: bold, italic, underline, font size, font
  family, and text color.
- Implement word-wrap using Canvas `measureText` API.
- Implement cursor positioning (click and keyboard navigation) and text
  selection (drag and Shift+Arrow).
- Provide undo/redo with snapshot-based history.
- Follow the Store abstraction pattern from the sheet package (`DocStore`
  interface + `MemDocStore` implementation).
- Maintain the same build/test tooling (Vite library build, Vitest).

### Non-Goals

- Real-time collaboration (Yorkie integration) — deferred to a future phase.
- Tables, lists, images, headers/footers, pagination — deferred.
- Frontend integration (React component, routing) — deferred.
- Full IME composition handling — Korean IME (desktop + Mobile Safari
  workaround) is supported; other CJK languages deferred.
- Copy/paste with rich formatting — deferred.
- Performance optimization for very large documents — deferred.

## Data Model

The data model uses a simplified `Document → Block → Inline` hierarchy
inspired by Google Docs' structure but without UTF-16 index-based positioning.

```typescript
interface Document {
  blocks: Block[];
}

interface Block {
  id: string;
  type: 'paragraph';
  inlines: Inline[];
  style: BlockStyle;
}

interface Inline {
  text: string;
  style: InlineStyle;
}

interface BlockStyle {
  alignment: 'left' | 'center' | 'right';
  lineHeight: number;    // multiplier, e.g. 1.5
  marginTop: number;     // pixels
  marginBottom: number;  // pixels
}

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;     // points
  fontFamily?: string;
  color?: string;        // hex, e.g. "#000000"
}
```

### Design decisions

- **Block ID**: Each block has a unique `id` (nanoid) for stable references
  during insert/delete operations.
- **Inline splitting**: When formatting changes mid-text, the affected Inline
  is split into two or three Inlines. Adjacent Inlines with identical styles
  are merged to keep the model compact.
- **Block type**: Currently only `'paragraph'`. The discriminated union allows
  future extension to `'table' | 'heading' | 'list'` etc.

### Document manipulation

The `Doc` class provides methods to manipulate the document:

| Method | Description |
|--------|-------------|
| `insertText(pos, text)` | Insert text at cursor position |
| `deleteText(pos, length)` | Delete characters forward |
| `deleteBackward(pos)` | Backspace — delete one char or merge blocks |
| `splitBlock(blockId, offset)` | Enter — split a block into two at offset |
| `mergeBlocks(blockId, nextBlockId)` | Merge two adjacent blocks |
| `applyInlineStyle(range, style)` | Apply formatting to a text range |
| `applyBlockStyle(blockId, style)` | Change paragraph alignment, spacing |

A **position** is represented as `{ blockId: string, offset: number }` where
offset is the character index within the block's concatenated inline text.

## Store Abstraction

```typescript
interface DocStore {
  getDocument(): Document;
  setDocument(doc: Document): void;
  getBlock(id: string): Block | undefined;
  updateBlock(id: string, block: Block): void;
  insertBlock(index: number, block: Block): void;
  deleteBlock(id: string): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
```

`MemDocStore` implementation:
- Stores `Document` in memory.
- Undo/redo via snapshot stack (deep-clone before each mutation).
- Future `YorkieDocStore` will implement the same interface using Yorkie CRDT
  operations, following the pattern established by the sheet package.

## Canvas Rendering

### Architecture

| Component | File | Responsibility |
|-----------|------|----------------|
| **Editor** | `packages/docs/src/view/editor.ts` | Top-level entry point. Creates model + view. Returns public API. |
| **DocCanvas** | `packages/docs/src/view/doc-canvas.ts` | Renders blocks/inlines to Canvas. Applies text styles, draws backgrounds. |
| **Layout** | `packages/docs/src/view/layout.ts` | Text measurement, word-wrap, line breaking. Builds a layout tree of positioned lines/runs. |
| **Cursor** | `packages/docs/src/view/cursor.ts` | Cursor position tracking, blink animation, caret rendering. |
| **Selection** | `packages/docs/src/view/selection.ts` | Multi-line text selection: range tracking and highlight rendering. |
| **TextEditor** | `packages/docs/src/view/text-editor.ts` | Keyboard/mouse input handling. Dispatches to Doc model methods. |
| **Theme** | `packages/docs/src/view/theme.ts` | Colors, default fonts, spacing constants. |

### Rendering pipeline

```
1. Layout pass
   - For each block, concatenate inline text
   - Measure each inline run with Canvas measureText()
   - Break into wrapped lines respecting word boundaries
   - Compute Y offset for each line (cumulative height + margins)
   - Output: LayoutBlock[] with positioned LayoutLine[] and LayoutRun[]

2. Paint pass
   - Clear canvas
   - For each visible LayoutBlock (viewport culling):
     - For each LayoutLine:
       - For each LayoutRun: set font, color, draw text
       - Draw underline decoration if needed
   - Draw cursor (blinking caret line)
   - Draw selection highlight (blue rectangles behind selected text)

3. Input handling
   - Hidden <textarea> captures keyboard input (same pattern as sheet CellInput)
   - Mouse events mapped to document positions via layout tree hit-testing
   - Arrow keys / Home / End update cursor position
   - Shift+Arrow / drag updates selection range
```

### Layout data structures

```typescript
interface LayoutRun {
  inline: Inline;          // source inline
  text: string;            // substring of inline.text for this run
  x: number;               // x offset within line
  width: number;           // measured width
  inlineIndex: number;     // index into block.inlines
  charStart: number;       // char offset within the inline
  charEnd: number;         // char offset end within the inline
}

interface LayoutLine {
  runs: LayoutRun[];
  y: number;               // y offset from block top
  height: number;          // line height
  width: number;           // total line width
}

interface LayoutBlock {
  block: Block;
  x: number;               // left margin
  y: number;               // y offset from document top
  width: number;           // available width
  height: number;          // total block height including margins
  lines: LayoutLine[];
}
```

### Coordinate mapping

- **Document position** `{ blockId, offset }` → locate block in layout,
  walk lines/runs to find the character, return pixel `{ x, y }`.
- **Pixel position** `{ x, y }` → binary search layout blocks by Y, then
  walk lines/runs by X to find the nearest character boundary →
  `{ blockId, offset }`.

## Package Structure

```
packages/docs/
├── package.json            # @wafflebase/document, same build pattern as sheets
├── tsconfig.json
├── vite.config.ts          # dev config
├── vite.build.ts           # library build (es + cjs)
├── src/
│   ├── index.ts            # public API exports
│   ├── model/
│   │   ├── types.ts        # Document, Block, Inline, styles, positions
│   │   └── document.ts     # Doc class — document manipulation logic
│   ├── store/
│   │   ├── store.ts        # DocStore interface
│   │   └── memory.ts       # MemDocStore implementation
│   └── view/
│       ├── editor.ts       # Top-level initialize() entry point
│       ├── doc-canvas.ts   # Canvas rendering engine
│       ├── cursor.ts       # Cursor management
│       ├── selection.ts    # Selection management
│       ├── text-editor.ts  # Input handling (keyboard, mouse)
│       ├── doc-container.ts # Scroll management
│       ├── layout.ts       # Text measurement, word-wrap, layout tree
│       └── theme.ts        # Visual constants
└── test/
    ├── model/
    │   └── document.test.ts  # Doc manipulation tests
    └── store/
        └── memory.test.ts    # MemDocStore + undo/redo tests
```

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Canvas text measurement varies across browsers/OS | Inconsistent line breaks | Use a single canonical font stack; add tolerance in layout |
| Cursor positioning accuracy with proportional fonts | Misaligned caret | Per-character measurement caching in layout pass |
| Word-wrap performance on large paragraphs | Slow re-layout on every keystroke | Incremental layout: only re-measure the changed block |
| IME input complexity (CJK languages) | Broken input for non-Latin | Korean IME supported with Mobile Safari workaround; other CJK deferred |
| Hidden textarea synchronization with Canvas | Input focus issues | Follow sheet package's proven CellInput pattern |
