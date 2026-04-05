# Docs Phase 2: Inline Extensions & Clipboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add superscript/subscript, hyperlinks, clipboard operations, and find & replace to the Docs word processor.

**Architecture:** Extend the existing `InlineStyle` type with three new optional fields (`superscript`, `subscript`, `href`). Each feature follows the same vertical slice: data model → layout/rendering → shortcuts/toolbar → Yorkie serialization. Clipboard and Find & Replace are independent modules layered on top.

**Tech Stack:** TypeScript, Vitest, Canvas API, Yorkie CRDT

**Spec:** `docs/superpowers/specs/2026-03-26-docs-phase2-inline-clipboard-design.md`

---

## File Map

| File | Responsibility | Tasks |
|------|---------------|-------|
| `packages/docs/src/model/types.ts` | InlineStyle type, `inlineStylesEqual()`, constants | 1, 5 |
| `packages/docs/src/model/document.ts` | `Doc` class, `applyStyleToBlock()`, `searchText()` | 1, 5, 11 |
| `packages/docs/src/view/layout.ts` | `resolveBlockInlines()`, `getLineMaxFontSizePx()`, line measurement | 2 |
| `packages/docs/src/view/doc-canvas.ts` | Text rendering, baseline shift, highlight rects | 2, 6, 12 |
| `packages/docs/src/view/text-editor.ts` | Shortcuts, `toggleStyle()`, `clearFormatting()`, clipboard handlers | 3, 7, 8, 9, 10, 13 |
| `packages/docs/src/view/editor.ts` | `EditorAPI` public interface | 3, 7 |
| `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` | Toolbar buttons | 3, 7 |
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | `serializeInlineStyle()`, `parseInlineStyle()` | 4, 7 |
| `packages/docs/src/view/clipboard.ts` *(new)* | JSON serialization, HTML parsing | 9 |
| `packages/docs/src/view/url-detect.ts` *(new)* | URL auto-detection utility | 8b |
| `packages/docs/src/view/find-replace.ts` *(new)* | Search state, match tracking | 13 |
| `packages/docs/test/model/document.test.ts` | Doc model tests | 1, 5, 11 |
| `packages/docs/test/model/types.test.ts` | Type utility tests | 1, 5 |
| `packages/docs/test/view/layout.test.ts` | Layout tests | 2 |
| `packages/docs/test/view/clipboard.test.ts` *(new)* | Clipboard tests | 9, 10 |
| `packages/docs/test/view/url-detect.test.ts` *(new)* | URL detection tests | 8b |
| `packages/docs/test/view/find-replace.test.ts` *(new)* | Find & replace tests | 11, 12 |

---

## Branch Setup

- [x] **Step 1: Create branch**

```bash
git checkout main
git pull origin main
git checkout -b feat/docs-phase2
```

---

## Feature 1: Superscript / Subscript

### Task 1: Data Model — InlineStyle, mutual exclusion, helpers

**Files:**
- Modify: `packages/docs/src/model/types.ts:64-73` (InlineStyle), `:211-222` (inlineStylesEqual)
- Modify: `packages/docs/src/model/document.ts:394-442` (applyStyleToBlock)
- Test: `packages/docs/test/model/types.test.ts`
- Test: `packages/docs/test/model/document.test.ts`

- [x] **Step 1: Write failing tests for `inlineStylesEqual` with new fields**

In `packages/docs/test/model/types.test.ts`, add:

```typescript
it('should detect superscript difference', () => {
  expect(inlineStylesEqual({ superscript: true }, {})).toBe(false);
  expect(inlineStylesEqual({ superscript: true }, { superscript: true })).toBe(true);
});

it('should detect subscript difference', () => {
  expect(inlineStylesEqual({ subscript: true }, {})).toBe(false);
  expect(inlineStylesEqual({ subscript: true }, { subscript: true })).toBe(true);
});
```

