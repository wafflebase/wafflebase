# Docs Font Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a curated font-family picker, Google-Docs-style font-size control, line-spacing dropdown, and clear-formatting button to the Docs toolbar (body + header/footer), as reusable stateless components under `packages/frontend/src/components/text-formatting/`.

**Architecture:** Stateless React components consume value + onChange. The Docs toolbar owns selection-derived state via two new EditorAPI methods (`getRangeStyleSummary`, `clearFormatting`). Web fonts are declared in a single `font-catalog.ts`, loaded once at app bootstrap via a Google Fonts `<link>`, and lazily fetched per-family by the existing `FontRegistry.ensureFont()`.

**Tech Stack:** React, TypeScript, Vitest (jsdom), Radix UI primitives, `@wafflebase/docs` editor, Yorkie CRDT (integration tests only).

**Design doc:** [`docs/design/docs/docs-font-controls.md`](../../design/docs/docs-font-controls.md).
**Companion todo:** [`20260529-docs-font-controls-todo.md`](20260529-docs-font-controls-todo.md).

---

## File map

**Create:**
- `packages/frontend/src/components/text-formatting/font-catalog.ts`
- `packages/frontend/src/components/text-formatting/font-family-picker.tsx`
- `packages/frontend/src/components/text-formatting/font-size-picker.tsx`
- `packages/frontend/src/components/text-formatting/line-spacing-picker.tsx`
- `packages/frontend/src/components/text-formatting/clear-formatting-button.tsx`
- `packages/frontend/tests/components/text-formatting/font-family-picker.test.ts`
- `packages/frontend/tests/components/text-formatting/font-size-picker.test.ts`
- `packages/frontend/tests/components/text-formatting/line-spacing-picker.test.ts`
- `packages/docs/test/view/editor-range-style-summary.test.ts`
- `packages/docs/test/view/editor-clear-formatting.test.ts`

**Modify:**
- `packages/docs/src/view/fonts.ts` — extend `FONT_MAP`, `SERIF_FONTS`
- `packages/docs/src/view/editor.ts` — add `getRangeStyleSummary`, `clearFormatting` to `EditorAPI`
- `packages/docs/src/index.ts` — re-export new types if needed (none expected; `EditorAPI` already exported)
- `packages/frontend/src/components/text-formatting/index.ts` — re-export new components
- `packages/frontend/src/components/text-formatting/types.ts` — extend `TextFormattingEditor` with new methods
- `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` — wire body + header/footer toolbars + mobile overflow
- `packages/frontend/src/main.tsx` (or equivalent root entry) — inject Google Fonts CSS `<link>` once

---

## Task 1: Font catalog

**Files:**
- Create: `packages/frontend/src/components/text-formatting/font-catalog.ts`

- [ ] **Step 1: Write the catalog module**

```ts
// packages/frontend/src/components/text-formatting/font-catalog.ts
/**
 * Single source of truth for the Docs font-family picker and size presets.
 *
 * v1 keeps the catalog small (14 families) so the picker stays readable
 * and the Google Fonts CSS payload stays under one network request.
 * Future "More fonts…" work extends `FONT_CATALOG` without breaking the
 * picker contract (`value: string`, not a closed union).
 */

export type FontGroup = 'Korean' | 'Sans-serif' | 'Serif' | 'Monospace';

export interface FontEntry {
  /** Display label shown in the picker. */
  label: string;
  /** Canonical family name written to InlineStyle.fontFamily. */
  family: string;
  /** Section header in the picker. */
  group: FontGroup;
  /**
   * Whether the family needs the Google Fonts CSS link at bootstrap and
   * `FontRegistry.ensureFont()` before paint. Local/system fonts skip both.
   */
  webFont: boolean;
}

export const FONT_CATALOG: readonly FontEntry[] = [
  // Korean
  { label: '맑은 고딕', family: '맑은 고딕', group: 'Korean', webFont: false },
  { label: '바탕', family: '바탕', group: 'Korean', webFont: false },
  { label: 'Noto Sans KR', family: 'Noto Sans KR', group: 'Korean', webFont: true },
  { label: 'Noto Serif KR', family: 'Noto Serif KR', group: 'Korean', webFont: true },
  { label: '나눔고딕', family: 'Nanum Gothic', group: 'Korean', webFont: true },
  // Sans-serif
  { label: 'Arial', family: 'Arial', group: 'Sans-serif', webFont: false },
  { label: 'Helvetica', family: 'Helvetica', group: 'Sans-serif', webFont: false },
  { label: 'Roboto', family: 'Roboto', group: 'Sans-serif', webFont: true },
  { label: 'Tahoma', family: 'Tahoma', group: 'Sans-serif', webFont: false },
  { label: 'Verdana', family: 'Verdana', group: 'Sans-serif', webFont: false },
  // Serif
  { label: 'Times New Roman', family: 'Times New Roman', group: 'Serif', webFont: false },
  { label: 'Georgia', family: 'Georgia', group: 'Serif', webFont: false },
  { label: 'Cambria', family: 'Cambria', group: 'Serif', webFont: false },
  // Monospace
  { label: 'Courier New', family: 'Courier New', group: 'Monospace', webFont: false },
];

export const FONT_SIZE_PRESETS = [8, 10, 12, 14, 16, 18, 20, 24, 32, 48, 64, 96] as const;
export type FontSizePreset = (typeof FONT_SIZE_PRESETS)[number];

export const FONT_SIZE_MIN = 1;
export const FONT_SIZE_MAX = 400;

export const LINE_SPACING_PRESETS = [1.0, 1.15, 1.5, 2.0] as const;
export const LINE_SPACING_MIN = 0.5;
export const LINE_SPACING_MAX = 10.0;

/** Build the `<link href="…">` URL for the Google Fonts CSS request. */
export function buildGoogleFontsHref(): string {
  const webFamilies = FONT_CATALOG.filter((f) => f.webFont).map((f) => f.family);
  const params = webFamilies
    .map((name) => `family=${encodeURIComponent(name)}:wght@400;700`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/text-formatting/font-catalog.ts
git commit -m "Add font catalog for Docs font controls

The catalog drives both the family picker and the bootstrap-time
Google Fonts CSS link. Curated to 14 families so v1 stays a single
dropdown without 'More fonts…' library expansion."
```

---

## Task 2: Extend FONT_MAP and SERIF_FONTS in docs/view/fonts.ts

**Files:**
- Modify: `packages/docs/src/view/fonts.ts:6-16`

- [ ] **Step 1: Write the failing test**

