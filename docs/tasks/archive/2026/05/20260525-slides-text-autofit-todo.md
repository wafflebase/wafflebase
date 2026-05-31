# Slides Text Autofit Implementation Plan

> **Reconciliation note (post-implementation):** The `grow` mode in this
> plan was independently shipped on `main` as `slides-textbox-autogrow`
> (docs `onContentHeightChange` + `setContentHeight`) while this branch
> was in review. The branch was rebased onto that work: the engine,
> renderer shrink, type, defaults, PPTX import, and Yorkie persistence
> below are unchanged, but the editor/docs wiring (Tasks 5–6) was
> reworked to **reuse** main's auto-grow for `grow` and add only a
> `transformLayoutBlocks` hook for `shrink`. Absent `autofit` ⇒ `grow`
> (not `none`) to preserve the shipped auto-grow default. See the design
> doc and `*-lessons.md` (lesson 8).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give slides text boxes Google-Slides/PowerPoint-parity autofit — `none` / `shrink` (font auto-scales to fit a fixed box) / `grow` (box height tracks content) — with shrink computed live (no persistence) and grow height written on commit.

**Architecture:** A pure engine module (`model/autofit.ts`) sits on top of the docs `computeLayout` primitive that the slides renderer already uses. The committed canvas renderer and the in-place editor both feed blocks through the same shrink scale, keeping them pixel-identical. The editor's live behavior needs two small, backward-compatible optional hooks on docs `initializeTextBox`. Defaults: placeholders → `shrink`, free text boxes → `grow`; PPTX `<a:bodyPr>` autofit child maps on import.

**Tech Stack:** TypeScript, Vitest, `@wafflebase/docs` (`computeLayout`, `TextMeasurer`, `Block`), `@wafflebase/slides`.

Design doc: `docs/design/slides/slides-text-autofit.md`.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/slides/src/model/element.ts` | `AutofitMode` type + `TextElement.data.autofit` field | Modify |
| `packages/slides/src/model/autofit.ts` | Pure engine: `scaleBlocks`, `computeAutofitScale`, `computeAutofitHeight` | Create |
| `packages/slides/test/model/autofit.test.ts` | Engine tests with a fake `TextMeasurer` | Create |
| `packages/slides/src/view/canvas/text-renderer.ts` | Apply shrink scale in `drawText` | Modify |
| `packages/slides/src/view/editor/interactions/insert.ts` | Seed inserted text box `autofit: 'grow'` | Modify |
| `packages/slides/src/model/layout.ts` | Seed placeholder `autofit: 'shrink'` | Modify |
| `packages/docs/src/view/text-box-editor.ts` | Optional `transformLayoutBlocks` + `onContentHeight` hooks; shim page height = `max(contentHeight, totalHeight)` | Modify |
| `packages/docs/test/view/text-box-editor.test.ts` | Hook tests | Create/extend |
| `packages/slides/src/view/editor/text-box-editor.ts` | Wire shrink transform + grow live-resize | Modify |
| `packages/slides/src/view/editor/editor.ts` | On commit, write grow `frame.h` | Modify |
| `packages/slides/src/import/pptx/text.ts` | `detectAutofitMode(txBody)` helper | Modify |
| `packages/slides/src/import/pptx/shape.ts` | Set `data.autofit` from bodyPr in `buildTextElement` | Modify |
| `packages/slides/test/import/*.test.ts` | Import mode-mapping test | Create/extend |

**Conventions discovered:**
- `computeLayout(blocks, measurer, contentWidth)` returns `{ layout, cache }`; `layout.totalHeight` is content height. `measurer` is typed `TextMeasurer` (interface with one method `measureWidth(text, font: ResolvedFont): number`) — inject a fake in tests; jsdom has no real Canvas 2D context.
- `Block.style.{marginTop,marginBottom}` are px; `lineHeight` is a ratio (do NOT scale). `Inline.style.fontSize?` defaults to `DEFAULT_INLINE_STYLE.fontSize` (11).
- Slides resolves `@wafflebase/docs` against its built `dist/`, so **rebuild docs** (`pnpm docs build`) after editing the docs package before slides typechecks against it.
- The committed renderer currently paints real text at `(0,0)` with no inset → pass `padding = 0` for v1.

---

### Task 1: Add `AutofitMode` type and `TextElement.data.autofit` field

**Files:**
- Modify: `packages/slides/src/model/element.ts:103` (near `PlaceholderType`) and `:122-130` (`TextElement`)

- [x] **Step 1: Add the type and field**

In `packages/slides/src/model/element.ts`, add after the `PlaceholderRef` type (around line 114):

```ts
/**
 * Text-box autofit behavior, mirroring OOXML `<a:bodyPr>` children:
 * - 'none'   ↔ <a:noAutofit/>   — box fixed, text overflows
 * - 'shrink' ↔ <a:normAutofit/> — box fixed, font auto-scales down to fit
 * - 'grow'   ↔ <a:spAutoFit/>   — font fixed, box height tracks content
 *
 * The shrink scale is derived live at render/edit time and never stored.
 * The grow height is written to `frame.h` on edit commit.
 */