- [x] **Step 2: Run tests — expect FAIL** (properties don't exist)

```bash
cd packages/docs && pnpm test
```

- [x] **Step 3: Add `superscript` and `subscript` to `InlineStyle`**

In `packages/docs/src/model/types.ts`, add to the `InlineStyle` interface (after `backgroundColor`):

```typescript
superscript?: boolean;
subscript?: boolean;
```

- [x] **Step 4: Update `inlineStylesEqual()` to compare new fields**

In `packages/docs/src/model/types.ts`, inside `inlineStylesEqual()`, add:

```typescript
if (a.superscript !== b.superscript) return false;
if (a.subscript !== b.subscript) return false;
```

- [x] **Step 5: Run tests — expect PASS**

```bash
cd packages/docs && pnpm test
```

- [x] **Step 6: Write failing test for mutual exclusion**

In `packages/docs/test/model/document.test.ts`, add:

```typescript
describe('superscript/subscript mutual exclusion', () => {
  it('should clear subscript when applying superscript', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'Hello');
    const range = {
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    };
    doc.applyInlineStyle(range, { subscript: true });
    expect(doc.document.blocks[0].inlines[0].style.subscript).toBe(true);

    doc.applyInlineStyle(range, { superscript: true });
    expect(doc.document.blocks[0].inlines[0].style.superscript).toBe(true);
    expect(doc.document.blocks[0].inlines[0].style.subscript).toBeUndefined();
  });

  it('should clear superscript when applying subscript', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'Hello');
    const range = {
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    };
    doc.applyInlineStyle(range, { superscript: true });
    doc.applyInlineStyle(range, { subscript: true });
    expect(doc.document.blocks[0].inlines[0].style.subscript).toBe(true);
    expect(doc.document.blocks[0].inlines[0].style.superscript).toBeUndefined();
  });
});
```

- [x] **Step 7: Run tests — expect FAIL** (no mutual exclusion logic)

- [x] **Step 8: Implement mutual exclusion in `applyStyleToBlock()`**

In `packages/docs/src/model/document.ts`, inside `applyStyleToBlock()`, before applying the style to the overlap part, add:

```typescript
// Mutual exclusion: superscript and subscript cannot coexist
const resolvedStyle = { ...style };
if (resolvedStyle.superscript) {
  resolvedStyle.subscript = undefined;
} else if (resolvedStyle.subscript) {
  resolvedStyle.superscript = undefined;
}
```

Use `resolvedStyle` instead of `style` when merging into the overlap inline's style.

- [x] **Step 9: Run tests — expect PASS**

```bash
cd packages/docs && pnpm test
```

- [x] **Step 10: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/src/model/document.ts \
  packages/docs/test/model/types.test.ts packages/docs/test/model/document.test.ts
git commit -m "feat(docs): add superscript/subscript to InlineStyle with mutual exclusion"
```

---

### Task 2: Layout & Rendering — font size reduction, baseline shift

**Files:**
- Modify: `packages/docs/src/view/layout.ts:423-434` (getLineMaxFontSizePx)
- Modify: `packages/docs/src/view/doc-canvas.ts:218-267` (renderRun)
- Test: `packages/docs/test/view/layout.test.ts`

- [x] **Step 1: Write failing test for layout with superscript**

In `packages/docs/test/view/layout.test.ts`, add:

```typescript
describe('superscript/subscript layout', () => {
  it('should use reduced font size for width measurement', () => {
    const block = createBlock('paragraph');
    block.inlines = [
      { text: 'E=mc', style: {} },
      { text: '2', style: { superscript: true } },
    ];
    const ctx = mockCtx();
    const result = computeLayout([block], ctx, 500);
    // The superscript '2' run should have reduced width
    const superRun = result.layout.blocks[0].lines[0].runs.find(
      (r) => r.text === '2',
    );
    expect(superRun).toBeDefined();
    // With 60% font size, width should be smaller than normal
  });

  it('should preserve original font size for line height with superscript', () => {
    const block = createBlock('paragraph');
    block.inlines = [
      { text: '2', style: { superscript: true, fontSize: 11 } },
    ];
    const ctx = mockCtx();
    const result = computeLayout([block], ctx, 500);
    // Line height should use original font size (11pt), not reduced (6.6pt)
    const normalBlock = createBlock('paragraph');
    normalBlock.inlines = [{ text: 'X', style: { fontSize: 11 } }];
    const normalResult = computeLayout([normalBlock], ctx, 500);
    expect(result.layout.blocks[0].lines[0].height).toBeGreaterThanOrEqual(
      normalResult.layout.blocks[0].lines[0].height,
    );
  });
});
```

> **Note:** `layoutBlock` is private; use the exported `computeLayout()` and access results via `result.layout.blocks[0].lines`.

- [x] **Step 2: Run tests — expect FAIL**

- [x] **Step 3: Update layout to handle superscript/subscript font size**

In `packages/docs/src/view/layout.ts`:

1. In the text measurement section, when computing run width, if `style.superscript || style.subscript`, multiply `fontSize` by `0.6` for `measureText` only.

2. In `getLineMaxFontSizePx()`, use the **original** font size (not reduced) when the run has superscript/subscript, so line height is not shrunk.

- [x] **Step 4: Run tests — expect PASS**

- [x] **Step 5: Add baseline shift rendering in `doc-canvas.ts`**

In `packages/docs/src/view/doc-canvas.ts`, inside the render run method:

```typescript
// Before fillText, adjust font size and baseline for super/subscript
let renderFontSize = fontSizePx;
let baselineOffset = 0;
if (style.superscript) {
  renderFontSize = fontSizePx * 0.6;
  baselineOffset = -(fontSizePx * 0.4);
} else if (style.subscript) {
  renderFontSize = fontSizePx * 0.6;
  baselineOffset = fontSizePx * 0.2;
}
// Use renderFontSize for buildFont()
// Add baselineOffset to baselineY for fillText()
```

- [x] **Step 6: Run full verify**

```bash
pnpm verify:fast
```

- [x] **Step 7: Commit**

```bash
git add packages/docs/src/view/layout.ts packages/docs/src/view/doc-canvas.ts \
  packages/docs/test/view/layout.test.ts
git commit -m "feat(docs): render superscript/subscript with font reduction and baseline shift"
```

---

### Task 3: Shortcuts, clearFormatting & Toolbar

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts:250-469` (handleKeyDown), `:1036-1058` (clearFormatting)
- Modify: `packages/docs/src/view/editor.ts:19-58` (EditorAPI)
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`

- [x] **Step 1: Add `Cmd+.` and `Cmd+,` shortcuts in `text-editor.ts`**

In `handleKeyDown()`, add after the strikethrough shortcut block:

```typescript
// Superscript: Cmd+.
if ((e.metaKey || e.ctrlKey) && e.key === '.') {
  e.preventDefault();
  this.toggleStyle({ superscript: true });
  return;
}
// Subscript: Cmd+,
if ((e.metaKey || e.ctrlKey) && e.key === ',') {
  e.preventDefault();
  this.toggleStyle({ subscript: true });
  return;
}
```

- [x] **Step 2: Update `clearFormatting()` to clear new fields**

In `text-editor.ts`, `clearFormatting()`, add to the style object:

```typescript
superscript: undefined,
subscript: undefined,
```

- [x] **Step 3: Add toolbar buttons in `docs-formatting-toolbar.tsx`**

Add superscript and subscript toggle buttons after the underline button. Follow the existing pattern (read `current.superscript`, toggle via `editor.applyStyle({ superscript: !current.superscript })`). Use `Superscript` and `Subscript` icons from lucide-react.

- [x] **Step 4: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/text-editor.ts packages/docs/src/view/editor.ts \
  packages/frontend/src/app/docs/docs-formatting-toolbar.tsx
git commit -m "feat(docs): add superscript/subscript shortcuts and toolbar buttons"
```

---

### Task 4: Yorkie Serialization for superscript/subscript

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts:35-60`

- [x] **Step 1: Update `serializeInlineStyle()`**

Add after the `strikethrough` line:

```typescript
setIfDefined(attrs, 'superscript', style.superscript);
setIfDefined(attrs, 'subscript', style.subscript);
```

- [x] **Step 2: Update `parseInlineStyle()`**

Add parsing for the new fields:

```typescript
if (attrs.superscript !== undefined) style.superscript = attrs.superscript === 'true';
if (attrs.subscript !== undefined) style.subscript = attrs.subscript === 'true';
```

- [x] **Step 3: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "feat(docs): serialize superscript/subscript in Yorkie Tree attributes"
```

---

## Feature 2: Hyperlink

### Task 5: Data Model — `href` in InlineStyle

**Files:**
- Modify: `packages/docs/src/model/types.ts:64-73` (InlineStyle), `:211-222` (inlineStylesEqual)
- Test: `packages/docs/test/model/types.test.ts`
- Test: `packages/docs/test/model/document.test.ts`

- [x] **Step 1: Write failing test for `inlineStylesEqual` with `href`**

In `packages/docs/test/model/types.test.ts`:

```typescript
it('should detect href difference', () => {
  expect(inlineStylesEqual({ href: 'https://example.com' }, {})).toBe(false);
  expect(
    inlineStylesEqual(
      { href: 'https://example.com' },
      { href: 'https://example.com' },
    ),
  ).toBe(true);
});
```

- [x] **Step 2: Run tests — expect FAIL**

- [x] **Step 3: Add `href` to `InlineStyle` and update `inlineStylesEqual()`**

In `types.ts`, add to `InlineStyle`:

```typescript
href?: string;
```

In `inlineStylesEqual()`, add:

```typescript
if (a.href !== b.href) return false;
```

- [x] **Step 4: Write test for applying href as inline style**

In `packages/docs/test/model/document.test.ts`:

```typescript
describe('hyperlink', () => {
  it('should apply href to selected text', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'click here');
    const range = {
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 10 },
    };
    doc.applyInlineStyle(range, { href: 'https://example.com' });
    expect(doc.document.blocks[0].inlines[0].style.href).toBe('https://example.com');
  });

  it('should remove href by setting undefined', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'link');
    const range = {
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 4 },
    };
    doc.applyInlineStyle(range, { href: 'https://example.com' });
    doc.applyInlineStyle(range, { href: undefined });
    expect(doc.document.blocks[0].inlines[0].style.href).toBeUndefined();
  });
});
```

- [x] **Step 5: Run tests — expect PASS** (existing applyInlineStyle handles this)

- [x] **Step 6: Update `clearFormatting()` in `text-editor.ts`**

Add `href: undefined` to the style object in `clearFormatting()`.

- [x] **Step 7: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/src/view/text-editor.ts \
  packages/docs/test/model/types.test.ts packages/docs/test/model/document.test.ts
git commit -m "feat(docs): add href to InlineStyle for hyperlinks"
```

---

### Task 6: Hyperlink Rendering — blue text, underline

**Files:**
- Modify: `packages/docs/src/view/doc-canvas.ts:218-267`

- [x] **Step 1: Add link default rendering in `doc-canvas.ts`**

In the render run method, before applying text color and underline:

```typescript
// Link defaults: blue text + underline (user-set values take precedence)
let textColor = style.color || DEFAULT_INLINE_STYLE.color;
let showUnderline = style.underline ?? false;
if (style.href) {
  if (!style.color) textColor = '#1155cc';
  if (style.underline === undefined) showUnderline = true;
}
```

Use `textColor` for `fillStyle` and `showUnderline` for the underline rendering branch.

- [x] **Step 2: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 3: Commit**

```bash
git add packages/docs/src/view/doc-canvas.ts
git commit -m "feat(docs): render hyperlinks with blue text and underline"
```

---

### Task 7: Hyperlink — Ctrl+K shortcut, toolbar, Yorkie serialization

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`
- Modify: `packages/docs/src/view/editor.ts`
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [x] **Step 1: Add `insertLink` and `removeLink` methods to `EditorAPI`**

In `packages/docs/src/view/editor.ts`, add to the `EditorAPI` interface:

```typescript
insertLink(url: string): void;
removeLink(): void;
getLinkAtCursor(): string | undefined;
```

Implement: `insertLink` applies `{ href: url }` to the selection range. If no selection, insert the URL as text first, then apply href. `removeLink` applies `{ href: undefined }` to the current link's inline range. `getLinkAtCursor` returns the `href` from the style at cursor.

- [x] **Step 2: Add `Cmd+K` shortcut in `text-editor.ts`**

In `handleKeyDown()`:

```typescript
// Insert/edit link: Cmd+K
if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
  e.preventDefault();
  this.onLinkRequest?.();
  return;
}
```

Add a callback `onLinkRequest?: () => void` that the frontend can wire to show a link dialog.

- [x] **Step 3: Add link button to toolbar**

In `docs-formatting-toolbar.tsx`, add a Link button (use `Link` icon from lucide-react). On click, show a simple dialog/popover with a URL input field. On submit, call `editor.insertLink(url)`.

- [x] **Step 4: Update Yorkie serialization**

In `yorkie-doc-store.ts`:

`serializeInlineStyle()` — add:
```typescript
if (style.href !== undefined) attrs.href = style.href;
```

`parseInlineStyle()` — add:
```typescript
if (attrs.href !== undefined) style.href = attrs.href;
```

- [x] **Step 5: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/view/text-editor.ts packages/docs/src/view/editor.ts \
  packages/frontend/src/app/docs/docs-formatting-toolbar.tsx \
  packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "feat(docs): add Ctrl+K link insertion, toolbar button, and Yorkie serialization"
```

---

### Task 8: Hyperlink — Popover on hover, Ctrl+Click

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`
- Modify: `packages/docs/src/view/editor.ts`
- Modify: `packages/frontend/src/app/docs/docs-editor.tsx` (or equivalent container)

- [x] **Step 1: Add link hit-test in `text-editor.ts`**

Add a method `getLinkAtPosition(x, y)` that:
1. Converts screen coordinates to document position (block + offset)
2. Finds the inline at that offset
3. Returns `{ href, rect }` if the inline has `href`, or `undefined`

- [x] **Step 2: Add mousemove handler for hover detection**

In `text-editor.ts`, on `mousemove`:
- Call `getLinkAtPosition(e.offsetX, e.offsetY)`
- If link found, emit `onLinkHover({ href, rect })` callback
- If no link, emit `onLinkHover(undefined)` to dismiss

- [x] **Step 3: Add Ctrl+Click handler**

In the `mousedown` handler, check `e.ctrlKey || e.metaKey`. If clicking on a link, call `window.open(href, '_blank')` and prevent default cursor positioning.

- [x] **Step 4: Build popover DOM component in frontend**

Create a popover component (DOM overlay, not Canvas) with:
- URL text (truncated to ~40 chars)
- "Open" button → `window.open(href, '_blank')`
- "Edit" button → trigger Ctrl+K dialog with current URL
- "Remove" button → `editor.removeLink()`

Position using the `rect` from `onLinkHover`.

- [x] **Step 5: Add dismiss logic**

Dismiss popover on: click outside, scroll, `onLinkHover(undefined)`.

- [x] **Step 6: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 7: Commit**

```bash
git add packages/docs/src/view/text-editor.ts packages/docs/src/view/editor.ts \
  packages/frontend/src/app/docs/
git commit -m "feat(docs): add link popover on hover and Ctrl+Click to open"
```

---

### Task 8b: Hyperlink — URL Auto-Detection

**Files:**
- Create: `packages/docs/src/view/url-detect.ts`
- Modify: `packages/docs/src/view/text-editor.ts`
- Create: `packages/docs/test/view/url-detect.test.ts`

- [x] **Step 1: Write test for URL detection utility**

In `packages/docs/test/view/url-detect.test.ts`:

```typescript
describe('URL auto-detection', () => {
  it('should detect https URL before space', () => {
    const text = 'visit https://example.com ';
    const match = detectUrlBeforeCursor(text, text.length - 1);
    expect(match).toEqual({ start: 6, end: 26, url: 'https://example.com' });
  });

  it('should detect http URL', () => {
    const text = 'go to http://test.org ';
    const match = detectUrlBeforeCursor(text, text.length - 1);
    expect(match).toEqual({ start: 6, end: 21, url: 'http://test.org' });
  });

  it('should return null for non-URL text', () => {
    const text = 'hello world ';
    expect(detectUrlBeforeCursor(text, text.length - 1)).toBeNull();
  });
});
```

- [x] **Step 2: Run tests — expect FAIL**

- [x] **Step 3: Implement `detectUrlBeforeCursor()` in `url-detect.ts`**

Create `packages/docs/src/view/url-detect.ts`. Simple backward scan from cursor: find the last whitespace before cursor, check if the token starts with `http://` or `https://`.

```typescript
export function detectUrlBeforeCursor(
  text: string,
  cursorOffset: number,
): { start: number; end: number; url: string } | null {
  // Scan backward from cursorOffset to find word start
  let start = cursorOffset;
  while (start > 0 && text[start - 1] !== ' ' && text[start - 1] !== '\n') {
    start--;
  }
  const token = text.slice(start, cursorOffset);
  if (token.match(/^https?:\/\/.+/)) {
    return { start, end: cursorOffset, url: token };
  }
  return null;
}
```

- [x] **Step 4: Hook into Space/Enter handling in `text-editor.ts`**

After inserting a space or handling Enter, call `detectUrlBeforeCursor()` on the block text. If a URL is found, apply `{ href: url }` to that range.

- [x] **Step 5: Run tests — expect PASS**

- [x] **Step 6: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 7: Commit**

```bash
git add packages/docs/src/view/text-editor.ts packages/docs/src/model/document.ts \
  packages/docs/test/model/document.test.ts
git commit -m "feat(docs): auto-detect URLs and convert to hyperlinks"
```

---

## Feature 3: Clipboard

### Task 9: Internal JSON Copy/Paste

**Files:**
- Create: `packages/docs/src/view/clipboard.ts`
- Create: `packages/docs/test/view/clipboard.test.ts`
- Modify: `packages/docs/src/view/text-editor.ts:472-521`

- [x] **Step 1: Write failing tests for clipboard serialization**

Create `packages/docs/test/view/clipboard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { serializeBlocks, deserializeBlocks } from '../../src/view/clipboard.js';

describe('clipboard JSON serialization', () => {
  it('should round-trip blocks with formatting', () => {
    const blocks = [
      {
        id: 'b1',
        type: 'paragraph' as const,
        inlines: [
          { text: 'Hello ', style: { bold: true } },
          { text: 'world', style: {} },
        ],
        style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
      },
    ];
    const json = serializeBlocks(blocks);
    const parsed = deserializeBlocks(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].inlines[0].style.bold).toBe(true);
    expect(parsed[0].inlines[1].text).toBe('world');
  });

  it('should include version in payload', () => {
    const json = serializeBlocks([]);
    const payload = JSON.parse(json);
    expect(payload.version).toBe(1);
  });
});
```

- [x] **Step 2: Run tests — expect FAIL**

- [x] **Step 3: Implement `clipboard.ts`**

Create `packages/docs/src/view/clipboard.ts`:

```typescript
import type { Block } from '../model/types.js';

interface ClipboardPayload {
  version: 1;
  blocks: Block[];
}

export function serializeBlocks(blocks: Block[]): string {
  const payload: ClipboardPayload = { version: 1, blocks };
  return JSON.stringify(payload);
}

export function deserializeBlocks(json: string): Block[] {
  const payload: ClipboardPayload = JSON.parse(json);
  if (payload.version !== 1) return [];
  return payload.blocks;
}

export const WAFFLEDOCS_MIME = 'application/x-waffledocs';
```

- [x] **Step 4: Run tests — expect PASS**

- [x] **Step 5: Wire into `text-editor.ts` copy/cut/paste handlers**

Update `handleCopy()`:
```typescript
// Serialize selected blocks as JSON
const selectedBlocks = this.getSelectedBlocks(); // extract from selection
const json = serializeBlocks(selectedBlocks);
e.clipboardData?.setData(WAFFLEDOCS_MIME, json);
e.clipboardData?.setData('text/plain', this.selection.getSelectedText());
```

Update `handlePaste()`:
```typescript
const json = e.clipboardData?.getData(WAFFLEDOCS_MIME);
if (json) {
  const blocks = deserializeBlocks(json);
  this.insertBlocks(blocks); // insert with formatting
  return;
}
// Fall through to existing plain text handling
```

- [x] **Step 6: Implement `getSelectedBlocks()` helper**

Extract the blocks/inlines covered by the current selection range, trimming the first and last block to match the selection boundaries:

1. Get the selection range (`anchor`/`focus` block IDs and offsets)
2. For single-block selection: clone the block, slice inlines to only include text within `[startOffset, endOffset)`
3. For multi-block selection: clone first block (trim inlines from startOffset to end), clone middle blocks fully, clone last block (trim inlines from start to endOffset)
4. Generate new block IDs for cloned blocks to avoid conflicts on paste

- [x] **Step 7: Implement `insertBlocks()` helper**

Insert deserialized blocks at the cursor position. For a single-block paste, merge inlines. For multi-block paste, split the current block and insert in between.

- [x] **Step 8: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 9: Commit**

```bash
git add packages/docs/src/view/clipboard.ts packages/docs/test/view/clipboard.test.ts \
  packages/docs/src/view/text-editor.ts
git commit -m "feat(docs): internal JSON clipboard for rich copy/paste"
```

---

### Task 10: External HTML Paste & Plain-Text Paste

**Files:**
- Modify: `packages/docs/src/view/clipboard.ts`
- Modify: `packages/docs/src/view/text-editor.ts`
- Test: `packages/docs/test/view/clipboard.test.ts`

- [x] **Step 1: Write failing tests for HTML parsing**

In `packages/docs/test/view/clipboard.test.ts`:

```typescript
import { parseHtmlToInlines } from '../../src/view/clipboard.js';

describe('HTML paste parsing', () => {
  it('should parse bold tags', () => {
    const inlines = parseHtmlToInlines('<b>hello</b> world');
    expect(inlines[0].style.bold).toBe(true);
    expect(inlines[0].text).toBe('hello');
    expect(inlines[1].text).toBe(' world');
  });

  it('should parse italic tags', () => {
    const inlines = parseHtmlToInlines('<em>text</em>');
    expect(inlines[0].style.italic).toBe(true);
  });

  it('should parse anchor tags as href', () => {
    const inlines = parseHtmlToInlines('<a href="https://example.com">link</a>');
    expect(inlines[0].style.href).toBe('https://example.com');
    expect(inlines[0].text).toBe('link');
  });

  it('should parse inline style attributes', () => {
    const inlines = parseHtmlToInlines('<span style="color: red; font-size: 16px">styled</span>');
    expect(inlines[0].style.color).toBe('red');
    expect(inlines[0].style.fontSize).toBe(16);
  });

  it('should fall back to plain text for unknown tags', () => {
    const inlines = parseHtmlToInlines('<div><custom>text</custom></div>');
    expect(inlines[0].text).toBe('text');
  });
});
```

- [x] **Step 2: Run tests — expect FAIL**

- [x] **Step 3: Implement `parseHtmlToInlines()`**

In `packages/docs/src/view/clipboard.ts`:

Use `DOMParser` to parse the HTML string. Walk the DOM tree, collecting text nodes with style context from parent elements. Map `<b>`/`<strong>` → bold, `<i>`/`<em>` → italic, `<u>` → underline, `<s>`/`<del>`/`<strike>` → strikethrough, `<a>` → href. Parse `style` attribute for color, fontSize, backgroundColor.

- [x] **Step 4: Run tests — expect PASS**

- [x] **Step 5: Wire HTML paste into `handlePaste()`**

In `text-editor.ts`, update paste handler priority:
1. Check `application/x-waffledocs` → JSON paste
2. Check `text/html` → parse HTML → insert inlines
3. Fall back to `text/plain`

- [x] **Step 6: Add `Cmd+Shift+V` for plain-text paste**

In `handleKeyDown()`:

```typescript
if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'v') {
  e.preventDefault();
  // Read plain text from clipboard API
  navigator.clipboard.readText().then((text) => {
    this.insertPlainText(text);
  });
  return;
}
```

`insertPlainText()` inserts text inheriting the style at cursor position, ignoring any formatting.

- [x] **Step 7: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 8: Commit**

```bash
git add packages/docs/src/view/clipboard.ts packages/docs/test/view/clipboard.test.ts \
  packages/docs/src/view/text-editor.ts
git commit -m "feat(docs): HTML paste parsing and plain-text paste shortcut"
```

---

### Task 10b: Copy Formatting (Format Painter)

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

- [x] **Step 1: Add style buffer and shortcuts**

In `text-editor.ts`, add an instance field:

```typescript
private styleBuffer: Partial<InlineStyle> | null = null;
```

Add shortcuts in `handleKeyDown()`:

```typescript
// Copy formatting: Cmd+Shift+C
if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'c') {
  e.preventDefault();
  this.styleBuffer = { ...this.getStyleAtCursor() };
  return;
}

// Paste formatting: Cmd+Alt+V
if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === 'v') {
  e.preventDefault();
  if (this.styleBuffer && this.selection.hasSelection() && this.selection.range) {
    this.doc.applyInlineStyle(this.selection.range, this.styleBuffer);
    this.render();
  }
  return;
}
```

- [x] **Step 2: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 3: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "feat(docs): copy formatting with Cmd+Shift+C / Cmd+Alt+V"
```

---

## Feature 4: Find & Replace

### Task 11: Search Engine — `searchText()` in Doc

**Files:**
- Modify: `packages/docs/src/model/document.ts`
- Modify: `packages/docs/src/model/types.ts` (export SearchMatch, SearchOptions)
- Test: `packages/docs/test/model/document.test.ts`

- [x] **Step 1: Write failing tests for `searchText()`**

In `packages/docs/test/model/document.test.ts`:

```typescript
describe('searchText', () => {
  it('should find matches within a single block', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'hello world hello');
    const matches = doc.searchText('hello');
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ blockId, startOffset: 0, endOffset: 5 });
    expect(matches[1]).toEqual({ blockId, startOffset: 12, endOffset: 17 });
  });

  it('should find matches across multiple blocks', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'hello');
    const newBlockId = doc.splitBlock(blockId, 5);
    doc.insertText({ blockId: newBlockId, offset: 0 }, 'hello again');
    const matches = doc.searchText('hello');
    expect(matches).toHaveLength(2);
  });

  it('should be case-insensitive by default', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'Hello HELLO hello');
    const matches = doc.searchText('hello');
    expect(matches).toHaveLength(3);
  });

  it('should support case-sensitive search', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'Hello HELLO hello');
    const matches = doc.searchText('hello', { caseSensitive: true });
    expect(matches).toHaveLength(1);
    expect(matches[0].startOffset).toBe(12);
  });

  it('should support regex search', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'cat bat hat');
    const matches = doc.searchText('[cbh]at', { useRegex: true });
    expect(matches).toHaveLength(3);
  });

  it('should return empty array for no matches', () => {
    const doc = Doc.create();
    const matches = doc.searchText('xyz');
    expect(matches).toHaveLength(0);
  });

  it('should find match spanning inline boundaries', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'helloworld');
    // Apply bold to first 5 chars, creating two inlines
    doc.applyInlineStyle(
      { anchor: { blockId, offset: 0 }, focus: { blockId, offset: 5 } },
      { bold: true },
    );
    // Search across inline boundary
    const matches = doc.searchText('lloworl');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ blockId, startOffset: 2, endOffset: 9 });
  });
});
```

- [x] **Step 2: Run tests — expect FAIL**

- [x] **Step 3: Define types and implement `searchText()`**

In `packages/docs/src/model/types.ts`, add and export:

```typescript
export interface SearchOptions {
  caseSensitive?: boolean;
  useRegex?: boolean;
}

