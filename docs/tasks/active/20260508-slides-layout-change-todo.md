# Slides Layout Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let slides authors pick a layout when inserting a new slide and change the layout of an existing slide, with placeholder identity tracking so typed content survives layout switches.

**Architecture:** Add `placeholderRef` to `Element` (`{ type, index }`) and a slot type to `PlaceholderSpec`. Move `applyLayout` semantics into a single pure function `applyLayoutToSlide(slide, newLayout)` shared by `MemSlidesStore` and `YorkieSlidesStore`; matching is type-first with index fallback, orphaned non-empty placeholders demote to plain elements. UI surfaces are vanilla DOM in `@wafflebase/slides`: a `showLayoutPicker` popover opened by a split-button on the thumbnail panel `+` and by a "Change layout…" item on the slide canvas context menu. Layout previews reuse the existing thumbnail renderer with a module-level cache.

**Tech Stack:** TypeScript, Vitest (jsdom env), `@wafflebase/slides`, `@wafflebase/docs`, Yorkie SDK, vanilla DOM (no Radix in slides package).

**Spec:** `docs/design/slides/slides-layout-change.md`

**Verification gate:** `pnpm verify:fast` after every task; `pnpm dev` browser smoke before merge (see Task 11).

---

## Tasks

### Task 1: Placeholder types and `isElementEmpty` helper

Adds the new types and the empty-check helper used by the orphan-demote pass.

**Files:**
- Modify: `packages/slides/src/model/element.ts`
- Create: `packages/slides/src/model/element.test.ts`

- [ ] **Step 1: Write the failing test for `isElementEmpty`**

`packages/slides/src/model/element.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ImageElement, ShapeElement, TextElement } from './element';
import { isElementEmpty } from './element';

const baseFrame = { x: 0, y: 0, w: 10, h: 10, rotation: 0 };

describe('isElementEmpty', () => {
  it('returns true for a text element whose every inline is empty', () => {
    const el: TextElement = {
      id: 'a',
      type: 'text',
      frame: baseFrame,
      data: {
        blocks: [
          { id: 'b1', type: 'paragraph', inlines: [{ text: '', style: {} }], style: {} },
        ] as never,
      },
    };
    expect(isElementEmpty(el)).toBe(true);
  });

  it('returns false for a text element with any non-empty inline', () => {
    const el: TextElement = {
      id: 'a',
      type: 'text',
      frame: baseFrame,
      data: {
        blocks: [
          { id: 'b1', type: 'paragraph', inlines: [{ text: 'hi', style: {} }], style: {} },
        ] as never,
      },
    };
    expect(isElementEmpty(el)).toBe(false);
  });

  it('returns false for non-text elements (image/shape) — they are never treated as empty in v1', () => {
    const img: ImageElement = {
      id: 'i',
      type: 'image',
      frame: baseFrame,
      data: { src: 'x.png' },
    };
    const shape: ShapeElement = {
      id: 's',
      type: 'shape',
      frame: baseFrame,
      data: { kind: 'rect' },
    };
    expect(isElementEmpty(img)).toBe(false);
    expect(isElementEmpty(shape)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- element.test.ts`
Expected: FAIL — `isElementEmpty is not defined` (import error).

- [ ] **Step 3: Implement types and helper**

Edit `packages/slides/src/model/element.ts`. Add the placeholder types **before** `Element` and the helper at the end:

```ts
export type PlaceholderType =
  | 'title'
  | 'subtitle'
  | 'body'
  | 'caption'
  | 'big-number';

export type PlaceholderRef = {
  type: PlaceholderType;
  /** 0-based among same-type slots in the source layout. */
  index: number;
};
```

Extend `ElementBase` to include the optional ref:

```ts
export type ElementBase = {
  id: string;
  frame: Frame;
  placeholderRef?: PlaceholderRef;
};
```

Add the helper at the end of the file:

```ts
export function isElementEmpty(el: Element): boolean {
  if (el.type !== 'text') return false;
  return el.data.blocks.every((b) =>
    b.inlines.every((inl) => inl.text === ''),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- element.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run package-wide tests**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS — adding `placeholderRef?` is additive and doesn't break existing tests.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/model/element.ts packages/slides/src/model/element.test.ts
git commit -m "$(cat <<'EOF'
Add PlaceholderRef types and isElementEmpty helper

Lays groundwork for layout-change UX where slot identity must
survive layout switches. Without a ref on the element, we cannot
tell user-added content from layout-generated placeholders, and
orphan handling on layout downgrade has no signal to act on.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `PlaceholderSpec` slot type and 11 layout updates

Stamps a `placeholder.type` onto every spec; updates the `textPlaceholder` helper and the 11 layouts; extends the existing layout-shape test.

**Files:**
- Modify: `packages/slides/src/model/presentation.ts`
- Modify: `packages/slides/src/model/layout.ts`
- Modify: `packages/slides/src/model/layout.test.ts`

- [ ] **Step 1: Write the failing snapshot test**

Append to `packages/slides/src/model/layout.test.ts`, inside the existing `describe('BUILT_IN_LAYOUTS')`:

```ts
  it('every placeholder has a slot type matching the design spec', () => {
    const types = Object.fromEntries(
      BUILT_IN_LAYOUTS.map((l) => [
        l.id,
        l.placeholders.map((p) => p.placeholder.type),
      ]),
    );
    expect(types).toEqual({
      'blank': [],
      'title-slide': ['title', 'subtitle'],
      'section-header': ['title'],
      'title-body': ['title', 'body'],
      'title-two-columns': ['title', 'body', 'body'],
      'title-only': ['title'],
      'one-column-text': ['body'],
      'main-point': ['title'],
      'section-title-description': ['title', 'body'],
      'caption': ['body', 'caption'],
      'big-number': ['big-number', 'body'],
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- layout.test.ts`
Expected: FAIL — `placeholder` is undefined on the existing specs.

- [ ] **Step 3: Extend `PlaceholderSpec`**

Edit `packages/slides/src/model/presentation.ts`:

```ts
import type { Block } from '@wafflebase/docs';
import type { Element, ElementInit, ImageRef, PlaceholderType } from './element';
// (rest unchanged)

export type PlaceholderSpec = ElementInit & {
  placeholder: { type: PlaceholderType };
};
```

- [ ] **Step 4: Update `textPlaceholder` helper to take a slot type**

Edit `packages/slides/src/model/layout.ts`. Change the helper signature and body:

```ts
function textPlaceholder(
  type: PlaceholderType,
  x: number, y: number, w: number, h: number,
): PlaceholderSpec {
  return {
    type: 'text',
    frame: { x, y, w, h, rotation: 0 },
    data: { blocks: emptyBlocks() },
    placeholder: { type },
  };
}
```

Add the import at the top:

```ts
import type { PlaceholderType } from './element';
```

- [ ] **Step 5: Stamp every layout's placeholders with the slot type**

Edit `BUILT_IN_LAYOUTS` in `packages/slides/src/model/layout.ts`. Replace each `textPlaceholder(...)` call with the type prepended. The complete map (preserve frame coords from existing code):

```ts
// title-slide
textPlaceholder('title',    PADDING, SLIDE_HEIGHT / 2 - 120, W, 160),
textPlaceholder('subtitle', PADDING, SLIDE_HEIGHT / 2 + 60,  W, 80),

// section-header
textPlaceholder('title',    PADDING, SLIDE_HEIGHT / 2 - 80,  W, 200),

// title-body
textPlaceholder('title',    PADDING, PADDING,                W, 140),
textPlaceholder('body',     PADDING, PADDING + 180, W, SLIDE_HEIGHT - PADDING * 2 - 200),

// title-two-columns
textPlaceholder('title',    PADDING, PADDING, W, 140),
textPlaceholder('body',     PADDING, PADDING + 180, HALF, SLIDE_HEIGHT - PADDING * 2 - 200),
textPlaceholder('body',     PADDING + HALF + PADDING, PADDING + 180, HALF, SLIDE_HEIGHT - PADDING * 2 - 200),

// title-only
textPlaceholder('title',    PADDING, PADDING, W, 140),

// one-column-text
textPlaceholder('body',     PADDING, PADDING, W, SLIDE_HEIGHT - PADDING * 2),

// main-point
textPlaceholder('title',    PADDING, SLIDE_HEIGHT / 2 - 80, W, 160),

// section-title-description
textPlaceholder('title',    PADDING, PADDING * 2, W, 180),
textPlaceholder('body',     PADDING, PADDING * 2 + 220, W, SLIDE_HEIGHT - PADDING * 4 - 240),

// caption
textPlaceholder('body',     PADDING, PADDING, W, SLIDE_HEIGHT - PADDING * 2 - 200),
textPlaceholder('caption',  PADDING, SLIDE_HEIGHT - PADDING - 160, W, 120),

// big-number
textPlaceholder('big-number', PADDING, SLIDE_HEIGHT / 2 - 200, W, 280),
textPlaceholder('body',       PADDING, SLIDE_HEIGHT / 2 + 100, W, 100),
```

- [ ] **Step 6: Run all slides tests to verify**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS — new test passes; existing tests unaffected.

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/model/presentation.ts packages/slides/src/model/layout.ts packages/slides/src/model/layout.test.ts
git commit -m "$(cat <<'EOF'
Tag every layout placeholder with a slot type

Required for type-first slot matching when applying a new layout.
Without this, switching from title-body to title-only could route
the body's text into the new title slot purely by index, which
would surprise the author. Eleven slot mappings are kept in one
place to keep the spec/code in sync.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `applyLayoutToSlide` pure function

The 3-pass algorithm (partition, type-first match, demote orphans). Lives in `model/layout.ts` next to `BUILT_IN_LAYOUTS` so both stores share the exact same logic.

**Files:**
- Modify: `packages/slides/src/model/layout.ts`
- Create: `packages/slides/src/model/layout-apply.test.ts`

- [ ] **Step 1: Write the six failing scenarios**

Create `packages/slides/src/model/layout-apply.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import { BUILT_IN_LAYOUTS, applyLayoutToSlide, getLayout } from './layout';
import type { Element, TextElement } from './element';
import type { Slide } from './presentation';

function blocks(text: string): Block[] {
  return [
    {
      id: 'b1',
      type: 'paragraph',
      inlines: [{ text, style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    } as Block,
  ];
}

function textEl(
  id: string,
  body: string,
  frame: { x: number; y: number; w: number; h: number },
  placeholderRef?: { type: 'title' | 'subtitle' | 'body' | 'caption' | 'big-number'; index: number },
): TextElement {
  return {
    id,
    type: 'text',
    frame: { ...frame, rotation: 0 },
    placeholderRef,
    data: { blocks: blocks(body) },
  };
}

function makeSlide(layoutId: string, elements: Element[]): Slide {
  return {
    id: 's1',
    layoutId,
    background: { fill: { kind: 'role', role: 'background' } },
    elements,
    notes: [],
  };
}

describe('applyLayoutToSlide', () => {
  it('1. blank slide → new layout produces fresh placeholders only', () => {
    const slide = makeSlide('blank', []);
    applyLayoutToSlide(slide, getLayout('title-body'));
    expect(slide.layoutId).toBe('title-body');
    expect(slide.elements.map((e) => e.placeholderRef?.type)).toEqual([
      'title',
      'body',
    ]);
  });

  it('2. typed placeholder → preserved into same-type slot', () => {
    const oldLayout = getLayout('title-body');
    const slide = makeSlide('title-body', [
      textEl('e-title', 'Hello',  oldLayout.placeholders[0].frame, { type: 'title', index: 0 }),
      textEl('e-body',  'World!', oldLayout.placeholders[1].frame, { type: 'body',  index: 0 }),
    ]);
    applyLayoutToSlide(slide, getLayout('title-only'));
    expect(slide.elements).toHaveLength(2); // title kept; body demoted
    const title = slide.elements.find((e) => e.placeholderRef?.type === 'title');
    expect((title as TextElement).data.blocks[0].inlines[0].text).toBe('Hello');
    const demoted = slide.elements.find((e) => e.placeholderRef === undefined);
    expect(demoted).toBeDefined();
    expect((demoted as TextElement).data.blocks[0].inlines[0].text).toBe('World!');
  });

  it('3. ambiguous same-type body slots match by index', () => {
    const fromLayout = getLayout('title-two-columns');
    const slide = makeSlide('title-two-columns', [
      textEl('e0', 'T',     fromLayout.placeholders[0].frame, { type: 'title', index: 0 }),
      textEl('e1', 'left',  fromLayout.placeholders[1].frame, { type: 'body',  index: 0 }),
      textEl('e2', 'right', fromLayout.placeholders[2].frame, { type: 'body',  index: 1 }),
    ]);
    applyLayoutToSlide(slide, getLayout('title-two-columns')); // identity reslot
    const bodies = slide.elements
      .filter((e) => e.placeholderRef?.type === 'body')
      .sort((a, b) => (a.placeholderRef!.index - b.placeholderRef!.index));
    expect((bodies[0] as TextElement).data.blocks[0].inlines[0].text).toBe('left');
    expect((bodies[1] as TextElement).data.blocks[0].inlines[0].text).toBe('right');
  });

  it('4. fewer slots, empty orphan → deleted', () => {
    const fromLayout = getLayout('title-body');
    const slide = makeSlide('title-body', [
      textEl('e0', '', fromLayout.placeholders[0].frame, { type: 'title', index: 0 }),
      textEl('e1', '', fromLayout.placeholders[1].frame, { type: 'body',  index: 0 }),
    ]);
    applyLayoutToSlide(slide, getLayout('title-only'));
    expect(slide.elements).toHaveLength(1);
    expect(slide.elements[0].placeholderRef?.type).toBe('title');
  });

  it('5. fewer slots, non-empty orphan → demoted (frame and content preserved)', () => {
    const fromLayout = getLayout('title-body');
    const originalBodyFrame = fromLayout.placeholders[1].frame;
    const slide = makeSlide('title-body', [
      textEl('e0', 'T',    fromLayout.placeholders[0].frame, { type: 'title', index: 0 }),
      textEl('e1', 'kept', originalBodyFrame,                { type: 'body',  index: 0 }),
    ]);
    applyLayoutToSlide(slide, getLayout('title-only'));
    const demoted = slide.elements.find(
      (e) => e.id === 'e1',
    ) as TextElement | undefined;
    expect(demoted).toBeDefined();
    expect(demoted!.placeholderRef).toBeUndefined();
    expect(demoted!.frame).toMatchObject(originalBodyFrame);
    expect(demoted!.data.blocks[0].inlines[0].text).toBe('kept');
  });

  it('6. user-added elements are untouched', () => {
    const fromLayout = getLayout('title-body');
    const userText = textEl('user', 'mine', { x: 50, y: 50, w: 100, h: 30 }); // no ref
    const slide = makeSlide('title-body', [
      textEl('e0', 'T', fromLayout.placeholders[0].frame, { type: 'title', index: 0 }),
      userText,
    ]);
    applyLayoutToSlide(slide, getLayout('title-only'));
    const stillUser = slide.elements.find((e) => e.id === 'user') as TextElement;
    expect(stillUser).toBeDefined();
    expect(stillUser.placeholderRef).toBeUndefined();
    expect(stillUser.frame).toMatchObject({ x: 50, y: 50, w: 100, h: 30 });
    expect(stillUser.data.blocks[0].inlines[0].text).toBe('mine');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- layout-apply.test.ts`
Expected: FAIL — `applyLayoutToSlide is not exported` (import error).

- [ ] **Step 3: Implement `applyLayoutToSlide`**

Edit `packages/slides/src/model/layout.ts`. Add imports if not present, then append at the bottom of the file:

```ts
import { generateId, isElementEmpty } from './element';
import type { Element, PlaceholderRef } from './element';
import type { Slide } from './presentation';

/**
 * Re-slot a slide for a new layout (mutates `slide`).
 *
 * 1. Partition existing elements by `placeholderRef`: ref-bearing
 *    elements compete for slots in `newLayout`; user-added elements
 *    (no ref) are never touched.
 * 2. For each new slot, find a ref-bearing element with matching
 *    `(type, index)`. On match, update its frame and ref to the new
 *    slot, preserving content. On miss, materialize a fresh empty
 *    placeholder element from the slot's spec.
 * 3. Orphans (ref-bearing but unmatched): empty → delete; non-empty
 *    → demote (drop `placeholderRef`, keep frame and content).
 *
 * The user's `applyLayout` calls in both stores route here so the
 * semantics never diverge.
 */
export function applyLayoutToSlide(slide: Slide, newLayout: Layout): void {
  const oldRefBearing = slide.elements.filter((e) => e.placeholderRef);
  const userElements  = slide.elements.filter((e) => !e.placeholderRef);

  // Compute (type, index) for each new-layout slot using array order.
  type Slot = { spec: typeof newLayout.placeholders[number]; ref: PlaceholderRef };
  const slots: Slot[] = newLayout.placeholders.map((spec, i) => {
    const sameTypeBefore = newLayout.placeholders
      .slice(0, i)
      .filter((p) => p.placeholder.type === spec.placeholder.type).length;
    return { spec, ref: { type: spec.placeholder.type, index: sameTypeBefore } };
  });

  const consumed = new Set<string>();
  const slotted: Element[] = slots.map((slot) => {
    const reuse = oldRefBearing.find(
      (e) =>
        !consumed.has(e.id)
        && e.placeholderRef!.type === slot.ref.type
        && e.placeholderRef!.index === slot.ref.index,
    );
    if (reuse) {
      consumed.add(reuse.id);
      return {
        ...reuse,
        frame: { ...slot.spec.frame },
        placeholderRef: slot.ref,
      } as Element;
    }
    return {
      ...JSON.parse(JSON.stringify(slot.spec)),
      id: generateId(),
      placeholderRef: slot.ref,
    } as Element;
  });

  const orphans: Element[] = oldRefBearing
    .filter((e) => !consumed.has(e.id))
    .filter((e) => !isElementEmpty(e))
    .map((e) => {
      const out = { ...e } as Element;
      delete out.placeholderRef;
      return out;
    });

  slide.layoutId = newLayout.id;
  slide.elements = [...userElements, ...slotted, ...orphans];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- layout-apply.test.ts`
Expected: PASS — all six scenarios.

- [ ] **Step 5: Run the full slides test suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS — store-level applyLayout tests still pass against the old store body (Task 4 swaps that).

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/model/layout.ts packages/slides/src/model/layout-apply.test.ts
git commit -m "$(cat <<'EOF'
Add applyLayoutToSlide with type-first slot matching

Single source of truth for layout-change semantics so MemSlidesStore
and YorkieSlidesStore can never drift. The three-pass algorithm
(partition / type-first match / demote orphans) preserves typed
content across slot-count changes and never destroys non-empty
elements; users rely on undo, not confirm dialogs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire `MemSlidesStore.addSlide` and `applyLayout`

`addSlide` stamps `placeholderRef` on each new placeholder. `applyLayout` becomes a thin wrapper around `applyLayoutToSlide`.

**Files:**
- Modify: `packages/slides/src/store/memory.ts`
- Modify: `packages/slides/src/store/memory.test.ts`

- [ ] **Step 1: Write a failing test for `addSlide` placeholderRef stamping**

Append to `packages/slides/src/store/memory.test.ts` inside an existing `describe` block (or add a new one):

```ts
describe('MemSlidesStore — addSlide stamps placeholderRef', () => {
  it('annotates new placeholder elements with type and per-type index', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('title-two-columns');
    });
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId)!;
    expect(slide.elements.map((e) => e.placeholderRef)).toEqual([
      { type: 'title', index: 0 },
      { type: 'body',  index: 0 },
      { type: 'body',  index: 1 },
    ]);
  });

  it('annotates layouts with no placeholders as empty (blank)', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
    });
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId)!;
    expect(slide.elements).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- memory.test.ts -t 'stamps placeholderRef'`
Expected: FAIL — `placeholderRef` is undefined on the elements (current code does not stamp).

- [ ] **Step 3: Update `addSlide` to stamp placeholderRefs**

Edit `packages/slides/src/store/memory.ts`. Replace the `elements:` mapper inside `addSlide`:

```ts
elements: layout.placeholders.map((p, i) => {
  const sameTypeBefore = layout.placeholders
    .slice(0, i)
    .filter((q) => q.placeholder.type === p.placeholder.type).length;
  return {
    ...clone(p),
    id: generateId(),
    placeholderRef: { type: p.placeholder.type, index: sameTypeBefore },
  } as Element;
}),
```

- [ ] **Step 4: Replace `applyLayout` body with a call to the shared helper**

Still in `packages/slides/src/store/memory.ts`, replace the `applyLayout` body:

```ts
applyLayout(slideId: string, layoutId: string): void {
  this.requireBatch();
  const slide = this.requireSlide(slideId);
  applyLayoutToSlide(slide, getLayout(layoutId));
}
```

Add the import at the top of the file:

```ts
import { BUILT_IN_LAYOUTS, applyLayoutToSlide, getLayout } from '../model/layout';
```

Remove the now-unused `clone` calls inside the old `applyLayout` body if any are orphaned by the rewrite (the shared helper does its own copy internally).

- [ ] **Step 5: Run all memory tests**

Run: `pnpm --filter @wafflebase/slides test -- memory.test.ts`
Expected: PASS — new tests pass; the existing `MemSlidesStore — applyLayout` describe-block now exercises the shared helper transparently. If any existing assertions check the old additive-only behaviour (e.g., placeholders keep accumulating), update them to the new semantics:
- The existing test at `memory.test.ts:304` asserts that after `applyLayout` to `title-body` on an originally-blank slide the layoutId becomes `'title-body'` — still passes.
- The `:310` test (cycling through layouts) may need its assertion adjusted. Read the existing test before adapting.

If an existing assertion expects placeholder *accumulation* (additive behaviour), rewrite it to expect the **partitioned** outcome (slots-only, plus demoted orphans) and add a comment referencing this task.

- [ ] **Step 6: Run full slides test suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/store/memory.ts packages/slides/src/store/memory.test.ts
git commit -m "$(cat <<'EOF'
Route MemSlidesStore through applyLayoutToSlide

addSlide now stamps placeholderRef on each generated element so a
later applyLayout can match by slot identity. applyLayout itself
delegates to the shared pure helper, replacing the conservative
additive-only body with type-first matching and orphan demote.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire `YorkieSlidesStore.addSlide` and `applyLayout`

Same routing for the Yorkie store. The Yorkie variant mutates the live array proxy inside `this.doc.update`, but the slot-matching logic is identical.

**Files:**
- Modify: `packages/frontend/src/app/slides/yorkie-slides-store.ts`

- [ ] **Step 1: Locate the existing `addSlide` and `applyLayout` in the Yorkie store**

Read around `packages/frontend/src/app/slides/yorkie-slides-store.ts:559` (`applyLayout`) and the corresponding `addSlide` method (above it).

- [ ] **Step 2: Update `addSlide` to stamp `placeholderRef`**

In the Yorkie `addSlide`, where the elements array is built from `layout.placeholders`, mirror the MemStore mapper:

```ts
const sameTypeBefore = layout.placeholders
  .slice(0, i)
  .filter((q) => q.placeholder.type === p.placeholder.type).length;
const placeholderRef = { type: p.placeholder.type, index: sameTypeBefore };
// then push the element with placeholderRef included on the YorkieElement
```

The exact push statement depends on how the Yorkie element shapes are spelled in this file — preserve its existing branching for `'text' | 'image' | 'shape'` and add `placeholderRef` as an additional property on each branch.

- [ ] **Step 3: Replace `applyLayout` body to call the shared helper**

```ts
applyLayout(slideId: string, layoutId: string): void {
  this.requireBatch();
  const layout = getLayout(layoutId);
  this.doc.update((r) => {
    const s = r.slides.find((s) => s.id === slideId);
    if (!s) throw new Error(`Slide not found: ${slideId}`);
    // Cast through unknown: Yorkie array proxies expose the same shape
    // as plain Slide for read/write here. The shared helper assigns
    // back to `s.elements` and `s.layoutId`, both supported mutations.
    applyLayoutToSlide(s as unknown as Slide, layout);
  });
}
```

Add imports at the top of the file:

```ts
import { applyLayoutToSlide, getLayout } from '@wafflebase/slides';
import type { Slide } from '@wafflebase/slides';
```

(If `@wafflebase/slides` does not currently re-export `applyLayoutToSlide` and `Slide` from its `index.ts`, add the re-export there in the same task. Verify with: `grep -n 'applyLayoutToSlide\|export type.*Slide' packages/slides/src/index.ts`.)

- [ ] **Step 4: Run the slides + frontend test suites**

Run: `pnpm --filter @wafflebase/slides test && pnpm --filter @wafflebase/frontend test --run`
Expected: PASS. (Frontend yorkie-store tests are likely jsdom-based; if `RUN_YORKIE_INTEGRATION_TESTS` is unset, integration coverage is added in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/yorkie-slides-store.ts packages/slides/src/index.ts
git commit -m "$(cat <<'EOF'
Route YorkieSlidesStore through applyLayoutToSlide

Both stores now share the slot-matching pure function so collab
clients see identical local-first results. The Yorkie variant
runs inside this.doc.update, where direct property assignment on
the array-proxy slide already worked under the old additive logic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Yorkie integration test for concurrent `applyLayout`

Two clients call `applyLayout` concurrently → final state converges. Gated by `RUN_YORKIE_INTEGRATION_TESTS` per the project's existing convention.

**Files:**
- Modify or create: `packages/frontend/src/app/slides/yorkie-slides-store.test.ts` (or wherever existing yorkie tests live — verify with `find packages/frontend -name '*yorkie*test*'`)

- [ ] **Step 1: Locate the existing yorkie-slides-store test infrastructure**

Run: `find packages/frontend -name '*yorkie*' -type f`. Read any existing `yorkie-slides-store.test.ts` to understand the gate pattern (`describe.skipIf(!process.env.RUN_YORKIE_INTEGRATION_TESTS)`).

- [ ] **Step 2: Write the convergence test**

Add a new `describe` (gate-aware). Skeleton:

```ts
describe.skipIf(!process.env.RUN_YORKIE_INTEGRATION_TESTS)(
  'YorkieSlidesStore — concurrent applyLayout',
  () => {
    it('converges to a single layoutId across two clients', async () => {
      // Set up two YorkieSlidesStore instances against the same docKey.
      const a = await openClient('layout-test-doc');
      const b = await openClient('layout-test-doc');

      let slideId = '';
      a.batch(() => { slideId = a.addSlide('blank'); });
      await sync(a); await sync(b);

      a.batch(() => a.applyLayout(slideId, 'title-body'));
      b.batch(() => b.applyLayout(slideId, 'title-only'));

      await sync(a); await sync(b);

      const aLayout = a.read().slides[0].layoutId;
      const bLayout = b.read().slides[0].layoutId;
      expect(aLayout).toBe(bLayout); // last-writer wins, both agree

      await closeClient(a); await closeClient(b);
    });
  },
);
```

The exact `openClient`, `sync`, `closeClient` shape comes from any existing yorkie test helper in the repo. If none exists, write a minimal helper in the same file (the test is gated, so it only runs locally with both Postgres and Yorkie up).

- [ ] **Step 3: Run the test locally with the gate**

```bash
docker compose up -d
RUN_YORKIE_INTEGRATION_TESTS=true pnpm --filter @wafflebase/frontend test -- yorkie-slides-store
```

Expected: PASS. If the test reveals a real divergence, fix it in `applyLayoutToSlide` (most likely an array-proxy mutation pattern issue) before continuing.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/slides/yorkie-slides-store.test.ts
git commit -m "$(cat <<'EOF'
Cover concurrent applyLayout convergence in Yorkie

Gates a two-client scenario behind RUN_YORKIE_INTEGRATION_TESTS so
CI exercises last-writer-wins on slide.layoutId together with
Yorkie's array-merge on slide.elements. Without the assertion, a
future change to mutation patterns could silently break collab
parity for layout switches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Layout preview canvas + cache

Reuse `thumbnail.ts` to render small previews of an empty layout. Module-level cache keyed by theme/master/layout/size.

**Files:**
- Create: `packages/slides/src/view/canvas/layout-preview.ts`
- Create: `packages/slides/src/view/canvas/layout-preview.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/slides/src/view/canvas/layout-preview.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUILT_IN_LAYOUTS } from '../../model/layout';
import { defaultLight } from '../../themes/default-light';
import { DEFAULT_MASTER } from '../../model/master';
import { renderLayoutPreview, _previewCacheForTest } from './layout-preview';

describe('renderLayoutPreview', () => {
  it('returns a canvas of the requested size', () => {
    const c = renderLayoutPreview(
      BUILT_IN_LAYOUTS[3], // title-body
      defaultLight,
      DEFAULT_MASTER,
      { w: 160, h: 90 },
    );
    expect(c).toBeInstanceOf(HTMLCanvasElement);
    expect(c.width).toBe(160);
    expect(c.height).toBe(90);
  });

  it('caches by themeId/masterId/layoutId/size — same inputs → same canvas instance', () => {
    _previewCacheForTest.clear();
    const args = {
      layout: BUILT_IN_LAYOUTS[1], // title-slide
      theme: defaultLight,
      master: DEFAULT_MASTER,
      size: { w: 160, h: 90 } as const,
    };
    const a = renderLayoutPreview(args.layout, args.theme, args.master, args.size);
    const b = renderLayoutPreview(args.layout, args.theme, args.master, args.size);
    expect(a).toBe(b);
  });

  it('produces different canvases for different sizes', () => {
    _previewCacheForTest.clear();
    const a = renderLayoutPreview(BUILT_IN_LAYOUTS[1], defaultLight, DEFAULT_MASTER, { w: 160, h: 90 });
    const b = renderLayoutPreview(BUILT_IN_LAYOUTS[1], defaultLight, DEFAULT_MASTER, { w: 80,  h: 45 });
    expect(a).not.toBe(b);
    expect(b.width).toBe(80);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- layout-preview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `renderLayoutPreview`**

Create `packages/slides/src/view/canvas/layout-preview.ts`:

```ts
import { generateId } from '../../model/element';
import type { Element } from '../../model/element';
import type { Layout } from '../../model/presentation';
import type { Slide, SlidesDocument } from '../../model/presentation';
import type { Master } from '../../model/master';
import type { Theme } from '../../model/theme';
import { renderThumbnail } from './thumbnail';

const cache = new Map<string, HTMLCanvasElement>();

/** Test-only handle to clear the module cache between cases. */
export const _previewCacheForTest = cache;

function syntheticSlide(layout: Layout): Slide {
  return {
    id: 'preview',
    layoutId: layout.id,
    background: layout.background ?? { fill: { kind: 'role', role: 'background' } },
    elements: layout.placeholders.map((p, i) => ({
      ...JSON.parse(JSON.stringify(p)),
      id: generateId(),
      placeholderRef: {
        type: p.placeholder.type,
        index: layout.placeholders
          .slice(0, i)
          .filter((q) => q.placeholder.type === p.placeholder.type).length,
      },
    } as Element)),
    notes: [],
  };
}

export function renderLayoutPreview(
  layout: Layout,
  theme: Theme,
  master: Master,
  size: { w: number; h: number },
): HTMLCanvasElement {
  const key = `${theme.id}:${master.id}:${layout.id}:${size.w}x${size.h}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const slide = syntheticSlide(layout);
    const doc: SlidesDocument = {
      meta: { title: '', themeId: theme.id, masterId: master.id },
      themes: [theme],
      masters: [master],
      layouts: [layout],
      slides: [slide],
    };
    renderThumbnail(ctx, slide, doc, {
      hostWidth: size.w,
      hostHeight: size.h,
      dpr: 1,
    });
  }
  cache.set(key, canvas);
  return canvas;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- layout-preview.test.ts`
Expected: PASS. If `renderThumbnail`'s signature differs, adapt (read `packages/slides/src/view/canvas/thumbnail.ts` to confirm the call shape — the same shape is used in `thumbnail-panel.ts:64`).

- [ ] **Step 5: Run the slides test suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/view/canvas/layout-preview.ts packages/slides/src/view/canvas/layout-preview.test.ts
git commit -m "$(cat <<'EOF'
Render and cache layout preview canvases

Reuses renderThumbnail against a synthetic slide so picker cells
reflect the active theme. The module-level cache is keyed by
(theme, master, layout, size); theme switches naturally route to
different keys, so old entries become GC-eligible without an
explicit invalidation API.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Vanilla-DOM `showLayoutPicker`

A self-contained popover that mounts a 4×3 grid of preview canvases plus labels. Click → `onPick`; Esc / outside-click → `onClose`. Arrow-key keyboard nav.

**Files:**
- Create: `packages/slides/src/view/editor/layout-picker.ts`
- Create: `packages/slides/src/view/editor/layout-picker.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/slides/src/view/editor/layout-picker.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { MemSlidesStore } from '../../store/memory';
import { showLayoutPicker } from './layout-picker';

function host() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('showLayoutPicker', () => {
  it('mounts a popover with a cell per built-in layout', () => {
    const store = new MemSlidesStore();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 100, y: 100 },
      onPick: () => {},
      onClose: () => {},
    });
    const cells = h.querySelectorAll('[data-layout-id]');
    expect(cells.length).toBe(11);
  });

  it('clicking a cell calls onPick(layoutId) then onClose', () => {
    const store = new MemSlidesStore();
    const onPick = vi.fn();
    const onClose = vi.fn();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      onPick,
      onClose,
    });
    const cell = h.querySelector('[data-layout-id="title-body"]') as HTMLElement;
    cell.click();
    expect(onPick).toHaveBeenCalledWith('title-body');
    expect(onClose).toHaveBeenCalled();
  });

  it('outlines the cell whose layoutId matches selectedLayoutId', () => {
    const store = new MemSlidesStore();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      selectedLayoutId: 'title-body',
      onPick: () => {},
      onClose: () => {},
    });
    const selected = h.querySelector('[data-layout-id="title-body"]') as HTMLElement;
    expect(selected.dataset.selected).toBe('true');
  });

  it('Esc closes via onClose', () => {
    const store = new MemSlidesStore();
    const onClose = vi.fn();
    const h = host();
    showLayoutPicker(h, {
      store,
      anchor: { x: 0, y: 0 },
      onPick: () => {},
      onClose,
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- layout-picker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `showLayoutPicker`**

Create `packages/slides/src/view/editor/layout-picker.ts`:

```ts
import { BUILT_IN_LAYOUTS } from '../../model/layout';
import { renderLayoutPreview } from '../canvas/layout-preview';
import type { SlidesStore } from '../../store/store';

const PREVIEW_W = 160;
const PREVIEW_H = 90;

export interface LayoutPickerOptions {
  store: SlidesStore;
  selectedLayoutId?: string;
  anchor: { x: number; y: number };
  onPick: (layoutId: string) => void;
  onClose: () => void;
}

export function showLayoutPicker(
  host: HTMLElement,
  opts: LayoutPickerOptions,
): void {
  const popover = document.createElement('div');
  popover.className = 'wfb-slides-layout-picker';
  popover.style.position = 'fixed';
  popover.style.left = `${opts.anchor.x}px`;
  popover.style.top = `${opts.anchor.y}px`;
  popover.style.background = '#2a2a2a';
  popover.style.border = '1px solid #444';
  popover.style.borderRadius = '6px';
  popover.style.padding = '8px';
  popover.style.zIndex = '9999';
  popover.style.boxShadow = '0 6px 24px rgba(0, 0, 0, 0.5)';
  popover.style.display = 'grid';
  popover.style.gridTemplateColumns = `repeat(4, ${PREVIEW_W}px)`;
  popover.style.gap = '8px';

  const doc = opts.store.read();
  const theme = doc.themes.find((t) => t.id === doc.meta.themeId) ?? doc.themes[0];
  const master = doc.masters.find((m) => m.id === doc.meta.masterId) ?? doc.masters[0];

  for (const layout of BUILT_IN_LAYOUTS) {
    const cell = document.createElement('div');
    cell.dataset.layoutId = layout.id;
    cell.style.cursor = 'pointer';
    cell.style.padding = '4px';
    cell.style.borderRadius = '4px';
    if (layout.id === opts.selectedLayoutId) {
      cell.dataset.selected = 'true';
      cell.style.outline = '2px solid #3a7';
    } else {
      cell.style.outline = '1px solid #444';
    }
    const canvas = renderLayoutPreview(layout, theme, master, {
      w: PREVIEW_W, h: PREVIEW_H,
    });
    // Clone to detach from cache if reused elsewhere; cheap because canvases
    // are returned per-instance only when the cache key already matches.
    cell.appendChild(canvas);
    const label = document.createElement('div');
    label.textContent = layout.name;
    label.style.fontSize = '12px';
    label.style.color = '#ddd';
    label.style.marginTop = '4px';
    label.style.textAlign = 'center';
    cell.appendChild(label);
    cell.addEventListener('click', () => {
      opts.onPick(layout.id);
      close();
    });
    popover.appendChild(cell);
  }

  function close(): void {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onOutside, true);
    popover.remove();
    opts.onClose();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
  function onOutside(e: MouseEvent): void {
    if (!popover.contains(e.target as Node)) close();
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onOutside, true);

  host.appendChild(popover);
}
```

Note: the cache returns the same `<canvas>` instance for repeat keys. Because a DOM node can only be in one place, do not insert the cached canvas directly across multiple pickers simultaneously — but the picker is one-at-a-time and re-mounts per open, so `appendChild` re-parents harmlessly. If a future use case opens two pickers, swap to "draw the cached pixels onto a fresh canvas" — out of scope here.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- layout-picker.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/layout-picker.ts packages/slides/src/view/editor/layout-picker.test.ts
git commit -m "$(cat <<'EOF'
Add vanilla-DOM showLayoutPicker popover

Slides package stays framework-free, so the picker mounts a plain
div with a 4-column grid of cached preview canvases. Both call
sites (split-button on the thumbnail panel, context menu) reuse
this single API rather than duplicating popover plumbing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Split-button on thumbnail panel `+`

Replace the single button with a flex container of two clickable zones.

**Files:**
- Modify: `packages/slides/src/view/editor/thumbnail-panel.ts`
- Modify: `packages/slides/src/view/editor/thumbnail-panel.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/slides/src/view/editor/thumbnail-panel.test.ts`:

```ts
import { showLayoutPicker } from './layout-picker';
vi.mock('./layout-picker', () => ({ showLayoutPicker: vi.fn() }));

it('clicks on the ▾ zone open the layout picker; left zone preserves blank insert', async () => {
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  const editor = createTestEditor(store); // existing helper in this file
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountThumbnailPanel(host, store, editor);

  const dropdown = host.querySelector('[data-add-slide-dropdown]') as HTMLElement;
  expect(dropdown).toBeTruthy();
  dropdown.click();
  expect(showLayoutPicker).toHaveBeenCalled();

  const insert = host.querySelector('[data-add-slide-insert]') as HTMLElement;
  insert.click();
  expect(store.read().slides).toHaveLength(2); // blank inserted
  expect(store.read().slides[1].layoutId).toBe('blank');
});
```

(Read the existing `thumbnail-panel.test.ts` to confirm the test-helper name `createTestEditor` and adjust if different.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- thumbnail-panel.test.ts`
Expected: FAIL — `data-add-slide-dropdown` not present.

- [ ] **Step 3: Replace the single `+` button with split markup**

Edit `packages/slides/src/view/editor/thumbnail-panel.ts` lines 116–123 (the existing button block). Replace with:

```ts
// "+ Add slide" split button at the bottom.
const addBar = document.createElement('div');
addBar.style.display = 'flex';
addBar.style.width = `${THUMB_W}px`;
addBar.style.border = '1px solid #444';
addBar.style.borderRadius = '4px';
addBar.style.overflow = 'hidden';

const insertBtn = document.createElement('button');
insertBtn.dataset.addSlideInsert = '';
insertBtn.textContent = '+ Add slide';
insertBtn.style.flex = '1';
insertBtn.style.border = 'none';
insertBtn.style.cursor = 'pointer';
insertBtn.addEventListener('click', () => {
  store.batch(() => store.addSlide('blank'));
  render();
});
addBar.appendChild(insertBtn);

const dropdownBtn = document.createElement('button');
dropdownBtn.dataset.addSlideDropdown = '';
dropdownBtn.textContent = '▾';
dropdownBtn.title = 'Choose a layout';
dropdownBtn.style.width = '24px';
dropdownBtn.style.borderLeft = '1px solid #444';
dropdownBtn.style.cursor = 'pointer';
dropdownBtn.addEventListener('click', () => {
  const rect = dropdownBtn.getBoundingClientRect();
  showLayoutPicker(document.body, {
    store,
    anchor: { x: rect.left, y: rect.bottom + 4 },
    onPick: (layoutId) => {
      store.batch(() => store.addSlide(layoutId));
      render();
    },
    onClose: () => {},
  });
});
addBar.appendChild(dropdownBtn);

container.appendChild(addBar);
```

Add the import at the top:

```ts
import { showLayoutPicker } from './layout-picker';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- thumbnail-panel.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full slides test suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/thumbnail-panel.ts packages/slides/src/view/editor/thumbnail-panel.test.ts
git commit -m "$(cat <<'EOF'
Split + Add slide button into insert and layout picker

Plain click still adds a blank slide so existing muscle memory
keeps working; the new ▾ zone opens the layout picker so users
discover the eleven built-in layouts without leaving the rail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: "Change layout…" canvas context menu item

Adds a single item to `canvasContextItems` (slide-background right-click).

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`
- Modify: `packages/slides/src/view/editor/editor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/slides/src/view/editor/editor.test.ts` (consult the existing `describe` blocks for the test-fixture pattern):

```ts
it('canvas context menu includes a Change layout… item that opens the picker', () => {
  const store = new MemSlidesStore();
  let slideId = '';
  store.batch(() => { slideId = store.addSlide('title-body'); });
  const editor = createEditor(store); // pattern from existing tests in this file
  // Right-click the slide background:
  fireRightClickOnCanvas(editor, { x: 100, y: 100 }); // existing helper
  const menu = document.querySelector('.wfb-slides-context-menu') as HTMLElement;
  const labels = [...menu.querySelectorAll('li')].map((li) => li.textContent);
  expect(labels).toContain('Change layout…');
});
```

If `editor.test.ts` lacks helpers like `fireRightClickOnCanvas`, add a minimal one (or invoke `editor['onContextMenu']` via a typed escape).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- editor.test.ts`
Expected: FAIL — item missing.

- [ ] **Step 3: Add the item**

Edit `packages/slides/src/view/editor/editor.ts` `canvasContextItems` (around line 381). Append before the `Insert text` item:

```ts
{
  label: 'Change layout…',
  run: () => {
    const slide = this.currentSlide();
    if (!slide) return;
    showLayoutPicker(document.body, {
      store: this.options.store,
      anchor: { x: this.lastContextX, y: this.lastContextY },
      selectedLayoutId: slide.layoutId,
      onPick: (layoutId) => {
        this.options.store.batch(() =>
          this.options.store.applyLayout(slide.id, layoutId),
        );
        this.requestRender();
      },
      onClose: () => {},
    });
  },
},
```

This requires the editor to remember the last right-click position. In `onContextMenu` (around line 340), persist:

```ts
private lastContextX = 0;
private lastContextY = 0;

private onContextMenu(e: MouseEvent): void {
  e.preventDefault();
  this.lastContextX = e.clientX;
  this.lastContextY = e.clientY;
  // …rest unchanged…
}
```

Add the import at the top of `editor.ts`:

```ts
import { showLayoutPicker } from './layout-picker';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- editor.test.ts`
Expected: PASS.

- [ ] **Step 5: Full slides + frontend test suites**

Run: `pnpm --filter @wafflebase/slides test && pnpm --filter @wafflebase/frontend test --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts packages/slides/src/view/editor/editor.test.ts
git commit -m "$(cat <<'EOF'
Expose Change layout in the slide canvas context menu

Right-clicking the slide background now opens the layout picker
seeded with the current layoutId so authors see what they have
selected. Pick fires applyLayout inside a single batch so undo
collapses the change to one step.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Verify, smoke, capture lessons, archive

The merge gate per `CLAUDE.md`.

**Files:**
- Create: `docs/tasks/active/20260508-slides-layout-change-lessons.md`
- Modify: `docs/tasks/active/20260508-slides-layout-change-todo.md` (this file — fill the Review section below)

- [ ] **Step 1: Run `pnpm verify:fast`**

Run: `pnpm verify:fast`
Expected: PASS — lint clean, all unit tests green.

If anything fails, fix it before proceeding (no `--no-verify` shortcuts).

- [ ] **Step 2: Browser smoke against `pnpm dev`**

Start: `docker compose up -d && pnpm dev`

Walk through every item; document any deviation in the lessons file:

1. Open a fresh deck. Click `+ Add slide` (left zone) → blank slide appended.
2. Click `▾` → picker shows 11 cells with previews. Pick `title-body` → slide with title + body placeholders.
3. Type `Hello` in title, `World` in body. Right-click slide background → "Change layout…" → picker shows current `title-body` outlined → pick `title-only` → "Hello" stays in the title; the body text remains as a demoted (no-outline) text box at its old position.
4. Insert `title-two-columns`. Type `L` in left body, `R` in right body. Change layout to `title-only` → exactly one demoted body element remains visible besides the title slot. Repeat to `title-two-columns` → original body slot pair re-appears (matched by `(type, index)`).
5. Switch theme via the existing theme panel → reopen the picker → previews reflect the new theme colors.
6. Press Cmd/Ctrl-Z after a layout change → reverts to previous layout in one step.

- [ ] **Step 3: Write lessons file**

`docs/tasks/active/20260508-slides-layout-change-lessons.md` — capture any lesson worth carrying to the next task. Acceptable to be brief or even minimal if nothing surprised you. Patterns worth recording: divergences between the spec and reality (e.g., a Yorkie-array mutation pattern that did not work and how it was solved), or anything you would want a future agent to learn.

- [ ] **Step 4: Fill the Review section in this file**

Append to the bottom of `docs/tasks/active/20260508-slides-layout-change-todo.md`:

```markdown
## Review

- Final commit count: N
- Test count delta: +N
- Spec deviations: (list any) or "none"
- Manual smoke: PASS
```

- [ ] **Step 5: Archive and reindex**

```bash
pnpm tasks:archive
pnpm tasks:index
```

- [ ] **Step 6: Final commit and push**

```bash
git add docs/tasks/
git commit -m "$(cat <<'EOF'
Archive slides layout change task docs

Records the smoke-pass outcome and lessons; moves the todo/lessons
pair into docs/tasks/archive/ so docs/tasks/active/ shows only
in-flight work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

- [ ] **Step 7: Open the PR**

```bash
gh pr create --title "Add slide layout change UI with placeholder identity" --body "$(cat <<'EOF'
## Summary

- `Element.placeholderRef = { type, index }` so layout switches preserve typed content by slot identity.
- Single `applyLayoutToSlide` pure function backs both `MemSlidesStore` and `YorkieSlidesStore`; type-first matching with index fallback, orphan demote (no destructive deletes).
- Vanilla-DOM `showLayoutPicker` popover; opened by a new `▾` split on the thumbnail panel `+` button and by a "Change layout…" item on the slide context menu.
- Layout previews render through `renderThumbnail` against a synthetic slide with a module-level cache.

Spec: `docs/design/slides/slides-layout-change.md`.

## Test plan

- [x] `pnpm verify:fast`
- [x] `RUN_YORKIE_INTEGRATION_TESTS=true pnpm --filter @wafflebase/frontend test -- yorkie-slides-store`
- [x] Browser smoke: blank insert preserved, layout pick on insert, change-layout preserves typed content, orphans demote, theme switch refreshes previews, undo collapses to one step.
EOF
)"
```

---

## Self-Review

(Filled by the planner after writing the plan.)

- **Spec coverage:** Every spec section maps to a task — model types (T1), `PlaceholderSpec` + 11 layouts (T2), `applyLayoutToSlide` (T3), Mem store wiring (T4), Yorkie store wiring (T5), Yorkie convergence test (T6), `renderLayoutPreview` (T7), `showLayoutPicker` (T8), split-button (T9), context-menu item (T10), verify + smoke + lessons + archive (T11). Migration is explicitly skipped (per spec Q6).
- **Placeholder scan:** No TBDs / TODOs / "implement later" / vague "handle edge cases" patterns remain. T5/T6 reference "the exact push statement depends on existing branching" and "the exact `openClient` shape comes from any existing yorkie test helper" — these are deliberate adapt-points rather than placeholders, with the helper signature pinned in the surrounding code.
- **Type consistency:** `PlaceholderType`, `PlaceholderRef`, `PlaceholderSpec.placeholder.type`, `applyLayoutToSlide`, `showLayoutPicker`, `renderLayoutPreview`, `LayoutPickerOptions` all spell consistently across tasks. The cache key formula `${themeId}:${masterId}:${layoutId}:${w}x${h}` matches between T7 implementation and the test.
- **Scope:** Single PR; eleven tasks; final commit count expected ≈ 11 (one per task).

## Review

(Filled at Task 11.)
