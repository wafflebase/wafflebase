# Slides PPTX Text Vertical Anchor Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve PPTX `<a:bodyPr anchor="t|ctr|b">` (vertical text anchor) on slide import so imported title placeholders render with text positioned correctly inside their (often over-sized) frames.

**Architecture:** Add a sparse `verticalAnchor` field to `TextElement['data']` (absent ⇒ `'top'`, matching today's behavior). The PPTX importer reads `<a:bodyPr anchor>` and writes the field. The canvas text renderer measures laid-out content height and translates the paint origin so text sits at the top / middle / bottom of the frame. Editor parity (in-place editing offset) is scoped as Phase 2 and may ship as a follow-up PR.

**Tech Stack:** TypeScript, Vitest (slides package tests), `@wafflebase/docs` `computeLayout` / `paintLayout` (already returns `layout.totalHeight`).

**Scope notes:**
- Table cells (`<a:tc><a:tcPr anchor>`) are NOT covered. They have a separate model path and only fix a related-but-different category of bug. Follow-up.
- Body insets (`<a:bodyPr tIns/bIns/lIns/rIns>`) are NOT covered. Currently dropped; small (~0.1") visual effect. Follow-up.
- "Big number" / `caption` placeholders not present in the source bug report; the model field applies uniformly to all `TextElement`s, so they get the same treatment for free.

---

## Chunk 1: Display (the visible bug)

### Task 1: Add `verticalAnchor` field to the TextElement model

**Files:**
- Modify: `packages/slides/src/model/element.ts:133-149`
- Test: `packages/slides/test/model/element.test.ts` (may not exist; if absent, create or skip — the type-level change is exercised by Task 3's renderer test)

- [x] **Step 1: Add field to `TextElement['data']`**

In `packages/slides/src/model/element.ts`, modify the `TextElement` type declaration:

```ts
export type TextElement = ElementBase & {
  type: 'text';
  data: {
    /** Domain-level read view; the Yorkie store backs this with a Tree. */
    blocks: Block[];
    stroke?: Stroke;
    fill?: ThemeColor;
    /**
     * Autofit behavior. **Absent ⇒ `'grow'`** (the pre-autofit auto-grow
     * default established by the `slides-textbox-autogrow` feature) so
     * existing decks keep growing. Set `'none'` explicitly to disable
     * auto-grow; `'shrink'` to scale fonts to a fixed box. See
     * `docs/design/slides/slides-text-autofit.md`.
     */
    autofit?: AutofitMode;
    /**
     * Vertical position of the laid-out content inside the text frame.
     * Mirrors OOXML `<a:bodyPr anchor>`:
     * - `'top'` ↔ `anchor="t"` (and absent — preserves pre-feature behavior)
     * - `'middle'` ↔ `anchor="ctr"`
     * - `'bottom'` ↔ `anchor="b"`
     *
     * Imported from PPTX; the renderer translates the paint origin by
     * `(frame.h − layout.totalHeight) * factor` so content sits at the
     * top / middle / bottom of the frame.
     */
    verticalAnchor?: 'top' | 'middle' | 'bottom';
  };
};
```

- [x] **Step 2: Verify type-checks across the package**

Run: `pnpm --filter @wafflebase/slides exec tsc --noEmit`
Expected: clean (no callers break because the field is optional).

- [x] **Step 3: Commit**

```bash
git add packages/slides/src/model/element.ts
git commit -m "$(cat <<'EOF'
Add verticalAnchor field to slides TextElement model

Mirrors OOXML <a:bodyPr anchor>. Sparse field — absent preserves
existing top-anchored behavior, so old documents and tests remain
valid without migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Parse `<a:bodyPr anchor>` in the PPTX importer

**Files:**
- Modify: `packages/slides/src/import/pptx/text.ts:36-42`
- Modify: `packages/slides/src/import/pptx/shape.ts:532-563`
- Test: `packages/slides/test/import/pptx/text.test.ts`

- [x] **Step 1: Write the failing test**

Add to `packages/slides/test/import/pptx/text.test.ts` (at the end of the file, in a new `describe` block):

```ts
import { detectVerticalAnchor } from '../../../src/import/pptx/text';

describe('detectVerticalAnchor', () => {
  it('returns "bottom" for anchor="b"', () => {
    const t = txBody(`<a:txBody><a:bodyPr anchor="b"/></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBe('bottom');
  });

  it('returns "middle" for anchor="ctr"', () => {
    const t = txBody(`<a:txBody><a:bodyPr anchor="ctr"/></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBe('middle');
  });

  it('returns "top" for anchor="t"', () => {
    const t = txBody(`<a:txBody><a:bodyPr anchor="t"/></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBe('top');
  });

  it('returns undefined when bodyPr is absent', () => {
    const t = txBody(`<a:txBody><a:p><a:r><a:t>x</a:t></a:r></a:p></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBeUndefined();
  });

  it('returns undefined when anchor attr is missing', () => {
    const t = txBody(`<a:txBody><a:bodyPr/></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBeUndefined();
  });

  it('returns "top" for unsupported anchor values (just, dist)', () => {
    const t = txBody(`<a:txBody><a:bodyPr anchor="just"/></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBe('top');
  });
});
```

- [x] **Step 2: Run test to confirm it fails**

Run: `pnpm --filter @wafflebase/slides test text.test.ts -t "detectVerticalAnchor"`
Expected: FAIL with `detectVerticalAnchor is not a function` (or "not exported").

- [x] **Step 3: Implement `detectVerticalAnchor` in `text.ts`**

In `packages/slides/src/import/pptx/text.ts`, after `detectAutofitMode` (around line 42), add:

```ts
/**
 * Map `<a:bodyPr anchor>` to the slides `TextElement.data.verticalAnchor`
 * field. Mirrors OOXML:
 * - `"t"` → `'top'`
 * - `"ctr"` → `'middle'`
 * - `"b"` → `'bottom'`
 * - `"just"` / `"dist"` (justified, distributed) → `'top'` — slides
 *   doesn't model these, falling back to top keeps content visible.
 *
 * Returns `undefined` when `<a:bodyPr>` is absent or the attribute is
 * unset, so callers can decide whether to write the field. Sparse
 * persistence keeps old documents untouched.
 */
export function detectVerticalAnchor(
  txBody: Element,
): 'top' | 'middle' | 'bottom' | undefined {
  const bodyPr = child(txBody, 'bodyPr');
  if (!bodyPr) return undefined;
  const a = attr(bodyPr, 'anchor');
  if (a == null) return undefined;
  if (a === 'b') return 'bottom';
  if (a === 'ctr') return 'middle';
  if (a === 't') return 'top';
  return 'top';
}
```

- [x] **Step 4: Run test to confirm it passes**

Run: `pnpm --filter @wafflebase/slides test text.test.ts -t "detectVerticalAnchor"`
Expected: PASS (6 specs).

- [x] **Step 5: Wire into `buildTextElement` in `shape.ts`**

In `packages/slides/src/import/pptx/shape.ts`, modify the import line (around line 33) and the `buildTextElement` body (around line 532-563):

Change the import:

```ts
import { detectAutofitMode, detectVerticalAnchor, parseTextBody } from './text';
```

Change the returned `data` object inside `buildTextElement`:

```ts
function buildTextElement(
  id: string,
  frame: SlideElement['frame'],
  txBody: Element,
  ctx: SlideParseContext,
  placeholderRef: PlaceholderRef | undefined,
  layoutSizeKey: string | undefined,
): TextElement {
  const layoutSize = layoutSizeKey ? ctx.placeholderSizes.get(layoutSizeKey) : undefined;
  const fallbackSize = placeholderRef
    ? PLACEHOLDER_DEFAULT_FONT_SIZE[placeholderRef.type]
    : undefined;
  const defaultFontSize = layoutSize ?? fallbackSize;
  const verticalAnchor = detectVerticalAnchor(txBody);
  return {
    id,
    type: 'text',
    frame,
    ...(placeholderRef ? { placeholderRef } : {}),
    data: {
      autofit: detectAutofitMode(txBody),
      ...(verticalAnchor ? { verticalAnchor } : {}),
      blocks: parseTextBody(txBody, {
        rels: ctx.rels,
        report: ctx.report,
        defaultFontSize,
        clrMap: ctx.clrMap,
      }),
    },
  };
}
```

- [x] **Step 6: Add an importer integration test**

Add to `packages/slides/test/import/pptx/text.test.ts` a test that exercises the importer path end-to-end (this guards the `shape.ts` wiring, which the unit test of step 1 does not):

```ts
import { parseSpTree, parseXml as parseSpXml } from '../../../src/import/pptx/shape';
import type { SlideParseContext } from '../../../src/import/pptx/shape';
import type { TextElement } from '../../../src/model/element';

describe('PPTX import — verticalAnchor wiring', () => {
  function makeCtx(): SlideParseContext {
    return {
      archive: { readBytes: async () => undefined, readText: async () => undefined },
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map(),
      scale: { kx: 1 / 9525, ky: 1 / 9525 },
      report: new ImportReport(),
      idMap: new Map(),
      placeholderSizes: new Map(),
      clrMap: {},
    } as unknown as SlideParseContext;
  }

  it('writes verticalAnchor="bottom" for anchor="b" placeholders', async () => {
    const spTree = parseSpXml(`<p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:sp>
        <p:nvSpPr><p:cNvPr id="1" name="Title 1"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="2052600"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
        <p:txBody>
          <a:bodyPr anchor="b"/>
          <a:p><a:r><a:t>Title</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>`).documentElement;
    const elements = await parseSpTree(spTree, makeCtx());
    expect(elements).toHaveLength(1);
    const txt = elements[0] as TextElement;
    expect(txt.type).toBe('text');
    expect(txt.data.verticalAnchor).toBe('bottom');
  });

  it('omits verticalAnchor when bodyPr has no anchor attr', async () => {
    const spTree = parseSpXml(`<p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="2052600"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
        <p:txBody><a:bodyPr/><a:p><a:r><a:t>Body</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>`).documentElement;
    const elements = await parseSpTree(spTree, makeCtx());
    const txt = elements[0] as TextElement;
    expect(txt.data.verticalAnchor).toBeUndefined();
  });
});
```

- [x] **Step 7: Run all importer text tests**

Run: `pnpm --filter @wafflebase/slides test text.test.ts`
Expected: PASS (existing tests + 8 new).

- [x] **Step 8: Commit**

```bash
git add packages/slides/src/import/pptx/text.ts packages/slides/src/import/pptx/shape.ts packages/slides/test/import/pptx/text.test.ts
git commit -m "$(cat <<'EOF'
Parse PPTX <a:bodyPr anchor> into TextElement.verticalAnchor

Source decks anchor title placeholders at the bottom of an oversized
frame (anchor="b"). Without parsing this, imported titles render
~2" above where the source shows them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Apply vertical offset in the canvas text renderer

**Files:**
- Modify: `packages/slides/src/view/canvas/text-renderer.ts:81-127`
- Test: `packages/slides/test/view/canvas/text-renderer.test.ts`

- [x] **Step 1: Write failing renderer tests**

Add to `packages/slides/test/view/canvas/text-renderer.test.ts` (in the existing `describe('drawText', ...)`):

```ts
it('paints at y=0 by default (top-anchored, no field)', () => {
  const ctx = createCtxSpy();
  drawText(asCtx(ctx), { w: 400, h: 200 }, data([paragraph('Hi')]), THEME);
  expect(ctx.fillText).toHaveBeenCalledTimes(1);
  // y is the baseline of the first line; for 11pt default body text the
  // baseline sits well within the top quartile of the frame.
  const firstY = ctx.fillText.mock.calls[0][2] as number;
  expect(firstY).toBeLessThan(40);
});

it('paints near the bottom of the frame when verticalAnchor="bottom"', () => {
  const ctx = createCtxSpy();
  const d: TextElement['data'] = { blocks: [paragraph('Hi')], verticalAnchor: 'bottom' };
  drawText(asCtx(ctx), { w: 400, h: 200 }, d, THEME);
  expect(ctx.fillText).toHaveBeenCalledTimes(1);
  // Bottom-anchored text in a 200px-tall frame must paint in the lower
  // half — guards against the old "always y≈line baseline" behavior.
  const firstY = ctx.fillText.mock.calls[0][2] as number;
  expect(firstY).toBeGreaterThan(150);
});

it('paints near the vertical center when verticalAnchor="middle"', () => {
  const ctx = createCtxSpy();
  const d: TextElement['data'] = { blocks: [paragraph('Hi')], verticalAnchor: 'middle' };
  drawText(asCtx(ctx), { w: 400, h: 200 }, d, THEME);
  const firstY = ctx.fillText.mock.calls[0][2] as number;
  expect(firstY).toBeGreaterThan(80);
  expect(firstY).toBeLessThan(130);
});

it('falls back to top-anchored when content is taller than the frame', () => {
  const ctx = createCtxSpy();
  // 30 paragraphs of 11pt text is comfortably > 40 px tall.
  const blocks = Array.from({ length: 30 }, (_, i) => paragraph(`line ${i}`));
  const d: TextElement['data'] = { blocks, verticalAnchor: 'bottom' };
  drawText(asCtx(ctx), { w: 400, h: 40 }, d, THEME);
  // Negative offset would push text out the top of the frame; clamp at 0.
  const firstY = ctx.fillText.mock.calls[0][2] as number;
  expect(firstY).toBeLessThan(40);
  expect(firstY).toBeGreaterThanOrEqual(0);
});
```

- [x] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter @wafflebase/slides test text-renderer.test.ts -t "verticalAnchor"`
Expected: FAIL — `verticalAnchor: 'bottom'` test paints at y < 50.

- [x] **Step 3: Apply the offset in `drawText`**

In `packages/slides/src/view/canvas/text-renderer.ts`, replace the body around lines 119-127:

```ts
  // Shrink autofit: scale fonts down so content fits the fixed box. The
  // same scale is applied in the in-place editor (text-box-editor.ts) so
  // the committed canvas and editing surface stay pixel-identical.
  let toLayout = normalized;
  if (data.autofit === 'shrink') {
    const scale = computeAutofitScale(normalized, measurer, size.w, size.h, 0);
    if (scale !== 1) toLayout = scaleBlocks(normalized, scale);
  }

  const { layout } = computeLayout(toLayout, measurer, size.w);
  const originY = computeVerticalOriginY(data.verticalAnchor, size.h, layout.totalHeight);
  paintLayout(ctx, layout, 0, originY, { colorResolver });
}

/**
 * Compute the y offset that aligns laid-out content to the requested
 * vertical anchor inside a frame of height `frameH`.
 *
 * - `'top'` (and absent) ⇒ 0 (preserves pre-feature behavior).
 * - `'middle'` ⇒ `(frameH − contentH) / 2`.
 * - `'bottom'` ⇒ `frameH − contentH`.
 *
 * Clamped to ≥ 0 — when content overflows the frame (autofit='none' or
 * a sufficiently small frame in 'shrink' mode), painting starts at the
 * top so visible text isn't clipped above the frame entirely.
 */
function computeVerticalOriginY(
  anchor: 'top' | 'middle' | 'bottom' | undefined,
  frameH: number,
  contentH: number,
): number {
  if (anchor === 'middle') return Math.max(0, (frameH - contentH) / 2);
  if (anchor === 'bottom') return Math.max(0, frameH - contentH);
  return 0;
}
```

- [x] **Step 4: Run tests to confirm pass**

Run: `pnpm --filter @wafflebase/slides test text-renderer.test.ts`
Expected: PASS (existing + 4 new).

- [x] **Step 5: Run the broader slides test suite for regressions**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/canvas/text-renderer.ts packages/slides/test/view/canvas/text-renderer.test.ts
git commit -m "$(cat <<'EOF'
Offset slide text paint origin by verticalAnchor

drawText now measures laid-out content height and translates the
paint origin so text sits at the top/middle/bottom of the frame.
Imported PPTX titles with anchor="b" finally render at the bottom
of their oversized placeholder boxes instead of floating ~2" above.

Clamps to ≥ 0 so overflow content stays visible at the top edge
rather than getting clipped above the frame.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Manual smoke test with the reported PPTX

**Files:**
- None (manual verification).

- [x] **Step 1: Start dev server**

Run: `pnpm dev`
Expected: frontend on :5173, backend on :3000.

- [x] **Step 2: Import the source deck**

In the running app, import `/Users/hackerwins/Downloads/Yorkie, 캐즘 뛰어넘기.pptx` via the slides import path (the same flow used by the share URL `http://localhost:5173/shared/8fc980e1-09ee-457a-85f8-125360c22ead`).

- [x] **Step 3: Visually compare slide 1**

Open the imported deck and inspect slide 1. The title "Yorkie, 캐즘 뛰어넘기" should sit near the BOTTOM of the title placeholder (~2/3 down the slide), matching the source `.pptx` rendered in PowerPoint or Google Slides — NOT at the top of the placeholder box.

- [x] **Step 4: Spot-check additional slides**

Page through 3-5 additional slides whose layouts use the title-slide / section-header masters. Note any remaining vertical position mismatches; record them for the lessons file if found.

- [x] **Step 5: Spot-check existing decks for regressions**

Open one or two pre-existing decks (not the Yorkie one). Their title placeholders use `verticalAnchor: undefined` — they MUST render identically to before (top-anchored). If any pre-existing deck shows a visual change, stop and investigate (Task 3 step 6 commit should be the only behavioral change for legacy data).

---

## Chunk 2: Documentation

### Task 5: Update the import design doc

**Files:**
- Modify: `docs/design/slides/slides-themes-layouts-import.md` (the existing import doc)

- [x] **Step 1: Add `<a:bodyPr anchor>` to the support matrix**

Locate the support matrix table near the bottom of `docs/design/slides/slides-themes-layouts-import.md`. Add a row (replace `??` with the actual file:line at write time):

```markdown
| Vertical text anchor (`<a:bodyPr anchor>`) | ✅ `TextElement.data.verticalAnchor` (`packages/slides/src/import/pptx/text.ts:detectVerticalAnchor`); rendered via offset in `text-renderer.ts:computeVerticalOriginY`. `t/ctr/b` map to `top/middle/bottom`; `just`/`dist` collapse to `top`. |
```

- [x] **Step 2: Note the editor parity gap**

Add a short "Known limitations" bullet (under the existing limitations section if one exists, otherwise create one above the support matrix):

> Vertical anchor is honored by the slide canvas renderer and the read-only present mode, but the in-place text-box editor still mounts at the top of the frame. While editing, text appears "snapped up"; it returns to the configured anchor on commit. Tracked for Chunk 3.

- [x] **Step 3: Commit**

```bash
git add docs/design/slides/slides-themes-layouts-import.md
git commit -m "$(cat <<'EOF'
Document <a:bodyPr anchor> support in slides import doc

Notes the import-side coverage and the in-place editor parity gap
that Chunk 3 will close.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 3: In-place editor parity (optional follow-up — may ship as a separate PR)

This chunk closes the awkward "text snaps to top while editing" UX. It is more invasive (docs package + slides wrapper + pointer math) and is not required to fix the imported title rendering. Ship after Chunk 1 if needed, or skip and file a follow-up.

### Task 6: Thread `verticalAnchor` into `TextBoxEditorOptions` (docs package)

**Files:**
- Modify: `packages/docs/src/view/text-box-editor.ts:42-149` (options interface)
- Modify: `packages/docs/src/view/text-box-editor.ts:356-434` (renderNow paint path)
- Modify: `packages/docs/src/view/text-box-editor.ts` (pointer handler — wherever `findPositionAtPixel` is called for clicks)
- Test: `packages/docs/test/view/text-box-editor.test.ts` (or whichever test file exists; create one if absent)

- [x] **Step 1: Add the option**

In `TextBoxEditorOptions`, add:

```ts
  /**
   * Translate the paint origin (and click hit-test) by this y offset so
   * laid-out content sits at the top / middle / bottom of the editing
   * surface. Mirrors slides `TextElement.data.verticalAnchor`. Recomputed
   * each frame against `layout.totalHeight` because content height
   * changes as the user types.
   *
   * Defaults to `'top'` — docs/sheets callers unaffected.
   */
  verticalAnchor?: 'top' | 'middle' | 'bottom';
```

- [x] **Step 2: Compute and apply origin Y in `renderNow`**

Inside `renderNow`, just after `recomputeLayout()` and the `onContentHeightChange` notification, add:

```ts
    const originY = computeVerticalOriginY(
      opts.verticalAnchor,
      contentHeight,
      layout.totalHeight,
    );
```

Use `originY` in the existing `paintLayout` call (replace the literal `0`):

```ts
    paintLayout(ctx, layout, 0, originY, {
      cursor: cursorOpt
        ? { ...cursorOpt, y: cursorOpt.y + originY }
        : undefined,
      selectionRects: selectionRects?.map((r) => ({ ...r, y: r.y + originY })),
      requestRender,
      colorResolver,
    });
```

Define `computeVerticalOriginY` at module scope (mirror the slides helper exactly so both produce identical offsets):

```ts
function computeVerticalOriginY(
  anchor: 'top' | 'middle' | 'bottom' | undefined,
  frameH: number,
  contentH: number,
): number {
  if (anchor === 'middle') return Math.max(0, (frameH - contentH) / 2);
  if (anchor === 'bottom') return Math.max(0, frameH - contentH);
  return 0;
}
```

- [x] **Step 3: Offset the click hit-test**

Search for the pointer handler in `text-box-editor.ts` that calls `findPositionAtPixel` (it converts `clientX/Y` minus container rect, divides by `scale`, then calls the helper). Subtract `originY` from the y argument before calling:

```ts
// Existing math computes layoutY from the click. Inject:
const adjustedY = layoutY - computeVerticalOriginY(
  opts.verticalAnchor,
  contentHeight,
  layout.totalHeight,
);
const hit = findPositionAtPixel(layout, layoutX, adjustedY);
```

(Read the actual handler code at edit time; the call site name and surrounding variables will reveal the right substitution.)

- [x] **Step 4: Write tests**

In the docs text-box-editor test file, add cases:
- Mount with `verticalAnchor: 'bottom'` and assert the painted text appears in the bottom half of the canvas (mirror the slides renderer test using a ctx spy).
- Simulate a pointer event at the visible text position and assert the cursor lands at offset 0 of the first block (the click hit must map back through the offset).

- [x] **Step 5: Run docs tests**

Run: `pnpm --filter @wafflebase/docs test text-box-editor`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/view/text-box-editor.ts packages/docs/test/view/text-box-editor.test.ts
git commit -m "$(cat <<'EOF'
Honor verticalAnchor in docs text-box editor

Mirrors the slides canvas renderer offset so the in-place editor
paints, hit-tests, and positions the caret at the configured
anchor instead of the top of the surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Thread `verticalAnchor` through the slides text-box wrapper

**Files:**
- Modify: `packages/slides/src/view/editor/text-box-editor.ts:45-89` (options)
- Modify: `packages/slides/src/view/editor/text-box-editor.ts:136-265` (mount body)
- Modify: `packages/slides/src/view/editor/editor.ts` (caller — search for the `mountSlidesTextBox(` call)

- [x] **Step 1: Add option**

In `MountSlidesTextBoxOptions`:

```ts
  /**
   * Vertical anchor of the text element. Forwarded to the docs text-box
   * editor so the in-place editor positions text at the same y as the
   * committed slide canvas. Absent ⇒ top.
   */
  verticalAnchor?: 'top' | 'middle' | 'bottom';
```

- [x] **Step 2: Forward to `initializeTextBox`**

In the `initializeTextBox({...})` payload inside `mountSlidesTextBox`, add `verticalAnchor: opts.verticalAnchor`.

- [x] **Step 3: Pass from the editor caller**

In `packages/slides/src/view/editor/editor.ts`, find the call to `mountSlidesTextBox(`. Pass `verticalAnchor: element.data.verticalAnchor` from the `TextElement` being edited.

- [x] **Step 4: Smoke test edit flow**

Run: `pnpm dev`. Import the Yorkie deck. Double-click slide 1's title to enter edit mode — the text should stay at the bottom of the frame while editing (not jump to the top). Press Escape; the canvas re-render should be visually identical to the editing surface.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/text-box-editor.ts packages/slides/src/view/editor/editor.ts
git commit -m "$(cat <<'EOF'
Pass TextElement.verticalAnchor to in-place editor

Closes the "text snaps to top while editing" UX gap left by the
prior PR. The slides wrapper forwards verticalAnchor to the docs
text-box editor, which applies the same paint/hit-test offset as
the committed slide canvas.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [x] **Step 6: Update the design doc**

Remove the "Known limitations" bullet added in Task 5 step 2 (or convert it to a "Resolved by …" note).

```bash
git add docs/design/slides/slides-themes-layouts-import.md
git commit -m "$(cat <<'EOF'
Close editor parity gap note in import doc

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

- [x] **Spec coverage**: every brainstormed responsibility (parse anchor, store on model, render with offset, editor parity, design doc) has a task above. ✅
- [x] **No placeholders**: every step has either exact code, an exact command, or a manual verification statement. ✅
- [x] **Type consistency**: `verticalAnchor: 'top' | 'middle' | 'bottom'` appears identically in model, importer, slides renderer, docs editor option, and slides wrapper option. `computeVerticalOriginY` has the same signature in the slides renderer and docs editor (duplicated intentionally — separate package, no shared util). ✅

---

## Out of scope (follow-ups)

- Table cell vertical anchor (`<a:tc><a:tcPr anchor>`) — table cells live in `packages/slides/src/model/element.ts` (table type) and renderer at `packages/slides/src/view/canvas/`. Same algorithm applies; separate PR.
- Body inset (`<a:bodyPr tIns/bIns/lIns/rIns>`) — currently dropped; ~0.1" visual effect. Separate PR.
- Editor UI control for changing `verticalAnchor` (Format menu / shape options panel). Today the field is import-preserve-only; users cannot change it via the UI.
- DOCX import equivalent — different format, different scope.