export interface SearchMatch {
  blockId: string;
  startOffset: number;
  endOffset: number;
}
```

In `packages/docs/src/model/document.ts`, add to the `Doc` class:

```typescript
searchText(query: string, options?: SearchOptions): SearchMatch[] {
  if (!query) return [];
  const matches: SearchMatch[] = [];
  const flags = options?.caseSensitive ? 'g' : 'gi';
  const pattern = options?.useRegex
    ? new RegExp(query, flags)
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

  for (const block of this.document.blocks) {
    const text = getBlockText(block);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        blockId: block.id,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
      });
    }
  }
  return matches;
}
```

- [x] **Step 4: Run tests — expect PASS**

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/src/model/document.ts \
  packages/docs/test/model/document.test.ts
git commit -m "feat(docs): add searchText() method for find & replace"
```

---

### Task 12: Find & Replace — Match highlighting in Canvas

**Files:**
- Modify: `packages/docs/src/view/doc-canvas.ts`
- Modify: `packages/docs/src/view/editor.ts`

- [x] **Step 1: Add search highlight state to editor**

In `packages/docs/src/view/editor.ts`, add state:

```typescript
private searchMatches: SearchMatch[] = [];
private activeMatchIndex: number = -1;
```

Add methods:

```typescript
setSearchMatches(matches: SearchMatch[], activeIndex: number): void {
  this.searchMatches = matches;
  this.activeMatchIndex = activeIndex;
  this.render();
}

clearSearchMatches(): void {
  this.searchMatches = [];
  this.activeMatchIndex = -1;
  this.render();
}
```