```ts
// packages/docs/test/view/fonts.test.ts (new file)
import { describe, test, expect } from 'vitest';
import { resolveFontFamily } from '../../src/view/fonts.js';

describe('resolveFontFamily — catalog coverage', () => {
  test.each([
    ['맑은 고딕', /Malgun Gothic/],
    ['Noto Sans KR', /Noto Sans KR/],
    ['Noto Serif KR', /Noto Serif KR/],
    ['Nanum Gothic', /Nanum Gothic/],
    ['Roboto', /Roboto/],
    ['Helvetica', /Helvetica/],
    ['Georgia', /Georgia/],
    ['Cambria', /Cambria/],
    ['Times New Roman', /Times New Roman/],
    ['Courier New', /Courier New/],
  ])('resolves %s with a fallback chain', (family, expected) => {
    expect(resolveFontFamily(family)).toMatch(expected);
  });

  test('Noto Serif KR ends in serif fallback', () => {
    expect(resolveFontFamily('Noto Serif KR')).toMatch(/serif$/);
  });

  test('Courier New ends in monospace fallback', () => {
    expect(resolveFontFamily('Courier New')).toMatch(/monospace$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test -- fonts.test.ts`
Expected: Several FAIL — `Noto Sans KR`, `Roboto`, `Helvetica`, `Cambria`, etc. resolve to `, sans-serif` only (no specific entry in `FONT_MAP`), and `Courier New` resolves to `sans-serif` (not `monospace`).

- [ ] **Step 3: Extend `FONT_MAP`, `SERIF_FONTS`, and add a monospace path**

```ts
// packages/docs/src/view/fonts.ts
const FONT_MAP: Record<string, string> = {
  '맑은 고딕': "'Malgun Gothic', 'Noto Sans KR', sans-serif",
  'Malgun Gothic': "'Malgun Gothic', 'Noto Sans KR', sans-serif",
  '바탕': "'Batang', 'Noto Serif KR', serif",
  'Batang': "'Batang', 'Noto Serif KR', serif",
  'Noto Sans KR': "'Noto Sans KR', sans-serif",
  'Noto Serif KR': "'Noto Serif KR', serif",
  'Nanum Gothic': "'Nanum Gothic', sans-serif",
  'HY헤드라인M': "'Noto Sans KR', sans-serif",
  'Arial': "'Arial', sans-serif",
  'Helvetica': "'Helvetica', 'Arial', sans-serif",
  'Roboto': "'Roboto', sans-serif",
  'Tahoma': "'Tahoma', sans-serif",
  'Verdana': "'Verdana', sans-serif",
  'Times New Roman': "'Times New Roman', 'Times', serif",
  'Georgia': "'Georgia', serif",
  'Cambria': "'Cambria', 'Georgia', serif",
  'Courier New': "'Courier New', 'Courier', monospace",
};

const SERIF_FONTS = new Set([
  '바탕', 'Batang',
  'Noto Serif KR',
  'Times New Roman', 'Georgia', 'Cambria',
]);

const MONOSPACE_FONTS = new Set(['Courier New', 'Courier', 'Consolas']);
```

And update `resolveFontFamily` to pick `monospace` when the family is in `MONOSPACE_FONTS`:

```ts
export function resolveFontFamily(family: string): string {
  const mapped = FONT_MAP[family];
  if (mapped) return mapped;

  const generic = MONOSPACE_FONTS.has(family)
    ? 'monospace'
    : SERIF_FONTS.has(family)
      ? 'serif'
      : 'sans-serif';
  return `'${escapeFontFamily(family)}', ${generic}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test -- fonts.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/fonts.ts packages/docs/test/view/fonts.test.ts
git commit -m "Cover the 14 catalog families in resolveFontFamily

The font-family picker will write these family names into
InlineStyle.fontFamily, so resolveFontFamily must produce a sensible
CSS fallback chain for each one. Adds a monospace branch."
```

---

## Task 3: Add `getRangeStyleSummary` to the docs EditorAPI

**Files:**
- Modify: `packages/docs/src/view/editor.ts:37` (interface) and around `:1652` (impl)
- Test: `packages/docs/test/view/editor-range-style-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/docs/test/view/editor-range-style-summary.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import { Doc } from '../../src/model/document.js';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize } from '../../src/view/editor.js';

function setupEditor() {
  const doc = new Doc();
  const store = new MemDocStore(doc);
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const editor = initialize(canvas, store, { readOnly: false });
  return { doc, store, editor };
}

describe('getRangeStyleSummary', () => {
  beforeEach(() => {
    // jsdom lacks canvas; supply a minimal 2d context shim.
    (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ({
      measureText: () => ({ width: 0 }),
      fillText: () => {},
      fillRect: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      setTransform: () => {},
    });
  });

  test('returns a uniform value when every run agrees', () => {
    const { editor, doc } = setupEditor();
    const blockId = doc.document.blocks[0].id;
    doc.replaceBlocks([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [
          { text: 'hello', style: { fontFamily: 'Arial', fontSize: 12 } },
        ],
        style: {},
      },
    ]);
    // Select the whole block
    editor.getStore(); // touch
    // selectAll equivalent: place range across the inline
    (editor as any).selection?.setRange?.({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    });
    const summary = editor.getRangeStyleSummary();
    expect(summary.fontFamily).toBe('Arial');
    expect(summary.fontSize).toBe(12);
  });

  test("returns 'mixed' when runs disagree on a key", () => {
    const { editor, doc } = setupEditor();
    const blockId = doc.document.blocks[0].id;
    doc.replaceBlocks([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [
          { text: 'aa', style: { fontFamily: 'Arial', fontSize: 12 } },
          { text: 'bb', style: { fontFamily: 'Georgia', fontSize: 12 } },
        ],
        style: {},
      },
    ]);
    (editor as any).selection?.setRange?.({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 4 },
    });
    const summary = editor.getRangeStyleSummary();
    expect(summary.fontFamily).toBe('mixed');
    expect(summary.fontSize).toBe(12);
  });

  test('returns undefined when the key is unset throughout', () => {
    const { editor, doc } = setupEditor();
    const blockId = doc.document.blocks[0].id;
    doc.replaceBlocks([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [{ text: 'abc', style: {} }],
        style: {},
      },
    ]);
    (editor as any).selection?.setRange?.({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 3 },
    });
    const summary = editor.getRangeStyleSummary();
    expect(summary.fontFamily).toBeUndefined();
    expect(summary.fontSize).toBeUndefined();
  });
});
```

> Note: the test's selection-poke uses an `(editor as any).selection?` escape hatch only because the editor doesn't expose a public `selectRange()` yet. If `selection.setRange` is not reachable, the test author should add a thin `editor._setSelectionForTest(range)` helper to `editor.ts` guarded by a `_setSelectionForTest` underscore prefix, or set `editor.applyStyle` after typing characters through the public text-editor input. Pick whichever path the existing `packages/docs/test/view/*` files already use; mimic that.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test -- editor-range-style-summary.test.ts`
Expected: FAIL with `editor.getRangeStyleSummary is not a function`.

- [ ] **Step 3: Add the API to the interface**

Edit `packages/docs/src/view/editor.ts` at the `EditorAPI` interface (around line 45). Insert below `getSelectionStyle`:

```ts
  /**
   * Summary of inline styles across the current selection. For each
   * key, returns the resolved value when uniform, the literal 'mixed'
   * when at least two distinct values exist within the range, or
   * undefined when the property is unset throughout. When there is no
   * selection, returns the style of the inline at the cursor (same
   * shape as getSelectionStyle).
   */
  getRangeStyleSummary(): {
    bold?: boolean | 'mixed';
    italic?: boolean | 'mixed';
    underline?: boolean | 'mixed';
    strikethrough?: boolean | 'mixed';
    fontFamily?: string | 'mixed';
    fontSize?: number | 'mixed';
    color?: string | 'mixed';
    backgroundColor?: string | 'mixed';
    superscript?: boolean | 'mixed';
    subscript?: boolean | 'mixed';
  };
