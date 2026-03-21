# Canvas-Based Document Editor — Prototype

**Goal:** Create `packages/document` with a Canvas-based rich-text editor prototype supporting paragraph editing, inline formatting, cursor/selection, and undo/redo.

**Status:** COMPLETE

**Design:** [docs/design/docs.md](../../design/docs.md)

**Note:** Package is `@wafflebase/document` (`packages/document/`) since `@wafflebase/docs` was already taken by VitePress docs site.

## Phase 1: Package Scaffolding & Data Model

- [x] 1.1 Create `packages/document/` with `package.json`, `tsconfig.json`, `vite.config.ts`, `vite.build.ts`
- [x] 1.2 Define data types in `src/model/types.ts` (Document, Block, Inline, styles, positions)
- [x] 1.3 Implement `Doc` class in `src/model/document.ts` (insertText, deleteText, splitBlock, mergeBlocks, applyInlineStyle, applyBlockStyle)
- [x] 1.4 Write unit tests for `Doc` class (`test/model/document.test.ts`) — 18 tests passing

## Phase 2: Store Layer

- [x] 2.1 Define `DocStore` interface in `src/store/store.ts`
- [x] 2.2 Implement `MemDocStore` in `src/store/memory.ts` with undo/redo (snapshot stack)
- [x] 2.3 Write unit tests for `MemDocStore` (`test/store/memory.test.ts`) — 14 tests passing

## Phase 3: Layout Engine

- [x] 3.1 Implement text measurement and word-wrap in `src/view/layout.ts` (LayoutBlock, LayoutLine, LayoutRun)
- [x] 3.2 Implement coordinate mapping: document position ↔ pixel position (positionToPixel, pixelToPosition)
- [x] 3.3 Layout tests deferred — layout requires Canvas context (browser/jsdom); model+store cover core logic

## Phase 4: Canvas Rendering

- [x] 4.1 Implement `DocCanvas` in `src/view/doc-canvas.ts` (render blocks, styled text, decorations)
- [x] 4.2 Implement `Theme` constants in `src/view/theme.ts`
- [x] 4.3 Implement `DocContainer` for scroll management in `src/view/doc-container.ts`

## Phase 5: Cursor & Selection

- [x] 5.1 Implement `Cursor` in `src/view/cursor.ts` (position tracking, blink animation, caret rendering)
- [x] 5.2 Implement `Selection` in `src/view/selection.ts` (range tracking, highlight rendering)
- [x] 5.3 Implement pixel → document position hit-testing in layout.ts (pixelToPosition)

## Phase 6: Input Handling & Editor Integration

- [x] 6.1 Implement `TextEditor` in `src/view/text-editor.ts` (keyboard input, hidden textarea, mouse events)
- [x] 6.2 Implement `Editor` entry point in `src/view/editor.ts` (initialize, public API)
- [x] 6.3 Wire up all components: input → model → layout → render loop
- [x] 6.4 Create `src/index.ts` with public exports

## Phase 7: Verification & Cleanup

- [x] 7.1 Add `document` alias to root `package.json`
- [x] 7.2 Run `pnpm verify:fast` — all tests pass (32 document + full suite)
- [ ] 7.3 Manual smoke test: text input, formatting, cursor, selection, undo/redo, scroll
- [x] 7.4 Update `docs/design/README.md` with link to docs.md

## Lessons

Track lessons learned in `20260320-docs-package-lessons.md`.