- [x] **Step 2: Render search highlights in `doc-canvas.ts`**

In the render pipeline, before rendering selection highlights, add a pass for search match highlights. For each match:

1. Find the layout block and line containing `startOffset`–`endOffset`
2. Compute the x/y/width rectangle for the match text
3. Fill with `#fff2a8` (yellow) for inactive matches, `#f4a939` (orange) for the active match

Z-order: search highlights → selection highlights → backgroundColor → text.

- [x] **Step 3: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 4: Commit**

```bash
git add packages/docs/src/view/doc-canvas.ts packages/docs/src/view/editor.ts
git commit -m "feat(docs): render search match highlights in Canvas"
```

---

### Task 13: Find & Replace — UI bar, navigation, replace

**Files:**
- Create: `packages/docs/src/view/find-replace.ts`
- Create: `packages/docs/test/view/find-replace.test.ts`
- Modify: `packages/docs/src/view/text-editor.ts`
- Modify: `packages/docs/src/view/editor.ts`
- Modify: `packages/frontend/src/app/docs/` (find bar component)

- [x] **Step 1: Write tests for FindReplaceState**

Create `packages/docs/test/view/find-replace.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FindReplaceState } from '../../src/view/find-replace.js';
import { Doc } from '../../src/model/document.js';

describe('FindReplaceState', () => {
  it('should track matches and active index', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'aaa bbb aaa');
    const state = new FindReplaceState(doc);
    state.search('aaa');
    expect(state.matches).toHaveLength(2);
    expect(state.activeIndex).toBe(0);
  });

  it('should navigate next and wrap', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'x x x');
    const state = new FindReplaceState(doc);
    state.search('x');
    expect(state.activeIndex).toBe(0);
    state.next();
    expect(state.activeIndex).toBe(1);
    state.next();
    expect(state.activeIndex).toBe(2);
    state.next();
    expect(state.activeIndex).toBe(0); // wrap
  });

  it('should navigate previous and wrap', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'x x');
    const state = new FindReplaceState(doc);
    state.search('x');
    state.previous();
    expect(state.activeIndex).toBe(1); // wrap to last
  });

  it('should replace active match', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'foo bar foo');
    const state = new FindReplaceState(doc);
    state.search('foo');
    state.replaceActive('baz');
    expect(doc.document.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      'baz bar foo',
    );
    // After replace, re-search and matches should update
    expect(state.matches).toHaveLength(1);
  });

  it('should replace all', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'aa bb aa');
    const state = new FindReplaceState(doc);
    state.search('aa');
    state.replaceAll('cc');
    expect(doc.document.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      'cc bb cc',
    );
    expect(state.matches).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run tests — expect FAIL**

- [x] **Step 3: Implement `FindReplaceState`**

Create `packages/docs/src/view/find-replace.ts`:

```typescript
import type { SearchMatch, SearchOptions } from '../model/types.js';
import type { Doc } from '../model/document.js';