export type AutofitMode = 'none' | 'shrink' | 'grow';
```

Then extend `TextElement.data` (around line 124-129):

```ts
export type TextElement = ElementBase & {
  type: 'text';
  data: {
    /** Domain-level read view; the Yorkie store backs this with a Tree. */
    blocks: Block[];
    stroke?: Stroke;
    fill?: ThemeColor;
    /**
     * Autofit behavior. Absent ⇒ 'none' so documents created before this
     * field keep their current fixed-size rendering (no migration).
     */
    autofit?: AutofitMode;
  };
};
```

- [x] **Step 2: Verify the package typechecks**

Run: `pnpm --filter @wafflebase/slides exec tsc --noEmit`
Expected: PASS (no errors).

- [x] **Step 3: Commit**

```bash
git add packages/slides/src/model/element.ts
git commit -m "Add AutofitMode type and TextElement.data.autofit field"
```

---

### Task 2: Autofit engine (`model/autofit.ts`)

**Files:**
- Create: `packages/slides/src/model/autofit.ts`
- Test: `packages/slides/test/model/autofit.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/slides/test/model/autofit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BLOCK_STYLE,
  type Block,
  type ResolvedFont,
  type TextMeasurer,
} from '@wafflebase/docs';
import {
  scaleBlocks,
  computeAutofitScale,
  computeAutofitHeight,
} from '../../src/model/autofit';

// Width proportional to font size so wrapping (and therefore totalHeight)
// changes with scale — exercises the non-linear binary search.
const fakeMeasurer: TextMeasurer = {
  measureWidth: (text: string, font: ResolvedFont) => text.length * font.size * 0.6,
};