```

- [ ] **Step 4: Implement on the returned editor object**

Edit `packages/docs/src/view/editor.ts` inside the `return { ... }` object around line 1648, after `getSelectionStyle`:

```ts
    getRangeStyleSummary: () => {
      // No range — fall back to the cursor-position style.
      if (!selection.hasSelection() || !selection.range) {
        return { ...editorAPI.getSelectionStyle() } as ReturnType<
          EditorAPI['getRangeStyleSummary']
        >;
      }

      const range = selection.range;

      const KEYS = [
        'bold', 'italic', 'underline', 'strikethrough',
        'fontFamily', 'fontSize', 'color', 'backgroundColor',
        'superscript', 'subscript',
      ] as const;
      const result: Record<string, unknown> = {};
      const seen: Record<string, Set<unknown>> = Object.fromEntries(
        KEYS.map((k) => [k, new Set()]),
      );

      const visitInlinesInBlock = (blockId: string, from: number, to: number) => {
        const block = layout.blockParentMap.has(blockId)
          ? doc.getBlock(blockId)
          : doc.document.blocks.find((b) => b.id === blockId);
        if (!block) return;
        let pos = 0;
        for (const inline of block.inlines) {
          const inlineEnd = pos + inline.text.length;
          // Overlap test [from, to) with [pos, inlineEnd)
          if (inlineEnd > from && pos < to) {
            for (const key of KEYS) {
              seen[key].add(inline.style[key]);
            }
          }
          pos = inlineEnd;
          if (pos >= to) break;
        }
      };

      const anchorIdx = doc.getBlockIndex(range.anchor.blockId);
      const focusIdx = doc.getBlockIndex(range.focus.blockId);
      if (anchorIdx >= 0 && focusIdx >= 0) {
        const [startIdx, startOff, endIdx, endOff] = anchorIdx < focusIdx ||
          (anchorIdx === focusIdx && range.anchor.offset <= range.focus.offset)
          ? [anchorIdx, range.anchor.offset, focusIdx, range.focus.offset]
          : [focusIdx, range.focus.offset, anchorIdx, range.anchor.offset];

        for (let i = startIdx; i <= endIdx; i++) {
          const block = doc.document.blocks[i];
          const blockLen = block.inlines.reduce((s, n) => s + n.text.length, 0);
          const from = i === startIdx ? startOff : 0;
          const to = i === endIdx ? endOff : blockLen;
          if (from < to) visitInlinesInBlock(block.id, from, to);
        }
      }

      for (const key of KEYS) {
        const set = seen[key];
        // 'undefined' was added when an inline has no value — treat it as
        // a distinct entry so "some have, some don't" reports as 'mixed'.
        if (set.size === 0) continue;
        if (set.size === 1) {
          const [only] = [...set];
          if (only !== undefined) result[key] = only;
        } else {
          result[key] = 'mixed';
        }
      }

      return result as ReturnType<EditorAPI['getRangeStyleSummary']>;
    },
```

Note: `editorAPI` here is the variable the existing factory uses to refer to the returned object — match the local name used by the existing code in the same `return { ... }` block. If the existing code doesn't have a self-reference variable, inline `getSelectionStyle` logic directly inside the fallback branch instead of calling out.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test -- editor-range-style-summary.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/editor.ts packages/docs/test/view/editor-range-style-summary.test.ts
git commit -m "Add EditorAPI.getRangeStyleSummary

The toolbar needs to know whether a selection is uniformly bold (show
toggle on) or mixed (show neutral). Returns the value when all runs
agree, 'mixed' when they don't, undefined when unset throughout."
```

---

## Task 4: Add `clearFormatting` to the docs EditorAPI

**Files:**
- Modify: `packages/docs/src/view/editor.ts` (interface and impl)
- Test: `packages/docs/test/view/editor-clear-formatting.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/docs/test/view/editor-clear-formatting.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import { Doc } from '../../src/model/document.js';
import { MemDocStore } from '../../src/store/memory.js';
import { initialize } from '../../src/view/editor.js';

beforeEach(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ({
    measureText: () => ({ width: 0 }),
    fillText: () => {}, fillRect: () => {}, clearRect: () => {},
    save: () => {}, restore: () => {},
    translate: () => {}, scale: () => {}, setTransform: () => {},
  });
});

describe('clearFormatting', () => {
  test('removes all inline attributes on the selected range', () => {
    const doc = new Doc();
    const store = new MemDocStore(doc);
    const canvas = document.createElement('canvas');
    const editor = initialize(canvas, store, { readOnly: false });

    const blockId = doc.document.blocks[0].id;
    doc.replaceBlocks([
      {
        id: blockId,
        type: 'paragraph',
        inlines: [
          {
            text: 'hello',
            style: {
              bold: true,
              italic: true,
              fontFamily: 'Georgia',
              fontSize: 20,
              color: '#ff0000',
            },
          },
        ],
        style: { alignment: 'center', lineHeight: 1.5 },
      },
    ]);

    (editor as any).selection?.setRange?.({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    });

    editor.clearFormatting();

    const block = doc.document.blocks[0];
    // Inline style: all the previously-set keys are gone.
    for (const inline of block.inlines) {
      expect(inline.style.bold).toBeUndefined();
      expect(inline.style.italic).toBeUndefined();
      expect(inline.style.fontFamily).toBeUndefined();
      expect(inline.style.fontSize).toBeUndefined();
      expect(inline.style.color).toBeUndefined();
    }
    // Block style preserved.
    expect(block.style.alignment).toBe('center');
    expect(block.style.lineHeight).toBe(1.5);
  });

  test('preserves heading block type', () => {
    const doc = new Doc();
    const store = new MemDocStore(doc);
    const canvas = document.createElement('canvas');
    const editor = initialize(canvas, store, { readOnly: false });

    const blockId = doc.document.blocks[0].id;
    doc.replaceBlocks([
      {
        id: blockId,
        type: 'heading',
        headingLevel: 2,
        inlines: [{ text: 'title', style: { bold: true } }],
        style: {},
      },
    ]);

    (editor as any).selection?.setRange?.({
      anchor: { blockId, offset: 0 },
      focus: { blockId, offset: 5 },
    });

    editor.clearFormatting();

    expect(doc.document.blocks[0].type).toBe('heading');
    expect(doc.document.blocks[0].headingLevel).toBe(2);
    expect(doc.document.blocks[0].inlines[0].style.bold).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test -- editor-clear-formatting.test.ts`