export class FindReplaceState {
  matches: SearchMatch[] = [];
  activeIndex = 0;
  query = '';
  options: SearchOptions = {};

  constructor(private doc: Doc) {}

  search(query: string, options?: SearchOptions): void {
    this.query = query;
    this.options = options ?? {};
    this.matches = this.doc.searchText(query, this.options);
    this.activeIndex = this.matches.length > 0 ? 0 : -1;
  }

  next(): void {
    if (this.matches.length === 0) return;
    this.activeIndex = (this.activeIndex + 1) % this.matches.length;
  }

  previous(): void {
    if (this.matches.length === 0) return;
    this.activeIndex =
      (this.activeIndex - 1 + this.matches.length) % this.matches.length;
  }

  replaceActive(replacement: string): void {
    if (this.activeIndex < 0 || this.activeIndex >= this.matches.length) return;
    const match = this.matches[this.activeIndex];
    this.doc.deleteText(
      { blockId: match.blockId, offset: match.startOffset },
      match.endOffset - match.startOffset,
    );
    this.doc.insertText(
      { blockId: match.blockId, offset: match.startOffset },
      replacement,
    );
    this.search(this.query, this.options); // re-search
  }

  replaceAll(replacement: string): void {
    // Replace from last to first to preserve offsets
    for (let i = this.matches.length - 1; i >= 0; i--) {
      const match = this.matches[i];
      this.doc.deleteText(
        { blockId: match.blockId, offset: match.startOffset },
        match.endOffset - match.startOffset,
      );
      this.doc.insertText(
        { blockId: match.blockId, offset: match.startOffset },
        replacement,
      );
    }
    this.search(this.query, this.options); // re-search
  }
}
```

- [x] **Step 4: Run tests — expect PASS**

- [x] **Step 5: Add `Cmd+F` and `Cmd+H` shortcuts in `text-editor.ts`**

```typescript
// Find: Cmd+F
if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
  e.preventDefault();
  this.onFindRequest?.();
  return;
}
// Find & Replace: Cmd+H
if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
  e.preventDefault();
  this.onFindReplaceRequest?.();
  return;
}
```

- [x] **Step 6: Build find bar React component in frontend**

Create a find bar component (DOM overlay at top of the document area):
- Search input field with debounced `state.search()` on change
- "N of M" match counter
- Previous / Next buttons
- Replace input + Replace / Replace All buttons (shown when `Cmd+H`)
- Case-sensitive toggle, Regex toggle
- ESC to close

Wire the component to `EditorAPI.setSearchMatches()` to update Canvas highlighting.

- [x] **Step 7: Add auto-scroll on match navigation**

When `next()` or `previous()` is called, move the cursor to the active match's `blockId`/`startOffset` position and set `needsScrollIntoView = true` in the editor to scroll the active match into the viewport.

- [x] **Step 8: Add invalidation — re-search on document mutation**

In the editor, after any document mutation (insert, delete, style change), if the find bar is open, call `state.search(currentQuery)` and update highlights. Clamp `activeIndex` to the new match count.

- [x] **Step 9: Run verify**

```bash
pnpm verify:fast
```

- [x] **Step 10: Commit**

```bash
git add packages/docs/src/view/find-replace.ts packages/docs/test/view/find-replace.test.ts \
  packages/docs/src/view/text-editor.ts packages/docs/src/view/editor.ts \
  packages/frontend/src/app/docs/
git commit -m "feat(docs): add find & replace with search bar UI and match highlighting"
```

---

## Final: Update roadmap and verify

### Task 14: Update design docs and verify

**Files:**
- Modify: `docs/design/docs/docs-wordprocessor-roadmap.md`

- [x] **Step 1: Run full verification**

```bash
pnpm verify:fast
```

- [x] **Step 2: Update roadmap**

Mark Phase 2 items as complete (✅) in `docs/design/docs/docs-wordprocessor-roadmap.md`. Update the "Current State" table with new features.

- [x] **Step 3: Update `Keyboard Shortcuts` status**

Change from "✅ Partial" to "✅" if all planned shortcuts are now implemented.

- [x] **Step 4: Commit**

```bash
git add docs/design/docs/docs-wordprocessor-roadmap.md
git commit -m "docs: mark Phase 2 complete in word processor roadmap"
```

- [x] **Step 5: Archive tasks**

```bash
pnpm tasks:archive && pnpm tasks:index
```