function para(text: string, fontSize = 20): Block {
  return {
    id: `b-${text}`,
    type: 'paragraph',
    inlines: [{ text, style: { fontSize } }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

describe('scaleBlocks', () => {
  it('returns the same reference when scale is 1', () => {
    const blocks = [para('hello')];
    expect(scaleBlocks(blocks, 1)).toBe(blocks);
  });

  it('multiplies inline fontSize and block margins, preserving identity', () => {
    const [b] = scaleBlocks([para('hello', 20)], 0.5);
    expect(b.inlines[0].style.fontSize).toBe(10);
    expect(b.id).toBe('b-hello');
    expect(b.inlines[0].text).toBe('hello');
    expect(b.style.marginBottom).toBe(DEFAULT_BLOCK_STYLE.marginBottom * 0.5);
  });

  it('falls back to the default font size (11) when inline has none', () => {
    const blocks: Block[] = [{
      id: 'x', type: 'paragraph',
      inlines: [{ text: 'a', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    }];
    expect(scaleBlocks(blocks, 0.5)[0].inlines[0].style.fontSize).toBe(5.5);
  });
});

describe('computeAutofitScale', () => {
  it('returns 1 when content already fits the box', () => {
    const scale = computeAutofitScale([para('hi', 20)], fakeMeasurer, 1000, 1000, 0);
    expect(scale).toBe(1);
  });

  it('returns a scale < 1 when content overflows', () => {
    // Many lines into a short box → must shrink.
    const blocks = Array.from({ length: 20 }, (_, i) => para(`line ${i}`, 40));
    const scale = computeAutofitScale(blocks, fakeMeasurer, 200, 60, 0);
    expect(scale).toBeGreaterThan(0.1);
    expect(scale).toBeLessThan(1);
  });

  it('never returns below the floor', () => {
    const blocks = Array.from({ length: 500 }, (_, i) => para(`line ${i}`, 80));
    const scale = computeAutofitScale(blocks, fakeMeasurer, 50, 20, 0);
    expect(scale).toBeGreaterThanOrEqual(0.1);
  });
});

describe('computeAutofitHeight', () => {
  it('returns content height plus twice the padding', () => {
    const single = computeAutofitHeight([para('hi', 20)], fakeMeasurer, 1000, 0);
    const padded = computeAutofitHeight([para('hi', 20)], fakeMeasurer, 1000, 8);
    expect(padded).toBe(single + 16);
    expect(single).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wafflebase/slides exec vitest run test/model/autofit.test.ts`
Expected: FAIL — `Cannot find module '../../src/model/autofit'`.

- [x] **Step 3: Implement the engine**

Create `packages/slides/src/model/autofit.ts`:

```ts
import {
  computeLayout,
  DEFAULT_INLINE_STYLE,
  type Block,
  type TextMeasurer,
} from '@wafflebase/docs';

/** Lowest font scale shrink will ever apply (matches the box-protect intent). */
const SHRINK_FLOOR = 0.1;
/** Binary-search iterations; ~8 lands within ~0.4% of the true fit. */
const SEARCH_STEPS = 8;

/**
 * Multiply every inline font size and block vertical margin by `scale`.
 * Pure: returns new objects but preserves block/inline identity (id,
 * type, text, ordering, counts) so a `Cursor`/`Selection` keyed by
 * (blockId, offset) stays valid against the scaled layout. `lineHeight`
 * is a ratio and is intentionally left unscaled.
 */
export function scaleBlocks(blocks: Block[], scale: number): Block[] {
  if (scale === 1) return blocks;
  return blocks.map((b) => ({
    ...b,
    style: {
      ...b.style,
      marginTop: b.style.marginTop * scale,
      marginBottom: b.style.marginBottom * scale,
    },
    inlines: b.inlines.map((inl) => ({
      ...inl,
      style: {
        ...inl.style,
        fontSize: (inl.style.fontSize ?? DEFAULT_INLINE_STYLE.fontSize ?? 11) * scale,
      },
    })),
  }));
}

/** Content height for grow mode: laid-out height + symmetric padding. */
export function computeAutofitHeight(
  blocks: Block[],
  measurer: TextMeasurer,
  frameW: number,
  padding: number,
): number {
  return computeLayout(blocks, measurer, frameW).layout.totalHeight + 2 * padding;
}

/**
 * Largest font scale in (FLOOR, 1] whose laid-out height fits the box.
 * Height is non-linear in scale (smaller fonts wrap differently), so this
 * binary-searches, re-laying-out per probe. Returns 1 when the content
 * already fits — shrink never enlarges past authored size.
 */
export function computeAutofitScale(
  blocks: Block[],
  measurer: TextMeasurer,
  frameW: number,
  frameH: number,
  padding: number,
): number {
  const avail = frameH - 2 * padding;
  if (avail <= 0) return SHRINK_FLOOR;
  if (computeLayout(blocks, measurer, frameW).layout.totalHeight <= avail) return 1;

  let lo = SHRINK_FLOOR;
  let hi = 1;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2;
    const h = computeLayout(scaleBlocks(blocks, mid), measurer, frameW).layout.totalHeight;
    if (h <= avail) lo = mid;
    else hi = mid;
  }
  return lo;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides exec vitest run test/model/autofit.test.ts`
Expected: PASS (all cases).

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/model/autofit.ts packages/slides/test/model/autofit.test.ts
git commit -m "Add slides text autofit engine (scale/height helpers)"
```

---

### Task 3: Apply shrink in the committed renderer (`drawText`)

**Files:**
- Modify: `packages/slides/src/view/canvas/text-renderer.ts:80-116`
- Test: covered by Task 2 (the engine) + the full suite; `drawText` is canvas-bound so wiring is verified by typecheck + suite + manual smoke.

- [x] **Step 1: Wire the shrink path into `drawText`**

In `text-renderer.ts`, add the import:

```ts
import { computeAutofitScale, scaleBlocks } from '../../model/autofit';
```

Replace the layout block at the end of `drawText` (currently lines 109-115):

```ts
  const normalized: Block[] = data.blocks.map((b) => ({
    ...b,
    style: normalizeBlockStyle(b.style),
  }));
  const colorResolver = makeColorResolver(theme);

  // Shrink autofit: scale fonts down so content fits the fixed box. The
  // same scale is applied in the in-place editor (text-box-editor.ts) so
  // the committed canvas and editing surface stay pixel-identical.
  let toLayout = normalized;
  if (data.autofit === 'shrink') {
    const scale = computeAutofitScale(normalized, measurer, size.w, size.h, 0);
    if (scale !== 1) toLayout = scaleBlocks(normalized, scale);
  }

  const { layout } = computeLayout(toLayout, measurer, size.w);
  paintLayout(ctx, layout, 0, 0, { colorResolver });
```

(`grow` and `none` fall through unchanged: `grow` relies on `frame.h` already equaling content height, written on commit in Task 6.)

- [x] **Step 2: Verify typecheck and full slides suite**

Run: `pnpm --filter @wafflebase/slides exec tsc --noEmit && pnpm test`
Expected: PASS. (`pnpm test` runs the slides/sheets vitest suites.)

- [x] **Step 3: Commit**

```bash
git add packages/slides/src/view/canvas/text-renderer.ts
git commit -m "Apply shrink autofit scale in slides text renderer"
```

---

### Task 4: Seed parity defaults (placeholder = shrink, text box = grow)

**Files:**
- Modify: `packages/slides/src/view/editor/interactions/insert.ts:298-320`
- Modify: `packages/slides/src/model/layout.ts:32-37`
- Test: `packages/slides/test/model/layout.test.ts` (extend) and an `insert` default test

- [x] **Step 1: Write the failing tests**

Add to `packages/slides/test/model/layout.test.ts` (inside an existing or new `describe`):

```ts
import { buildBuiltinLayouts } from '../../src/model/layout';

it('seeds text placeholders with shrink autofit', () => {
  const layouts = buildBuiltinLayouts();
  const textPlaceholders = layouts
    .flatMap((l) => l.placeholders)
    .filter((p) => p.type === 'text');
  expect(textPlaceholders.length).toBeGreaterThan(0);
  for (const p of textPlaceholders) {
    expect(p.data.autofit).toBe('shrink');
  }
});
```

> Adjust `buildBuiltinLayouts` to the actual exported builder name in `layout.ts` if it differs; the assertion is what matters — every text placeholder's `data.autofit === 'shrink'`.

Create `packages/slides/test/view/insert-defaults.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildInsertElement } from '../../src/view/editor/interactions/insert';

describe('buildInsertElement text default', () => {
  it('seeds a user-inserted text box with grow autofit', () => {
    const el = buildInsertElement('text', { x: 0, y: 0 }, { x: 100, y: 40 });
    expect(el.type).toBe('text');
    if (el.type === 'text') expect(el.data.autofit).toBe('grow');
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wafflebase/slides exec vitest run test/model/layout.test.ts test/view/insert-defaults.test.ts`
Expected: FAIL — `autofit` is `undefined`.

- [x] **Step 3: Add the defaults**

In `insert.ts`, inside the `kind === 'text'` branch (line 301), add `autofit: 'grow'` to `data`:

```ts
      data: {
        autofit: 'grow',
        blocks: [{
          id: 'placeholder',
          type: 'paragraph',
          inlines: [{ text: '', style: { color: DEFAULT_TEXT_COLOR } }],
          style: { ...DEFAULT_BLOCK_STYLE },
        } as Block],
      },
```

In `layout.ts`, in `textPlaceholder` (line 35), add `autofit: 'shrink'`:

```ts
    data: { autofit: 'shrink', blocks: emptyBlocks() },
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides exec vitest run test/model/layout.test.ts test/view/insert-defaults.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/interactions/insert.ts packages/slides/src/model/layout.ts packages/slides/test/model/layout.test.ts packages/slides/test/view/insert-defaults.test.ts
git commit -m "Seed slides autofit defaults: placeholder shrink, text box grow"
```

---

### Task 5: docs `initializeTextBox` autofit hooks

**Files:**
- Modify: `packages/docs/src/view/text-box-editor.ts:41-115` (options), `:272-284` (recomputeLayout)
- Test: `packages/docs/test/view/text-box-editor.test.ts` (create or extend)

- [x] **Step 1: Write the failing test**

Create/extend `packages/docs/test/view/text-box-editor.test.ts`. (jsdom has no Canvas 2D context, so `recomputeLayout` runs via `computeLayout` which only needs the measurer; the render path early-returns on a null ctx. We assert the hooks fire.)

```ts
import { describe, it, expect, vi } from 'vitest';
import { initializeTextBox, DEFAULT_BLOCK_STYLE, type Block } from '../../src/index';

function block(text: string): Block {
  return { id: 'b1', type: 'paragraph', inlines: [{ text, style: {} }], style: { ...DEFAULT_BLOCK_STYLE } };
}

describe('initializeTextBox autofit hooks', () => {
  it('calls transformLayoutBlocks before layout and onContentHeight after', () => {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    const transform = vi.fn((blocks: Block[]) => blocks);
    const onContentHeight = vi.fn();

    const api = initializeTextBox({
      container,
      canvas,
      blocks: [block('hello')],
      contentWidth: 200,
      contentHeight: 100,
      transformLayoutBlocks: transform,
      onContentHeight,
    });

    expect(transform).toHaveBeenCalled();
    expect(onContentHeight).toHaveBeenCalledWith(expect.any(Number));
    api.detach();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/docs exec vitest run test/view/text-box-editor.test.ts`
Expected: FAIL — options not accepted / hooks never invoked.

- [x] **Step 3: Add the options and wire them**

In `text-box-editor.ts`, extend `TextBoxEditorOptions` (after `onLinkRequest?`, around line 115):

```ts
  /**
   * Optional transform applied to the document blocks immediately before
   * each layout (NOT to the committed document). Slides autofit "shrink"
   * uses this to scale font sizes so the editor renders at the same scale
   * as the committed slide canvas. MUST preserve block/inline identity
   * (ids, text, counts) so cursor/selection offsets stay valid. Absent ⇒
   * identity.
   */
  transformLayoutBlocks?: (blocks: Block[]) => Block[];
  /**
   * Optional callback fired after each layout with the laid-out content
   * height in logical pixels. Slides autofit "grow" uses this to resize
   * the overlay live. Absent ⇒ no-op.
   */
  onContentHeight?: (height: number) => void;
```

Replace `recomputeLayout` (lines 272-284):

```ts
  const recomputeLayout = (): void => {
    const sourceBlocks = doc.document.blocks;
    const blocksForLayout = opts.transformLayoutBlocks
      ? opts.transformLayoutBlocks(sourceBlocks)
      : sourceBlocks;
    const result = computeLayout(
      blocksForLayout,
      measurer,
      contentWidth,
      undefined,
      layoutCache,
    );
    layout = result.layout;
    layoutCache = result.cache;
    doc.setBlockParentMap(layout.blockParentMap);
    // Size the shim page to at least the content height so the caret /
    // selection page-space math stays correct when content overflows the
    // authored box (grow mode, or any overflow). Harmless for fixed boxes.
    const pageHeight = Math.max(contentHeight, layout.totalHeight);
    paginatedLayout = buildShimPaginatedLayout(layout, contentWidth, pageHeight);
    opts.onContentHeight?.(layout.totalHeight);
  };
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/docs exec vitest run test/view/text-box-editor.test.ts`
Expected: PASS.

- [x] **Step 5: Rebuild docs (slides consumes dist) and commit**

```bash
pnpm --filter @wafflebase/docs build
git add packages/docs/src/view/text-box-editor.ts packages/docs/test/view/text-box-editor.test.ts
git commit -m "Add autofit hooks to docs initializeTextBox"
```

---

### Task 6: Wire the editor (live shrink + live grow + grow commit)

**Files:**
- Modify: `packages/slides/src/view/editor/text-box-editor.ts:35-184`
- Modify: `packages/slides/src/view/editor/editor.ts:1599-1625`
- Test: typecheck + full suite + manual smoke (canvas-bound live behavior is not unit-testable in jsdom).

- [x] **Step 1: Pass the autofit mode into the wrapper and wire both hooks**

In `text-box-editor.ts`, add `autofit` to `MountSlidesTextBoxOptions`:

```ts
  /** Autofit mode of the text element (drives shrink scale / grow resize). */
  autofit?: AutofitMode;
```

Add imports:

```ts
import type { AutofitMode } from '../../model/element';
import { computeAutofitScale, scaleBlocks } from '../../model/autofit';
import { CanvasTextMeasurer } from '@wafflebase/docs';
```

Add a module-scope measurer near the top of the file:

```ts
const autofitMeasurer = new CanvasTextMeasurer();
```

In `mountSlidesTextBox`, destructure `autofit` from opts and pass the hooks into `initializeTextBox` (extend the existing call at line 157):

```ts
  const api: TextBoxEditorAPI = initializeTextBox({
    container,
    canvas,
    blocks,
    contentWidth: frame.w,
    contentHeight: frame.h,
    dpr: dpr * scale,
    scale,
    onCommit: handleCommit,
    onCancel: handleCancel,
    onLinkRequest,
    transformLayoutBlocks:
      autofit === 'shrink'
        ? (bs) => {
            const s = computeAutofitScale(bs, autofitMeasurer, frame.w, frame.h, 0);
            return s === 1 ? bs : scaleBlocks(bs, s);
          }
        : undefined,
    onContentHeight:
      autofit === 'grow'
        ? (logicalHeight) => {
            // Live-resize the overlay container + canvas as content grows.
            // The persisted frame.h is written separately on commit
            // (editor.ts), per the hybrid persistence model.
            const newCssH = Math.max(1, Math.round(logicalHeight * scale));
            container.style.height = `${newCssH}px`;
            canvas.style.height = `${newCssH}px`;
            canvas.height = Math.max(1, Math.round(newCssH * dpr));
          }
        : undefined,
  });
```

> Ordering note: docs fires `onContentHeight` inside `recomputeLayout`, which runs at the start of `renderNow` *before* `clearRect`/paint, so the canvas is resized before docs paints into it — no extra render nudge needed.

- [x] **Step 2: Pass `autofit` through from the editor and write grow height on commit**

In `editor.ts` `enterEditMode` (line 1599), pass `autofit: element.data.autofit` into `mountTextBox`. Then in the `onCommit` handler (lines 1605-1621), after the blocks write, set the grow height:

```ts
      onCommit: (next) => {
        if (!cancelled) {
          try {
            this.options.store.batch(() => {
              this.options.store.withTextElement(slideId, elementId, () => next);
              if (element.data.autofit === 'grow') {
                const h = computeAutofitHeight(next, autofitMeasurer, element.frame.w, 0);
                this.options.store.updateElementFrame(slideId, elementId, { h });
              }
            });
          } catch {
            // Element may have been removed during editing; swallow.
          }
        }
        this.finishEditMode();
      },
```

Add to `editor.ts` imports:

```ts
import { computeAutofitHeight } from '../../model/autofit';
import { CanvasTextMeasurer } from '@wafflebase/docs';
```

Add a private field or module-scope measurer for `autofitMeasurer` in `editor.ts` (mirror the wrapper):

```ts
  private readonly autofitMeasurer = new CanvasTextMeasurer();
```

…and reference it as `this.autofitMeasurer` in the `onCommit` call above. Verify `mountTextBox` (the editor's wrapper-invoking method) forwards the new `autofit` option through to `mountSlidesTextBox`; extend its option object if it whitelists fields.

- [x] **Step 3: Verify typecheck + full suite**

Run: `pnpm --filter @wafflebase/slides exec tsc --noEmit && pnpm test`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add packages/slides/src/view/editor/text-box-editor.ts packages/slides/src/view/editor/editor.ts
git commit -m "Wire slides text editor autofit: live shrink, live grow, grow commit"
```

---

### Task 7: PPTX import — map `<a:bodyPr>` autofit child

**Files:**
- Modify: `packages/slides/src/import/pptx/text.ts:38-56` (add `detectAutofitMode`)
- Modify: `packages/slides/src/import/pptx/shape.ts:548-561` (set `data.autofit`)
- Test: `packages/slides/test/import/autofit.test.ts`

- [x] **Step 1: Write the failing test**

Create `packages/slides/test/import/autofit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { detectAutofitMode } from '../../src/import/pptx/text';

function txBody(autofitXml: string): Element {
  const xml = `<p:txBody xmlns:p="p" xmlns:a="a"><a:bodyPr>${autofitXml}</a:bodyPr><a:p/></p:txBody>`;
  return new DOMParser().parseFromString(xml, 'text/xml').documentElement as unknown as Element;
}

describe('detectAutofitMode', () => {
  it('maps <a:normAutofit/> to shrink', () => {
    expect(detectAutofitMode(txBody('<a:normAutofit/>'))).toBe('shrink');
  });
  it('maps <a:spAutoFit/> to grow', () => {
    expect(detectAutofitMode(txBody('<a:spAutoFit/>'))).toBe('grow');
  });
  it('maps <a:noAutofit/> to none', () => {
    expect(detectAutofitMode(txBody('<a:noAutofit/>'))).toBe('none');
  });
  it('defaults to none when bodyPr has no autofit child', () => {
    expect(detectAutofitMode(txBody(''))).toBe('none');
  });
});
```

> Use whatever XML parser the existing import tests use; check a sibling test in `packages/slides/test/import/` and match its `txBody`/`child` construction helpers if they differ from `@xmldom/xmldom`.

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides exec vitest run test/import/autofit.test.ts`
Expected: FAIL — `detectAutofitMode` not exported.

- [x] **Step 3: Implement `detectAutofitMode` and wire it**

In `text.ts`, add the helper (it reuses the existing `child` import) and export it:

```ts
import type { AutofitMode } from '../../model/element';

/**
 * Map the `<a:bodyPr>` autofit child to an AutofitMode. normAutofit's
 * fontScale is still baked into run sizes by `parseTextBody` (keeping
 * imported decks visually identical); this only tags the mode so the
 * live engine re-engages once the user edits the box.
 */
export function detectAutofitMode(txBody: Element): AutofitMode {
  const bodyPr = child(txBody, 'bodyPr');
  if (!bodyPr) return 'none';
  if (child(bodyPr, 'normAutofit')) return 'shrink';
  if (child(bodyPr, 'spAutoFit')) return 'grow';
  return 'none';
}
```

In `shape.ts` `buildTextElement` (line 553), set `autofit`:

```ts
    data: {
      autofit: detectAutofitMode(txBody),
      blocks: parseTextBody(txBody, {
        rels: ctx.rels,
        report: ctx.report,
        defaultFontSize,
        clrMap: ctx.clrMap,
      }),
    },
```

Add the import to `shape.ts`: `import { parseTextBody, detectAutofitMode } from './text';` (extend the existing `parseTextBody` import).

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/slides exec vitest run test/import/autofit.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/import/pptx/text.ts packages/slides/src/import/pptx/shape.ts packages/slides/test/import/autofit.test.ts
git commit -m "Map PPTX bodyPr autofit child to TextElement.autofit on import"
```

---

### Task 8: Full verification + manual smoke

**Files:** none (verification only).

- [x] **Step 1: Run the fast gate**

Run: `pnpm verify:fast`
Expected: PASS (lint + unit).

- [x] **Step 2: Run builds**

Run: `pnpm verify:self`
Expected: PASS (verify:fast + all package builds).

- [x] **Step 3: Manual smoke in dev**

Run: `pnpm dev`, then in the slides editor:
- Insert a text box, type past the bottom edge → box height grows live; click out → box stays grown (grow).
- Add a layout with a body placeholder, type a long paragraph → font shrinks to fit; the editing surface matches the committed canvas with no jump on commit (shrink).
- Import a PPTX with an autofit body placeholder → renders unchanged; editing it re-engages shrink.

- [x] **Step 4: Capture lessons + finalize**

Record anything non-obvious in `docs/tasks/active/20260525-slides-text-autofit-lessons.md`, then proceed to the project PR workflow (self-review via code-review skill, rebase on `origin/main`, open PR).

---

## Self-Review

**Spec coverage:**
- 3-mode `AutofitMode` field → Task 1. ✓
- Shared engine on `computeLayout` → Task 2. ✓
- Committed renderer shrink → Task 3. ✓
- grow = `frame.h` on commit → Task 6 Step 2. ✓
- Parity defaults (placeholder shrink / text box grow) → Task 4. ✓
- Editor WYSIWYG via docs hooks → Tasks 5 + 6. ✓
- PPTX bodyPr import mapping (keep baking) → Task 7. ✓
- Hybrid persistence (shrink never stored; grow on commit) → Tasks 3/6. ✓
- Back-compat absent ⇒ none (no migration) → Task 1 field is optional; renderer only branches on `=== 'shrink'`/`=== 'grow'`. ✓
- Non-goals (mode UI, vertical anchor, lnSpcReduction, export, bidirectional grow) → not in any task. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Two "adjust to actual name" notes (Task 4 `buildBuiltinLayouts`, Task 7 XML helper) are explicit verification asks, not deferred work.

**Type consistency:** `AutofitMode` ('none'|'shrink'|'grow') used identically in element.ts, autofit.ts callers, text-box-editor.ts, and import. `computeAutofitScale(blocks, measurer, frameW, frameH, padding)` and `computeAutofitHeight(blocks, measurer, frameW, padding)` signatures match between definition (Task 2), renderer (Task 3), editor (Task 6), and tests. `transformLayoutBlocks`/`onContentHeight` names match between docs definition (Task 5) and slides usage (Task 6).