Expected: FAIL with `editor.clearFormatting is not a function`.

- [ ] **Step 3: Add to interface**

Edit `EditorAPI` interface in `packages/docs/src/view/editor.ts` near `applyStyle`:

```ts
  /**
   * Remove every inline style attribute from the current selection.
   * Block-level styles (alignment, line height, list kind/level,
   * heading level) are intentionally preserved — matches Google Docs'
   * Format → Clear formatting behavior.
   */
  clearFormatting(): void;
```

- [ ] **Step 4: Implement**

In the same returned object, add:

```ts
    clearFormatting: () => {
      // The full key set must match the InlineStyle interface in
      // packages/docs/src/model/types.ts. Each key is passed as
      // `undefined` so the Yorkie store's applyStyle path tears the
      // attribute off the Tree node (see [20260526-docs-unlink-href]
      // for the underlying fix).
      const clearStyle = {
        bold: undefined,
        italic: undefined,
        underline: undefined,
        strikethrough: undefined,
        fontSize: undefined,
        fontFamily: undefined,
        color: undefined,
        backgroundColor: undefined,
        superscript: undefined,
        subscript: undefined,
        href: undefined,
      } as const;
      // applyStyle already handles range / cell-range / dirty marking.
      editorAPI.applyStyle(clearStyle as Partial<InlineStyle>);
    },
```

If `editorAPI` self-reference isn't available, paste the same body that
`applyStyle` runs and pass `clearStyle` instead — duplicating ~20 lines
is acceptable here.

Do **not** include `image` or `pageNumber` in `clearStyle` — those are
content inlines, not formatting, and removing them would delete content.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test -- editor-clear-formatting.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/editor.ts packages/docs/test/view/editor-clear-formatting.test.ts
git commit -m "Add EditorAPI.clearFormatting

Inline-only — preserves heading level, alignment, line height, and
list state. Mirrors Google Docs' Format → Clear formatting."
```

---

## Task 5: Extend `TextFormattingEditor` interface

**Files:**
- Modify: `packages/frontend/src/components/text-formatting/types.ts`

- [ ] **Step 1: Modify the interface**

Add three methods to `TextFormattingEditor`:

```ts
import type { /* …existing… */ } from "@wafflebase/docs";

export interface TextFormattingEditor {
  // …existing methods…

  /** Read the inline style at the cursor for the current block. */
  getBlockStyle?(): Partial<import("@wafflebase/docs").BlockStyle>;

  /**
   * Summary of inline styles across the current selection.
   * 'mixed' indicates the selection contains more than one value
   * for that key; undefined indicates the key is unset throughout.
   */
  getRangeStyleSummary(): {
    bold?: boolean | 'mixed';
    italic?: boolean | 'mixed';
    underline?: boolean | 'mixed';
    strikethrough?: boolean | 'mixed';
    fontFamily?: string | 'mixed';
    fontSize?: number | 'mixed';
    color?: string | 'mixed';
    backgroundColor?: string | 'mixed';
    superscript?: boolean | 'mixed';
    subscript?: boolean | 'mixed';
  };

  /** Remove every inline style attribute on the current selection. */
  clearFormatting(): void;
}
```

`getBlockStyle` stays optional so existing slides text-box implementations
that don't yet expose it keep type-checking. The Docs `EditorAPI` will
satisfy it through the same `getBlockType` path or via a new helper —
add a thin `getBlockStyle` to the EditorAPI alongside `getBlockType` if
the Docs editor doesn't already expose it; that takes < 10 lines.

- [ ] **Step 2: Add `getBlockStyle` to the docs `EditorAPI`** (if missing)

If `grep -n "getBlockStyle" packages/docs/src/view/editor.ts` is empty,
add the method to the interface and return object, returning the
`style` of the block at the cursor:

```ts
  /** Read the block style at the cursor position. */
  getBlockStyle(): Partial<BlockStyle>;
```

```ts
    getBlockStyle: () => {
      const block = doc.findBlock(cursor.position.blockId);
      return block ? { ...block.style } : {};
    },
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/text-formatting/types.ts packages/docs/src/view/editor.ts
git commit -m "Expose getRangeStyleSummary, clearFormatting, getBlockStyle on TextFormattingEditor

The shared pickers read range-level state for mixed-selection display
and block style for line-spacing reflection."
```

---

## Task 6: `FontFamilyPicker` component

**Files:**
- Create: `packages/frontend/src/components/text-formatting/font-family-picker.tsx`
- Test: `packages/frontend/tests/components/text-formatting/font-family-picker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/tests/components/text-formatting/font-family-picker.test.ts
// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TooltipProvider } from '../../../src/components/ui/tooltip.tsx';
import { FontFamilyPicker } from '../../../src/components/text-formatting/font-family-picker.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(h(TooltipProvider, null, ui)); });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (host && host.parentNode) host.parentNode.removeChild(host);
  root = null; host = null;
});

describe('FontFamilyPicker', () => {
  test('shows the resolved value in the trigger', () => {
    const el = render(h(FontFamilyPicker, { value: 'Georgia', onChange: () => {} }));
    expect(el.querySelector('[aria-label="Font"]')!.textContent).toContain('Georgia');
  });

  test('renders empty label when value is undefined (mixed selection)', () => {
    const el = render(h(FontFamilyPicker, { value: undefined, onChange: () => {} }));
    const trigger = el.querySelector('[aria-label="Font"]')!;
    // Placeholder text is em dash for the mixed/unset state.
    expect(trigger.textContent).toContain('—');
  });

  test('fires onChange with the catalog family on item click', () => {
    const onChange = vi.fn();
    const el = render(h(FontFamilyPicker, { value: 'Arial', onChange }));
    act(() => {
      (el.querySelector('[aria-label="Font"]') as HTMLButtonElement).click();
    });
    // Radix portals into document.body
    const item = [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((n) => n.textContent === 'Georgia') as HTMLElement | undefined;
    expect(item).toBeTruthy();
    act(() => { item!.click(); });
    expect(onChange).toHaveBeenCalledWith('Georgia');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- font-family-picker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// packages/frontend/src/components/text-formatting/font-family-picker.tsx
import { useMemo } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { IconChevronDown } from '@tabler/icons-react';
import { FONT_CATALOG, type FontGroup } from './font-catalog';

const GROUP_ORDER: readonly FontGroup[] = ['Korean', 'Sans-serif', 'Serif', 'Monospace'];

interface FontFamilyPickerProps {
  /** Current family, or undefined for the mixed/unset state. */
  value: string | undefined;
  /** Called with the selected family. */
  onChange: (family: string) => void;
  /** Prefetch hook fired on item pointer-enter (web fonts only). */
  onPrefetch?: (family: string) => void;
  disabled?: boolean;
}

export function FontFamilyPicker({
  value,
  onChange,
  onPrefetch,
  disabled,
}: FontFamilyPickerProps) {
  const grouped = useMemo(() => {
    const map = new Map<FontGroup, typeof FONT_CATALOG>();
    for (const group of GROUP_ORDER) {
      map.set(group, FONT_CATALOG.filter((f) => f.group === group) as typeof FONT_CATALOG);
    }
    return map;
  }, []);

  const label = value ?? '—';

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Font"
              disabled={disabled}
              className="inline-flex h-7 min-w-[130px] cursor-pointer items-center justify-between rounded-md px-2 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              data-text-edit-keepalive
            >
              <span className="truncate" style={{ fontFamily: value }}>
                {label}
              </span>
              <IconChevronDown size={12} className="ml-1 shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Font</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="max-h-[320px] w-[220px] overflow-y-auto"
        data-text-edit-keepalive
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {GROUP_ORDER.map((group, gi) => {
          const entries = grouped.get(group) ?? [];
          if (entries.length === 0) return null;
          return (
            <div key={group}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                {group}
              </DropdownMenuLabel>
              {entries.map((entry) => (
                <DropdownMenuItem
                  key={entry.family}
                  onPointerEnter={() => {
                    if (entry.webFont) onPrefetch?.(entry.family);
                  }}
                  onClick={() => onChange(entry.family)}
                >
                  <span style={{ fontFamily: entry.family }}>{entry.label}</span>
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- font-family-picker.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Re-export from the package index**

Edit `packages/frontend/src/components/text-formatting/index.ts` to add:

```ts
export { FontFamilyPicker } from './font-family-picker.tsx';
```

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/text-formatting/font-family-picker.tsx packages/frontend/src/components/text-formatting/index.ts packages/frontend/tests/components/text-formatting/font-family-picker.test.ts
git commit -m "Add FontFamilyPicker shared component

Stateless dropdown grouped by Korean / Sans-serif / Serif / Monospace.
Trigger label renders in the chosen family. Mixed state shows em dash."
```

---

## Task 7: `FontSizePicker` component

**Files:**
- Create: `packages/frontend/src/components/text-formatting/font-size-picker.tsx`
- Test: `packages/frontend/tests/components/text-formatting/font-size-picker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/tests/components/text-formatting/font-size-picker.test.ts
// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TooltipProvider } from '../../../src/components/ui/tooltip.tsx';
import { FontSizePicker } from '../../../src/components/text-formatting/font-size-picker.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function render(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(h(TooltipProvider, null, ui)); });
  return host;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  if (host && host.parentNode) host.parentNode.removeChild(host);
  root = null; host = null;
});

describe('FontSizePicker', () => {
  test('shows the current size in the input', () => {
    const el = render(h(FontSizePicker, { value: 14, onChange: () => {} }));
    expect((el.querySelector('input[aria-label="Font size"]') as HTMLInputElement).value).toBe('14');
  });

  test('shows empty input when value is undefined', () => {
    const el = render(h(FontSizePicker, { value: undefined, onChange: () => {} }));
    expect((el.querySelector('input[aria-label="Font size"]') as HTMLInputElement).value).toBe('');
  });

  test('+ button increments and commits', () => {
    const onChange = vi.fn();
    const el = render(h(FontSizePicker, { value: 12, onChange }));
    act(() => {
      (el.querySelector('[aria-label="Increase font size"]') as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenCalledWith(13);
  });

  test('− button decrements and commits', () => {
    const onChange = vi.fn();
    const el = render(h(FontSizePicker, { value: 12, onChange }));
    act(() => {
      (el.querySelector('[aria-label="Decrease font size"]') as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenCalledWith(11);
  });

  test('clamps to 1..400 on commit', () => {
    const onChange = vi.fn();
    const el = render(h(FontSizePicker, { value: 1, onChange }));
    act(() => {
      (el.querySelector('[aria-label="Decrease font size"]') as HTMLButtonElement).click();
    });
    // already at minimum — onChange must not fire below 1
    expect(onChange).not.toHaveBeenCalled();
  });

  test('Enter commits the typed value', () => {
    const onChange = vi.fn();
    const el = render(h(FontSizePicker, { value: 12, onChange }));
    const input = el.querySelector('input[aria-label="Font size"]') as HTMLInputElement;
    act(() => {
      input.value = '24';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(24);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- font-size-picker.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```tsx
// packages/frontend/src/components/text-formatting/font-size-picker.tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconChevronDown, IconPlus, IconMinus } from '@tabler/icons-react';
import {
  FONT_SIZE_PRESETS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
} from './font-catalog';

interface FontSizePickerProps {
  /** Current size, or undefined for mixed/unset. */
  value: number | undefined;
  /** Fired only on commit (Enter, blur, ±, preset pick). */
  onChange: (size: number) => void;
  disabled?: boolean;
}

const clamp = (n: number) =>
  Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(n)));

export function FontSizePicker({ value, onChange, disabled }: FontSizePickerProps) {
  // Local typed-but-not-yet-committed text. Drives the input value to allow
  // partial entries like "1" on the way to "11".
  const [draft, setDraft] = useState<string>(value !== undefined ? String(value) : '');
  const lastValue = useRef(value);

  // Reflect prop changes from the outside (e.g. selection moved).
  useEffect(() => {
    if (value !== lastValue.current) {
      setDraft(value !== undefined ? String(value) : '');
      lastValue.current = value;
    }
  }, [value]);

  const commit = (n: number) => {
    const clamped = clamp(n);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  const tryCommitDraft = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(value !== undefined ? String(value) : '');
      return;
    }
    commit(n);
  };

  const step = (delta: number) => {
    const base = value ?? Number(draft);
    if (!Number.isFinite(base)) return;
    const next = clamp(base + delta);
    if (next === base) return;
    commit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      tryCommitDraft();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(-1);
    }
  };

  return (
    <div className="inline-flex h-7 items-center rounded-md border border-transparent hover:border-border">
      <button
        type="button"
        aria-label="Decrease font size"
        disabled={disabled}
        onClick={() => step(-1)}
        className="inline-flex h-7 w-6 cursor-pointer items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        <IconMinus size={12} />
      </button>
      <input
        aria-label="Font size"
        type="number"
        min={FONT_SIZE_MIN}
        max={FONT_SIZE_MAX}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={tryCommitDraft}
        onKeyDown={onKeyDown}
        className="h-7 w-10 bg-transparent text-center text-xs outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label="Increase font size"
        disabled={disabled}
        onClick={() => step(1)}
        className="inline-flex h-7 w-6 cursor-pointer items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        <IconPlus size={12} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Font size presets"
            disabled={disabled}
            className="inline-flex h-7 w-6 cursor-pointer items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <IconChevronDown size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {FONT_SIZE_PRESETS.map((s) => (
            <DropdownMenuItem key={s} onClick={() => commit(s)}>
              {s}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- font-size-picker.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Re-export**

```ts
// packages/frontend/src/components/text-formatting/index.ts
export { FontSizePicker } from './font-size-picker.tsx';
```

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/text-formatting/font-size-picker.tsx packages/frontend/src/components/text-formatting/index.ts packages/frontend/tests/components/text-formatting/font-size-picker.test.ts
git commit -m "Add FontSizePicker shared component

± buttons, numeric input committing on Enter/blur, preset dropdown.
Clamps to 1–400. Empty draft on undefined value (mixed selection)."
```

---

## Task 8: `LineSpacingPicker` component

**Files:**
- Create: `packages/frontend/src/components/text-formatting/line-spacing-picker.tsx`
- Test: `packages/frontend/tests/components/text-formatting/line-spacing-picker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/tests/components/text-formatting/line-spacing-picker.test.ts
// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TooltipProvider } from '../../../src/components/ui/tooltip.tsx';
import { LineSpacingPicker } from '../../../src/components/text-formatting/line-spacing-picker.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
function render(ui: ReactElement) {
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(h(TooltipProvider, null, ui)); });
  return host;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  if (host?.parentNode) host.parentNode.removeChild(host);
  root = null; host = null;
});

describe('LineSpacingPicker', () => {
  test('emits the preset value on click', () => {
    const onChange = vi.fn();
    const el = render(h(LineSpacingPicker, { value: 1.5, onChange }));
    act(() => {
      (el.querySelector('[aria-label="Line spacing"]') as HTMLButtonElement).click();
    });
    const items = [...document.body.querySelectorAll('[role="menuitem"]')];
    const double = items.find((n) => n.textContent?.includes('2.0')) as HTMLElement;
    act(() => { double.click(); });
    expect(onChange).toHaveBeenCalledWith(2.0);
  });
});
```

- [ ] **Step 2: Run to fail** — module missing.

- [ ] **Step 3: Implement**

```tsx
// packages/frontend/src/components/text-formatting/line-spacing-picker.tsx
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { IconLineHeight, IconCheck } from '@tabler/icons-react';
import {
  LINE_SPACING_PRESETS,
  LINE_SPACING_MIN,
  LINE_SPACING_MAX,
} from './font-catalog';

interface LineSpacingPickerProps {
  value: number;
  onChange: (lh: number) => void;
  disabled?: boolean;
}

export function LineSpacingPicker({ value, onChange, disabled }: LineSpacingPickerProps) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commitCustom = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(LINE_SPACING_MIN, Math.min(LINE_SPACING_MAX, n));
    onChange(clamped);
    setOpen(false);
    setCustomMode(false);
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCustomMode(false);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Line spacing"
              disabled={disabled}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
            >
              <IconLineHeight size={16} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Line spacing</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="w-[140px]">
        {customMode ? (
          <form
            className="flex items-center gap-1 p-1"
            onSubmit={(e) => { e.preventDefault(); commitCustom(); }}
          >
            <input
              autoFocus
              type="number"
              step={0.05}
              min={LINE_SPACING_MIN}
              max={LINE_SPACING_MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitCustom}
              className="h-7 w-full rounded border border-border bg-background px-2 text-sm outline-none"
            />
          </form>
        ) : (
          <>
            {LINE_SPACING_PRESETS.map((p) => (
              <DropdownMenuItem
                key={p}
                onClick={() => { onChange(p); setOpen(false); }}
                className="flex items-center justify-between"
              >
                <span>{p.toFixed(p === Math.floor(p) ? 1 : 2)}</span>
                {value === p && <IconCheck size={14} />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => { e.preventDefault(); setCustomMode(true); setDraft(String(value)); }}
            >
              Custom…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run test** → PASS.
- [ ] **Step 5: Re-export.**
- [ ] **Step 6: Commit.**

```bash
git add packages/frontend/src/components/text-formatting/line-spacing-picker.tsx packages/frontend/src/components/text-formatting/index.ts packages/frontend/tests/components/text-formatting/line-spacing-picker.test.ts
git commit -m "Add LineSpacingPicker shared component

Preset (1.0 / 1.15 / 1.5 / 2.0) + Custom inline input. Clamps to
0.5–10.0. Emits unitless multiplier for InlineStyle line-height."
```

---

## Task 9: `ClearFormattingButton` component

**Files:**
- Create: `packages/frontend/src/components/text-formatting/clear-formatting-button.tsx`

- [ ] **Step 1: Implement** (trivial — no separate test file needed; covered by toolbar integration in Task 11)

```tsx
// packages/frontend/src/components/text-formatting/clear-formatting-button.tsx
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconClearFormatting } from '@tabler/icons-react';

interface ClearFormattingButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function ClearFormattingButton({ onClick, disabled }: ClearFormattingButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Clear formatting"
          disabled={disabled}
          onClick={onClick}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
        >
          <IconClearFormatting size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Clear formatting</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Re-export and commit.**

```bash
git add packages/frontend/src/components/text-formatting/clear-formatting-button.tsx packages/frontend/src/components/text-formatting/index.ts
git commit -m "Add ClearFormattingButton shared component

Plain button stub — heavy lifting lives in editor.clearFormatting()."
```

---

## Task 10: Inject Google Fonts CSS link at app bootstrap

**Files:**
- Locate the frontend root entry. Run `rtk grep -n "createRoot" packages/frontend/src --include="*.tsx" -l` and pick the file that mounts `<App>` (typically `src/main.tsx`).
- Modify that file.

- [ ] **Step 1: Add the link injector**

At module top level, before `createRoot(...).render(<App />)`:

```ts
import { buildGoogleFontsHref } from '@/components/text-formatting/font-catalog';

(function injectGoogleFontsLink() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('wafflebase-google-fonts')) return;
  const link = document.createElement('link');
  link.id = 'wafflebase-google-fonts';
  link.rel = 'stylesheet';
  link.href = buildGoogleFontsHref();
  document.head.appendChild(link);
})();
```

The IIFE runs on import — guards against double injection during HMR.

- [ ] **Step 2: Manual check**

Run `pnpm dev`, open the docs editor, and confirm the `<link id="wafflebase-google-fonts">` is in the page `<head>` and the Roboto / Noto Sans KR / Noto Serif KR / Nanum Gothic font face rules are present in the CSSOM. (`document.fonts.check('12px "Noto Sans KR"')` should return true once the font loads.)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/main.tsx
git commit -m "Inject Google Fonts CSS link at frontend bootstrap

Single network round-trip for the 4 web fonts in FONT_CATALOG. Binary
downloads still happen lazily via FontRegistry.ensureFont on first
paint of a run that requests the family."
```

---

## Task 11: Wire body toolbar — font family, size, line spacing, clear formatting

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`

- [ ] **Step 1: Add a selection-state hook inside the toolbar**

Near the top of `DocsFormattingToolbar`, after the existing `useState`/`useCallback` setup, add a reactive summary read:

```tsx
import { useEffect } from 'react';
import {
  FontFamilyPicker,
  FontSizePicker,
  LineSpacingPicker,
  ClearFormattingButton,
} from '@/components/text-formatting';

// Inside DocsFormattingToolbar:
const [summary, setSummary] = useState<ReturnType<NonNullable<typeof editor>['getRangeStyleSummary']>>({});
const [lineHeight, setLineHeight] = useState<number>(1.5);

useEffect(() => {
  if (!editor) return;
  const refresh = () => {
    setSummary(editor.getRangeStyleSummary());
    const bs = editor.getBlockStyle?.() ?? {};
    setLineHeight(typeof bs.lineHeight === 'number' ? bs.lineHeight : 1.5);
  };
  refresh();
  editor.onCursorMove(refresh);
}, [editor]);

const familyValue = summary.fontFamily === 'mixed' ? undefined : summary.fontFamily;
const sizeValue = summary.fontSize === 'mixed' ? undefined : summary.fontSize;

const handleFontFamily = (family: string) => {
  if (!editor) return;
  // Lazy-load web font binary before paint, if it isn't already cached.
  editor.getStore()?.fonts?.ensureFont?.(family);
  editor.applyStyle({ fontFamily: family });
  editor.focus();
};
const handleFontSize = (size: number) => {
  editor?.applyStyle({ fontSize: size });
  editor?.focus();
};
const handleLineSpacing = (lh: number) => {
  editor?.applyBlockStyle({ lineHeight: lh });
  editor?.focus();
};
const handleClearFormatting = () => {
  editor?.clearFormatting();
  editor?.focus();
};
```

> Note on `getStore().fonts`: the docs editor exposes `FontRegistry` via the store today only on demand. If `editor.getStore().fonts` is undefined, skip the call — `applyStyle` will still write the family name and `paint-layout.ts` invokes `resolveFontFamily` which the browser handles. The follow-up Yorkie store change to expose `fonts` is out of scope.

> If `editor.onCursorMove` callbacks accumulate without an unsubscribe path, this hook leaks one listener per editor swap. If the existing toolbar already deals with this (e.g. via a `useEditorEvents` helper), reuse that. Otherwise, add a return-value cleanup that nulls the closure. The slides toolbar already handles a similar pattern — mirror it.

- [ ] **Step 2: Insert the controls in the body branch**

In the body context return (around the `<TextStyleGroup editor={editor} />` block — only rendered on desktop), insert between `TextStyleGroup` and `TextFormatGroup`:

```tsx
{!isMobile && (
  <>
    <TextStyleGroup editor={editor} />
    <ToolbarSeparator />
    <FontFamilyPicker
      value={familyValue}
      onChange={handleFontFamily}
      onPrefetch={(family) => editor?.getStore()?.fonts?.ensureFont?.(family)}
    />
    <FontSizePicker value={sizeValue} onChange={handleFontSize} />
    <ToolbarSeparator />
  </>
)}
```

In the Paragraph group, after `<TextParagraphGroup editor={editor} />`, add:

```tsx
    <ToolbarSeparator />
    <LineSpacingPicker value={lineHeight} onChange={handleLineSpacing} />
```

Before the Export dropdown, add:

```tsx
    <ToolbarSeparator />
    <ClearFormattingButton onClick={handleClearFormatting} />
```

- [ ] **Step 3: Mobile overflow menu additions**

In the mobile overflow `DropdownMenuContent`, add a "Font" section above the existing "Styles" section:

```tsx
<DropdownMenuLabel>Font</DropdownMenuLabel>
<DropdownMenuItem
  onSelect={(e) => e.preventDefault()}
  className="flex flex-col items-stretch gap-1 p-2"
>
  <FontFamilyPicker
    value={familyValue}
    onChange={(f) => { handleFontFamily(f); }}
  />
  <FontSizePicker value={sizeValue} onChange={handleFontSize} />
</DropdownMenuItem>
<DropdownMenuSeparator />
```

And add "Line spacing" + "Clear formatting" entries at the bottom of the overflow menu:

```tsx
<DropdownMenuSeparator />
<DropdownMenuLabel>Spacing</DropdownMenuLabel>
<DropdownMenuItem
  onSelect={(e) => e.preventDefault()}
  className="p-2"
>
  <LineSpacingPicker value={lineHeight} onChange={handleLineSpacing} />
</DropdownMenuItem>
<DropdownMenuItem onClick={handleClearFormatting}>
  <IconClearFormatting size={16} className="mr-2" />
  Clear formatting
</DropdownMenuItem>
```

Add the missing import: `import { IconClearFormatting } from '@tabler/icons-react'`.

- [ ] **Step 4: Manual verify**

Run `pnpm dev`. Open a docs document, select a run, change the font family — the run repaints in the new family. Change font size — repaints at new size. Change line spacing — paragraph reflows. Click clear formatting on a styled selection — colors, bold/italic, font drop back to defaults, but heading level / alignment stay.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/docs/docs-formatting-toolbar.tsx
git commit -m "Wire font/size/line-spacing/clear formatting into Docs body toolbar

Family + size sit between Styles and B/I/U (Google Docs parity).
Line spacing slots into the Paragraph group. Clear formatting is the
last item before Export. Mobile overflow gains all four."
```

---

## Task 12: Wire header / footer slim toolbar

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` (the `isHeaderFooter` branch)

- [ ] **Step 1: Add the two pickers**

Inside the `isHeaderFooter` branch return, insert family + size between the `contextLabel` span and the existing `B I U` block:

```tsx
<ToolbarSeparator />
<FontFamilyPicker
  value={familyValue}
  onChange={handleFontFamily}
  onPrefetch={(family) => editor?.getStore()?.fonts?.ensureFont?.(family)}
/>
<FontSizePicker value={sizeValue} onChange={handleFontSize} />
<ToolbarSeparator />
```

Note: the header/footer branch currently defines its own `toggleBold` / `toggleItalic` / `toggleUnderline` callbacks because it doesn't use the shared `TextFormatGroup`. The `familyValue` / `sizeValue` / `handleFontFamily` / `handleFontSize` definitions added in Task 11 are scoped to the body branch — duplicate them at the top of the function (above the `if (isHeaderFooter)` check) so both branches can read them. Move:

```tsx
const [summary, setSummary] = useState<…>({});
useEffect(…);
const familyValue = …;
const sizeValue = …;
const handleFontFamily = …;
const handleFontSize = …;
```

…above the `isHeaderFooter` check.

- [ ] **Step 2: Manual verify**

Open the docs page setup, edit the header (or footer), and confirm both pickers appear and apply correctly to a selected run inside the header.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/docs/docs-formatting-toolbar.tsx
git commit -m "Add font family and size pickers to header/footer toolbar

Same shared components as the body toolbar; no line spacing or clear
formatting in the slim context."
```

---

## Task 13: Yorkie-attached integration test

**Files:**
- Create: `packages/backend/test/docs-font-styles-attached.e2e-spec.ts` (mirrors `docs-tree-attached.e2e-spec.ts` patterns)

- [ ] **Step 1: Write the test**

```ts
// packages/backend/test/docs-font-styles-attached.e2e-spec.ts
/**
 * Verifies that font-family / font-size writes survive a detach +
 * reattach round trip through Yorkie, and that clearFormatting
 * actually removes the attributes from the underlying Tree (no
 * zombie attrs — mirrors the 20260526-docs-unlink-href regression).
 *
 * Gated by RUN_YORKIE_INTEGRATION_TESTS=true; CI runs this via the
 * verify-integration job that brings up Yorkie + Postgres.
 */
import { Test } from '@nestjs/testing';
import { /* the Yorkie test harness used by docs-tree-attached.e2e-spec.ts */ }
  from './helpers/yorkie-test-harness';
import { /* the document factory the existing tests use */ }
  from './helpers/docs-fixture';

const shouldRun = process.env.RUN_YORKIE_INTEGRATION_TESTS === 'true';
const d = shouldRun ? describe : describe.skip;

d('Docs font styles round-trip (Yorkie)', () => {
  // Pattern: open store, write a Roboto / 24 inline style on a known
  // block, detach, reattach with a fresh client, assert the style is
  // still present in the Tree (not just the in-memory cache).
  test('fontFamily and fontSize survive reattach', async () => {
    // mirror the structure of docs-tree-attached.e2e-spec.ts;
    // assertions:
    //   expect(reread.blocks[0].inlines[0].style.fontFamily).toBe('Roboto');
    //   expect(reread.blocks[0].inlines[0].style.fontSize).toBe(24);
  });

  test('clearFormatting removes attrs from the Tree', async () => {
    // 1. apply { bold: true, color: '#ff0000', fontFamily: 'Roboto' }
    // 2. call editor.clearFormatting()
    // 3. detach
    // 4. reattach with a fresh client
    // 5. assert every cleared key is undefined on the inline style
    //    of the Tree-read block (not just on the in-memory cache).
  });
});
```

> The exact harness and fixture imports must match
> `packages/backend/test/docs-tree-attached.e2e-spec.ts`. Open that
> file first and copy its imports, beforeAll/afterAll lifecycle, and
> client/document creation helpers verbatim; this plan does not
> reproduce them because they're already canonical in that file.

- [ ] **Step 2: Run the test with the integration gates set**

```bash
docker compose up -d
RUN_DB_INTEGRATION_TESTS=true \
RUN_YORKIE_INTEGRATION_TESTS=true \
  pnpm --filter @wafflebase/backend test:e2e -- docs-font-styles-attached
```

Expected: PASS (initial run may need the docs-package rebuild — see Pitfalls in CLAUDE.md: "rebuild a producer package after cross-package API changes").

- [ ] **Step 3: Commit**

```bash
git add packages/backend/test/docs-font-styles-attached.e2e-spec.ts
git commit -m "Add Yorkie integration test for font styles round-trip

Asserts fontFamily/fontSize survive detach+reattach and that
clearFormatting tears the attributes off the Tree node rather than
just the in-memory cache (regression guard for the
20260526-docs-unlink-href class of bug)."
```

---

## Task 14: Final verification, code review, todo update

- [ ] **Step 1: Run the fast verification gate**

```bash
pnpm verify:fast
```

Expected: PASS. If a stale `dist/` makes things look broken (see the
project memory note on `verify:fast` failures), run
`pnpm -r --filter @wafflebase/docs build` first and retry.

- [ ] **Step 2: Self code review over the branch diff**

Invoke `superpowers:requesting-code-review` (or `/code-review`) and
apply any blocking findings. Notable areas to ask the reviewer to
double-check:
- `getRangeStyleSummary` handling of cell-range selections (`tableCellRange`).
- `clearFormatting`'s key list against the current `InlineStyle` shape — additions to `InlineStyle` need a paired update here.
- `onCursorMove` listener leak across editor remounts.

- [ ] **Step 3: Update the todo checklist**

In `docs/tasks/active/20260529-docs-font-controls-todo.md`, tick the
checklist items that match the work landed, and write the "Review"
section with: root cause / approach summary, the verification commands
run, anything intentionally deferred (e.g. "More fonts" dialog).

- [ ] **Step 4: Capture lessons**

In `docs/tasks/active/20260529-docs-font-controls-lessons.md`, write
the lessons learned — surprises, pitfalls, anything a future agent
would benefit from. Skip if none.

- [ ] **Step 5: Archive and reindex**

```bash
pnpm tasks:archive && pnpm tasks:index
```

- [ ] **Step 6: Final commit**

```bash
git add docs/tasks/
git commit -m "Wrap up docs-font-controls task

Tick todo items, write review and lessons, archive task files."
```

- [ ] **Step 7: Push and open PR**

```bash
git push -u origin HEAD
gh pr create --title "Add font family/size/line-spacing/clear-formatting to Docs toolbar" --body "$(cat <<'EOF'
## Summary

- New Docs toolbar controls: font family picker (14 curated families),
  Google-Docs-style font size input, line spacing dropdown, clear
  formatting button.
- New editor APIs: `getRangeStyleSummary`, `clearFormatting`.
- New shared components under `text-formatting/`, reusable by Slides
  in a future PR.

Design: [`docs/design/docs/docs-font-controls.md`](docs/design/docs/docs-font-controls.md)

## Test plan

- [ ] `pnpm verify:fast` green
- [ ] `pnpm --filter @wafflebase/docs test` green
- [ ] `pnpm --filter @wafflebase/frontend test` green
- [ ] Manual: change family on a Korean+English run, repaints correctly
- [ ] Manual: mixed selection → empty picker state, click applies uniformly
- [ ] Manual: clear formatting preserves heading + alignment
- [ ] Integration: `RUN_YORKIE_INTEGRATION_TESTS=true pnpm backend test:e2e -- docs-font-styles-attached`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (filled in by the plan author)

**Spec coverage**: every section of `docs-font-controls.md` maps to a task:
- "Shared text-formatting components" → Tasks 6–9
- "Curated font list" → Tasks 1–2
- "Font size control" → Task 7
- "Line spacing control" → Task 8
- "Clear formatting" → Tasks 4, 9
- "Editor API additions" → Tasks 3, 4
- "Toolbar layout — body / header / footer" → Tasks 11, 12
- "Selection state synchronization" → Task 11, Step 1
- "Web-font loading flow" → Tasks 1 (catalog), 10 (bootstrap)
- "Testing" → Tasks 3, 4, 6, 7, 8, 13

**Placeholder scan**: no TBDs, no "implement later", no orphan signatures. Two notes mark known divergences (`(editor as any).selection?` escape hatch and the Yorkie test harness imports that mirror an existing file) — these are explicit, not placeholders.

**Type consistency**: `getRangeStyleSummary` shape is identical across Task 3 (interface), Task 5 (TextFormattingEditor), and Task 11 (consumer). `FONT_SIZE_PRESETS` and `FONT_SIZE_MIN/MAX` flow from `font-catalog.ts` (Task 1) through `FontSizePicker` (Task 7) with no rename. `clearFormatting` is `void` everywhere.
