# Slides Motion (Transitions + Object Animations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add slide transitions and per-element object animations (entrance/exit/emphasis) to the Slides package, playable in presentation mode and an editor Play preview, with best-effort PPTX import.

**Architecture:** A flat per-slide animation sequence stored in the CRDT (array index = playback order). A pure `src/anim/` engine (timeline compile → effect registry → easing → sampling → RAF player) drives playback. The Canvas renderer stays stateless and receives per-element transforms (`AnimState`) as an optional argument, so the static path is byte-identical when none is supplied. The same `AnimationPlayer` powers presentation mode and the editor Play preview.

**Tech Stack:** TypeScript, Vitest (slides unit tests), Canvas 2D, Yorkie CRDT, React (frontend Motion panel). Design doc: `docs/design/slides/slides-animation.md`.

## Global Constraints

- target-version: 0.5.0
- All persistence goes through the `SlidesStore` interface (`packages/slides/src/store/store.ts`) — never mutate document state directly (CLAUDE.md).
- New `Slide` / `ObjectAnimation` fields are OPTIONAL — existing serialized decks must keep their exact JSON shape and render identically.
- The static render path must stay byte-identical when no `animStates` is supplied.
- `src/anim/` modules are pure: no DOM, no `Date.now()` / `performance.now()` inside logic — time is injected.
- Every commit must pass `pnpm verify:fast` (lint + unit). Run from repo root.
- Slides unit tests run with `pnpm test` (Vitest) or `pnpm --filter @wafflebase/slides test`.
- Commit subjects ≤70 chars; body explains why; end body with the Co-Authored-By trailer from CLAUDE.md. Land via PR on a feature branch, not direct push to `main`.
- After new `index.ts` exports, rebuild slides (`pnpm slides build`) before frontend tests resolve them (memory: slides exports require build).

### Confirmed codebase conventions (override any task text that disagrees)

- **Slides test location:** tests live in `packages/slides/test/` mirroring the
  `src/` path — e.g. plan text "Test: `src/model/animation.test.ts`" means
  **`packages/slides/test/model/animation.test.ts`**; "`src/anim/easing.test.ts`"
  means **`packages/slides/test/anim/easing.test.ts`**, etc. Import the unit
  under test via a relative `../../src/...` path (e.g.
  `import { MemSlidesStore } from '../../src/store/memory'`). Do NOT colocate
  `*.test.ts` inside `src/`.
- **MemSlidesStore construction:** `new MemSlidesStore()` starts with an EMPTY
  presentation (no slides). To get a slide id, create one inside a batch:
  `let id!: string; store.batch(() => { id = store.addSlide('blank'); });`.
  There is no `MemSlidesStore.empty()` factory and no slide at index 0 on a
  fresh store. (Task 2's test sketch is wrong on this point — use this idiom.)
- **Frontend slides tests:** there is no existing frontend slides test harness.
  Task 3 must stand up its own test (confirm the frontend Vitest runner picks
  up a new `*.test.ts` under `packages/frontend/src/app/slides/` and how
  `YorkieSlidesStore` is constructed in isolation) rather than "mirroring an
  existing one".

---

## Phase 0 — Data model, CRDT, Store ops, Motion panel (no playback)

### Task 1: Animation model types

**Files:**
- Modify: `packages/slides/src/model/element.ts` (append type exports near the other element types)
- Modify: `packages/slides/src/model/presentation.ts` (extend `Slide`, add `SlideTransition` / `SlideAnimation`)
- Test: `packages/slides/src/model/animation.test.ts` (create — a type/shape sanity test)

**Interfaces:**
- Produces: `AnimCategory`, `AnimStart`, `AnimEasing`, `AnimDirection`, `AnimEffect`, `ObjectAnimation`, `SlideTransition`, `SlideAnimation` from `model/element.ts` / `model/presentation.ts`; `Slide.transition?` and `Slide.animations?` optional fields.

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/src/model/animation.test.ts
import { describe, it, expect } from 'vitest';
import type { ObjectAnimation } from './element';
import type { Slide, SlideAnimation, SlideTransition } from './presentation';

describe('animation model', () => {
  it('builds a SlideAnimation from ObjectAnimation + elementId', () => {
    const base: ObjectAnimation = {
      id: 'a1', category: 'entrance', effect: 'fadeIn',
      start: 'onClick', durationMs: 500,
    };
    const sa: SlideAnimation = { ...base, elementId: 'e1' };
    expect(sa.elementId).toBe('e1');
    expect(sa.effect).toBe('fadeIn');
  });

  it('allows a slide with optional transition + animations', () => {
    const t: SlideTransition = { type: 'fade', durationMs: 400 };
    const slide: Slide = {
      id: 's1', layoutId: 'l1',
      background: { fill: { kind: 'role', role: 'background' } },
      elements: [], notes: [],
      transition: t, animations: [],
    };
    expect(slide.transition?.type).toBe('fade');
    expect(slide.animations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- animation.test.ts`
Expected: FAIL — `ObjectAnimation` / `SlideAnimation` / `SlideTransition` not exported.

- [ ] **Step 3: Add the types to `element.ts`**

```ts
// packages/slides/src/model/element.ts  (append, after the Frame/Crop block)
export type AnimCategory = 'entrance' | 'exit' | 'emphasis';
export type AnimStart = 'onClick' | 'withPrev' | 'afterPrev';
export type AnimEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
export type AnimDirection = 'up' | 'down' | 'left' | 'right';

export type AnimEffect =
  | 'appear' | 'fadeIn' | 'flyIn' | 'zoomIn' | 'spin'   // entrance
  | 'disappear' | 'fadeOut' | 'flyOut' | 'zoomOut'      // exit
  | 'pulse' | 'grow';                                   // emphasis

/** One object-animation effect attached to an element on a slide. */
export type ObjectAnimation = {
  id: string;
  category: AnimCategory;
  effect: AnimEffect;
  start: AnimStart;
  direction?: AnimDirection;          // fly effects
  durationMs: number;
  delayMs?: number;
  easing?: AnimEasing;                // absent ⇒ easeInOut
  byParagraph?: boolean;              // text elements only
  /** PPTX round-trip preservation; present ⇒ effect may be preview-only. */
  pptxPreset?: { class: string; id: number; subtype?: number };
  /** Normalized <p:animMotion> path. Preserved on import; not played in v1. */
  motionPath?: string;
};
```

- [ ] **Step 4: Extend `presentation.ts`**

```ts
// packages/slides/src/model/presentation.ts
import type { AnimDirection, Crop, Element, ElementInit,
  ObjectAnimation, PlaceholderType } from './element'; // add AnimDirection, ObjectAnimation

export type SlideTransition = {
  type: 'none' | 'fade' | 'dissolve' | 'slide' | 'flip' | 'cube' | 'wipe' | 'push';
  direction?: AnimDirection;
  durationMs: number;
};

export type SlideAnimation = ObjectAnimation & { elementId: string };

// extend existing Slide:
export type Slide = {
  id: string;
  layoutId: string;
  background: Background;
  elements: Element[];
  notes: Block[];
  /** Absent ⇒ hard cut (current behavior). */
  transition?: SlideTransition;
  /** Playback order = array order. Absent ⇒ no object animations. */
  animations?: SlideAnimation[];
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- animation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/model/element.ts packages/slides/src/model/presentation.ts packages/slides/src/model/animation.test.ts
git commit -m "Add slides animation model types"
```

---

### Task 2: Store interface + MemSlidesStore ops

**Files:**
- Modify: `packages/slides/src/store/store.ts` (add method signatures to `SlidesStore`)
- Modify: `packages/slides/src/store/memory.ts` (implement on `MemSlidesStore`)
- Test: `packages/slides/src/store/memory-animation.test.ts` (create)

**Interfaces:**
- Consumes: `SlideTransition`, `SlideAnimation`, `ObjectAnimation` (Task 1); `requireBatch()`, `requireSlide(id)`, `clone()` patterns already in `memory.ts`.
- Produces on `SlidesStore`: `setSlideTransition(slideId, t: SlideTransition | undefined): void`; `addAnimation(slideId, anim: SlideAnimation): string`; `updateAnimation(slideId, animId, patch: Partial<ObjectAnimation>): void`; `removeAnimation(slideId, animId): void`; `reorderAnimation(slideId, animId, toIndex: number): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/slides/src/store/memory-animation.test.ts
import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from './memory';
import type { SlideAnimation } from '../model/presentation';

function newStore() {
  const store = MemSlidesStore.empty(); // use the existing factory; see memory.ts
  const slideId = store.read().slides[0].id;
  return { store, slideId };
}
const anim = (id: string, elementId: string): SlideAnimation => ({
  id, elementId, category: 'entrance', effect: 'fadeIn',
  start: 'onClick', durationMs: 500,
});

describe('MemSlidesStore animation ops', () => {
  it('adds, reorders, updates and removes animations in order', () => {
    const { store, slideId } = newStore();
    store.batch(() => {
      store.addAnimation(slideId, anim('a1', 'e1'));
      store.addAnimation(slideId, anim('a2', 'e2'));
    });
    expect(store.read().slides[0].animations?.map((a) => a.id)).toEqual(['a1', 'a2']);

    store.batch(() => store.reorderAnimation(slideId, 'a2', 0));
    expect(store.read().slides[0].animations?.map((a) => a.id)).toEqual(['a2', 'a1']);

    store.batch(() => store.updateAnimation(slideId, 'a1', { effect: 'zoomIn' }));
    expect(store.read().slides[0].animations?.find((a) => a.id === 'a1')?.effect).toBe('zoomIn');

    store.batch(() => store.removeAnimation(slideId, 'a2'));
    expect(store.read().slides[0].animations?.map((a) => a.id)).toEqual(['a1']);
  });

  it('sets and clears a slide transition', () => {
    const { store, slideId } = newStore();
    store.batch(() => store.setSlideTransition(slideId, { type: 'fade', durationMs: 400 }));
    expect(store.read().slides[0].transition?.type).toBe('fade');
    store.batch(() => store.setSlideTransition(slideId, undefined));
    expect(store.read().slides[0].transition).toBeUndefined();
  });
});
```

> If `MemSlidesStore.empty()` is not the actual factory, open `memory.ts` and use whatever the existing tests use to construct a store with one slide (e.g. a constructor taking a seed `SlidesDocument`). Mirror the construction in `memory.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- memory-animation.test.ts`
Expected: FAIL — methods not defined.

- [ ] **Step 3: Add signatures to `store.ts`**

```ts
// packages/slides/src/store/store.ts  (in the "--- slide-level ---" section)
// after applyLayout(...):

/** Set (or clear, with undefined) a slide's transition effect. */
setSlideTransition(slideId: string, transition: import('../model/presentation').SlideTransition | undefined): void;

/** Append an object animation to a slide's sequence. Returns its id. */
addAnimation(slideId: string, anim: import('../model/presentation').SlideAnimation): string;

/** LWW-patch a single animation's scalar fields. */
updateAnimation(slideId: string, animId: string, patch: Partial<import('../model/element').ObjectAnimation>): void;

/** Remove an animation from the slide's sequence. */
removeAnimation(slideId: string, animId: string): void;

/** Move an animation to `toIndex` within the slide's sequence (0 = first). */
reorderAnimation(slideId: string, animId: string, toIndex: number): void;
```

- [ ] **Step 4: Implement on `MemSlidesStore`**

```ts
// packages/slides/src/store/memory.ts  (near updateSlideBackground)
setSlideTransition(slideId: string, transition: SlideTransition | undefined): void {
  this.requireBatch();
  const slide = this.requireSlide(slideId);
  if (transition === undefined) delete slide.transition;
  else slide.transition = clone(transition);
}

addAnimation(slideId: string, anim: SlideAnimation): string {
  this.requireBatch();
  const slide = this.requireSlide(slideId);
  if (!slide.animations) slide.animations = [];
  slide.animations.push(clone(anim));
  return anim.id;
}

updateAnimation(slideId: string, animId: string, patch: Partial<ObjectAnimation>): void {
  this.requireBatch();
  const slide = this.requireSlide(slideId);
  const a = slide.animations?.find((x) => x.id === animId);
  if (!a) throw new Error(`[slides] animation '${animId}' not on slide '${slideId}'`);
  Object.assign(a, clone(patch));
}

removeAnimation(slideId: string, animId: string): void {
  this.requireBatch();
  const slide = this.requireSlide(slideId);
  if (!slide.animations) return;
  slide.animations = slide.animations.filter((x) => x.id !== animId);
  if (slide.animations.length === 0) delete slide.animations;
}

reorderAnimation(slideId: string, animId: string, toIndex: number): void {
  this.requireBatch();
  const slide = this.requireSlide(slideId);
  const list = slide.animations;
  if (!list) return;
  const from = list.findIndex((x) => x.id === animId);
  if (from < 0) return;
  const [moved] = list.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, list.length));
  list.splice(clamped, 0, moved);
}
```

Add `SlideTransition`, `SlideAnimation` to the existing `presentation` import and `ObjectAnimation` to the `element` import at the top of `memory.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- memory-animation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/store/store.ts packages/slides/src/store/memory.ts packages/slides/src/store/memory-animation.test.ts
git commit -m "Add slide transition + animation store ops"
```

---

### Task 3: YorkieSlidesStore ops

**Files:**
- Modify: `packages/frontend/src/app/slides/yorkie-slides-store.ts` (implement the 5 new methods)
- Test: extend the existing yorkie-slides-store test if present; otherwise add `packages/frontend/src/app/slides/yorkie-slides-store-animation.test.ts` following the existing store test harness in that folder.

**Interfaces:**
- Consumes: same signatures as Task 2; the file's existing Yorkie `root.update(...)` mutation pattern (mirror `updateSlideBackground`).
- Produces: the `SlidesStore` contract fully implemented for the Yorkie backend.

- [ ] **Step 1: Read the existing pattern**

Open `yorkie-slides-store.ts`, find `updateSlideBackground` and how it locates a slide inside `root.update((r) => { ... })` (Yorkie array of slides). Mirror it. Yorkie arrays support `push`, index assignment, and `splice` via the SDK's array proxy — match whatever the file already uses for `moveSlides` / element reorder.

- [ ] **Step 2: Write the failing test** (mirror Task 2's behaviors against the Yorkie-backed store using the folder's existing in-memory Yorkie test document helper). Assert add → reorder → update → remove order, and set/clear transition.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- yorkie-slides-store-animation`
Expected: FAIL — methods not implemented.

- [ ] **Step 4: Implement the 5 methods** using the file's `root.update` pattern. For `addAnimation`: ensure `slide.animations` array exists (`if (!slide.animations) slide.animations = []`), then `push`. For `reorderAnimation`: splice-out + splice-in on the Yorkie array. For `updateAnimation`: assign scalar keys individually (LWW per key) rather than replacing the object. For `removeAnimation`: filter/splice by id. For `setSlideTransition`: assign or delete the field.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- yorkie-slides-store-animation`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/slides/yorkie-slides-store.ts packages/frontend/src/app/slides/yorkie-slides-store-animation.test.ts
git commit -m "Implement animation store ops on Yorkie backend"
```

---

### Task 4: Motion panel scaffold + right-slot wiring

**Files:**
- Create: `packages/frontend/src/app/slides/motion-panel/index.tsx` (exports `MotionPanel`)
- Modify: `packages/frontend/src/app/slides/slides-detail.tsx` (`RightPanel` union + toggle + render)
- Modify: `packages/frontend/src/app/slides/toolbar/index.tsx` (add a Motion toggle button next to Theme/Format)

**Interfaces:**
- Consumes: `store: SlidesStore`, the active slide id, the current selection (selected element ids) — match how `FormatPanel` receives these in `slides-detail.tsx`.
- Produces: `MotionPanel` React component; `RightPanel` includes `"motion"`.

- [ ] **Step 1: Add `"motion"` to the union and state**

```tsx
// slides-detail.tsx
type RightPanel = "theme" | "format" | "motion" | null;
```

- [ ] **Step 2: Scaffold the panel**

```tsx
// motion-panel/index.tsx
import type { SlidesStore } from "@wafflebase/slides";

export function MotionPanel(props: {
  store: SlidesStore;
  slideId: string;
  selectedElementIds: string[];
  onClose: () => void;
}) {
  return (
    <aside className="slides-right-panel" aria-label="Motion">
      <header>Motion<button onClick={props.onClose} aria-label="Close">×</button></header>
      <section data-testid="transition-section">{/* Task 5 */}</section>
      <section data-testid="animation-section">{/* Task 6 */}</section>
    </aside>
  );
}
```

- [ ] **Step 3: Wire render + toolbar toggle** in `slides-detail.tsx`, mirroring the `rightPanel === "format"` block:

```tsx
{rightPanel === "motion" && store && (
  <MotionPanel
    store={store}
    slideId={activeSlideId}
    selectedElementIds={selectedElementIds}
    onClose={() => setRightPanel(null)}
  />
)}
```

Add a toolbar button that calls `setRightPanel(rightPanel === "motion" ? null : "motion")`, with `motionPanelOpen={rightPanel === "motion"}` passed to the toolbar like the theme/format ones.

- [ ] **Step 4: Manual verify**

Run: `pnpm dev`, open a deck, click the Motion toolbar button → panel opens with two empty sections, × closes it.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/motion-panel/index.tsx packages/frontend/src/app/slides/slides-detail.tsx packages/frontend/src/app/slides/toolbar/index.tsx
git commit -m "Scaffold slides Motion panel + right-slot wiring"
```

---

### Task 5: Motion panel — transition section

**Files:**
- Modify: `packages/frontend/src/app/slides/motion-panel/index.tsx`
- Create: `packages/frontend/src/app/slides/motion-panel/transition-section.tsx`

**Interfaces:**
- Consumes: `store.setSlideTransition`, `store.read()`, `store.batch`, the deck's slide list (for Apply-to-all).
- Produces: `<TransitionSection store slideId />`.

- [ ] **Step 1: Build the section**

```tsx
// transition-section.tsx
import type { SlidesStore } from "@wafflebase/slides";
import type { SlideTransition } from "@wafflebase/slides";

const TYPES: SlideTransition["type"][] =
  ["none","fade","dissolve","slide","flip","cube","wipe","push"];
const SPEED_MS = { slow: 1000, med: 500, fast: 250 } as const;

export function TransitionSection(props: { store: SlidesStore; slideId: string }) {
  const slide = props.store.read().slides.find((s) => s.id === props.slideId);
  const t = slide?.transition;
  const set = (next: SlideTransition | undefined) =>
    props.store.batch(() => props.store.setSlideTransition(props.slideId, next));

  return (
    <div>
      <label>Transition
        <select
          value={t?.type ?? "none"}
          onChange={(e) => {
            const type = e.target.value as SlideTransition["type"];
            set(type === "none" ? undefined : { type, durationMs: t?.durationMs ?? SPEED_MS.med });
          }}>
          {TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
        </select>
      </label>
      <label>Speed
        <select
          value={t?.durationMs ?? SPEED_MS.med}
          disabled={!t}
          onChange={(e) => t && set({ ...t, durationMs: Number(e.target.value) })}>
          <option value={SPEED_MS.slow}>Slow</option>
          <option value={SPEED_MS.med}>Medium</option>
          <option value={SPEED_MS.fast}>Fast</option>
        </select>
      </label>
      <button onClick={() => props.store.batch(() => {
        for (const s of props.store.read().slides) {
          props.store.setSlideTransition(s.id, t ? { ...t } : undefined);
        }
      })}>Apply to all slides</button>
    </div>
  );
}
```

- [ ] **Step 2: Mount it** in `motion-panel/index.tsx`'s transition section.

- [ ] **Step 3: Manual verify** in `pnpm dev`: pick Fade → reopen panel shows Fade; Apply-to-all sets every slide; choosing None clears it.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/slides/motion-panel/
git commit -m "Add transition controls to slides Motion panel"
```

---

### Task 6: Motion panel — animation list + add/reorder/remove + inspector

**Files:**
- Create: `packages/frontend/src/app/slides/motion-panel/animation-section.tsx`
- Modify: `packages/frontend/src/app/slides/motion-panel/index.tsx`

**Interfaces:**
- Consumes: `store.addAnimation/updateAnimation/removeAnimation/reorderAnimation`, `selectedElementIds`, `crypto.randomUUID()` for ids.
- Produces: `<AnimationSection store slideId selectedElementIds />`.

- [ ] **Step 1: Build the list + add + inspector**

```tsx
// animation-section.tsx
import type { SlidesStore, AnimEffect, AnimStart, SlideAnimation } from "@wafflebase/slides";

const ENTRANCE: AnimEffect[] = ["appear","fadeIn","flyIn","zoomIn","spin"];
const STARTS: AnimStart[] = ["onClick","withPrev","afterPrev"];

export function AnimationSection(props: {
  store: SlidesStore; slideId: string; selectedElementIds: string[];
}) {
  const slide = props.store.read().slides.find((s) => s.id === props.slideId);
  const list = slide?.animations ?? [];
  const target = props.selectedElementIds[0];

  const add = (effect: AnimEffect) => {
    if (!target) return;
    const a: SlideAnimation = {
      id: crypto.randomUUID(), elementId: target,
      category: "entrance", effect, start: "onClick", durationMs: 500,
    };
    props.store.batch(() => props.store.addAnimation(props.slideId, a));
  };

  return (
    <div>
      <button disabled={!target} onClick={() => add("fadeIn")}>+ Add animation</button>
      <ol data-testid="anim-list">
        {list.map((a, i) => (
          <li key={a.id}>
            <span>{i + 1}. {a.effect} → {a.elementId}</span>
            <button disabled={i === 0}
              onClick={() => props.store.batch(() => props.store.reorderAnimation(props.slideId, a.id, i - 1))}>↑</button>
            <button disabled={i === list.length - 1}
              onClick={() => props.store.batch(() => props.store.reorderAnimation(props.slideId, a.id, i + 1))}>↓</button>
            <button onClick={() => props.store.batch(() => props.store.removeAnimation(props.slideId, a.id))}>Remove</button>
            <select value={a.effect}
              onChange={(e) => props.store.batch(() => props.store.updateAnimation(props.slideId, a.id, { effect: e.target.value as AnimEffect }))}>
              {ENTRANCE.map((ef) => <option key={ef} value={ef}>{ef}</option>)}
            </select>
            <select value={a.start}
              onChange={(e) => props.store.batch(() => props.store.updateAnimation(props.slideId, a.id, { start: e.target.value as AnimStart }))}>
              {STARTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="range" min={100} max={3000} step={100} value={a.durationMs}
              onChange={(e) => props.store.batch(() => props.store.updateAnimation(props.slideId, a.id, { durationMs: Number(e.target.value) }))}/>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

> Exit/emphasis effects and by-paragraph toggle are added in Phase 2 (Task 20). This task ships entrance effects only.

- [ ] **Step 2: Mount it** in `motion-panel/index.tsx`.

- [ ] **Step 3: Manual verify** in `pnpm dev`: select an element, Add animation, reorder with ↑/↓, change effect/start/duration, Remove. Confirm the list reflects `store.read()` after each.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/slides/motion-panel/
git commit -m "Add object-animation list + inspector to Motion panel"
```

---

### Task 7: Editor order badges on animated elements

**Files:**
- Modify: the slides editor overlay that draws selection chrome (find via `grep -rl "selection" packages/frontend/src/app/slides` and the editor canvas in `packages/slides/src/view/editor/`). Add a small numbered badge near each element that has an animation, shown when the element is selected.
- Test: covered by the browser/interaction suite (Task 28's smoke); no unit test (DOM overlay).

**Interfaces:**
- Consumes: `slide.animations` (to compute per-element order index).

- [ ] **Step 1:** Compute a `Map<elementId, number[]>` of 1-based sequence positions from `slide.animations` (an element may appear multiple times). 
- [ ] **Step 2:** In the selection overlay, when an element is selected and present in that map, render a small badge (e.g. top-left of its frame) listing its order number(s).
- [ ] **Step 3:** Manual verify in `pnpm dev`: element with 2 animations shows its order badges only while selected.
- [ ] **Step 4: Commit**

```bash
git commit -am "Show animation order badges on selected elements"
```

---

## Phase 1 — Engine + render integration + playback

### Task 8: Easing functions

**Files:**
- Create: `packages/slides/src/anim/easing.ts`
- Test: `packages/slides/src/anim/easing.test.ts`

**Interfaces:**
- Produces: `applyEasing(easing: AnimEasing | undefined, p: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
// easing.test.ts
import { describe, it, expect } from 'vitest';
import { applyEasing } from './easing';

describe('applyEasing', () => {
  it('pins endpoints for every mode', () => {
    for (const m of ['linear','easeIn','easeOut','easeInOut'] as const) {
      expect(applyEasing(m, 0)).toBeCloseTo(0);
      expect(applyEasing(m, 1)).toBeCloseTo(1);
    }
  });
  it('linear is identity', () => {
    expect(applyEasing('linear', 0.3)).toBeCloseTo(0.3);
  });
  it('easeIn is below linear at the midpoint, easeOut above', () => {
    expect(applyEasing('easeIn', 0.5)).toBeLessThan(0.5);
    expect(applyEasing('easeOut', 0.5)).toBeGreaterThan(0.5);
  });
  it('defaults to easeInOut when undefined', () => {
    expect(applyEasing(undefined, 0.5)).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @wafflebase/slides test -- easing.test.ts`

- [ ] **Step 3: Implement**

```ts
// easing.ts
import type { AnimEasing } from '../model/element';

export function applyEasing(easing: AnimEasing | undefined, p: number): number {
  const t = Math.max(0, Math.min(1, p));
  switch (easing ?? 'easeInOut') {
    case 'linear': return t;
    case 'easeIn': return t * t;
    case 'easeOut': return t * (2 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -am "Add slides animation easing functions"`

---

### Task 9: AnimState + effects registry

**Files:**
- Create: `packages/slides/src/anim/state.ts` (the `AnimState` type + `IDENTITY` + `composeAnimStates`)
- Create: `packages/slides/src/anim/effects.ts`
- Test: `packages/slides/src/anim/effects.test.ts`

**Interfaces:**
- Produces: `type AnimState = { opacity: number; scale: number; dx: number; dy: number; rotation: number; hidden: boolean }`; `IDENTITY: AnimState`; `composeAnimStates(states: AnimState[]): AnimState`; `sampleEffect(effect: AnimEffect, opts): AnimState` where `opts = { progress: number; phase: 'before'|'active'|'after'; direction?: AnimDirection; slideW: number; slideH: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// effects.test.ts
import { describe, it, expect } from 'vitest';
import { sampleEffect } from './effects';
import { composeAnimStates, IDENTITY } from './state';

const base = { slideW: 1920, slideH: 1080 };

describe('sampleEffect', () => {
  it('fadeIn ramps opacity, hidden before', () => {
    expect(sampleEffect('fadeIn', { ...base, phase: 'before', progress: 0 }).hidden).toBe(true);
    expect(sampleEffect('fadeIn', { ...base, phase: 'active', progress: 0.5 }).opacity).toBeCloseTo(0.5);
    expect(sampleEffect('fadeIn', { ...base, phase: 'after', progress: 1 }).opacity).toBeCloseTo(1);
  });
  it('fadeOut hides after finishing', () => {
    expect(sampleEffect('fadeOut', { ...base, phase: 'after', progress: 1 }).hidden).toBe(true);
    expect(sampleEffect('fadeOut', { ...base, phase: 'active', progress: 0.5 }).opacity).toBeCloseTo(0.5);
  });
  it('flyIn offsets along direction and lands at 0', () => {
    const s = sampleEffect('flyIn', { ...base, phase: 'active', progress: 0, direction: 'left' });
    expect(s.dx).not.toBe(0);
    const end = sampleEffect('flyIn', { ...base, phase: 'active', progress: 1, direction: 'left' });
    expect(end.dx).toBeCloseTo(0);
  });
});

describe('composeAnimStates', () => {
  it('multiplies opacity/scale and sums dx/dy/rotation', () => {
    const a = { ...IDENTITY, opacity: 0.5, scale: 2, dx: 10, rotation: 1 };
    const b = { ...IDENTITY, opacity: 0.5, scale: 0.5, dx: 5, rotation: 2 };
    const c = composeAnimStates([a, b]);
    expect(c.opacity).toBeCloseTo(0.25);
    expect(c.scale).toBeCloseTo(1);
    expect(c.dx).toBeCloseTo(15);
    expect(c.rotation).toBeCloseTo(3);
  });
  it('hidden if any is hidden', () => {
    expect(composeAnimStates([IDENTITY, { ...IDENTITY, hidden: true }]).hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `state.ts`**

```ts
// state.ts
export type AnimState = {
  opacity: number; scale: number; dx: number; dy: number;
  rotation: number; hidden: boolean;
};
export const IDENTITY: AnimState =
  { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0, hidden: false };

export function composeAnimStates(states: AnimState[]): AnimState {
  return states.reduce((acc, s) => ({
    opacity: acc.opacity * s.opacity,
    scale: acc.scale * s.scale,
    dx: acc.dx + s.dx,
    dy: acc.dy + s.dy,
    rotation: acc.rotation + s.rotation,
    hidden: acc.hidden || s.hidden,
  }), { ...IDENTITY });
}
```

- [ ] **Step 4: Implement `effects.ts`**

```ts
// effects.ts
import type { AnimEffect, AnimDirection } from '../model/element';
import { type AnimState, IDENTITY } from './state';

type Opts = {
  progress: number;
  phase: 'before' | 'active' | 'after';
  direction?: AnimDirection;
  slideW: number; slideH: number;
};

function offset(dir: AnimDirection | undefined, w: number, h: number): { dx: number; dy: number } {
  switch (dir ?? 'left') {
    case 'left': return { dx: -w, dy: 0 };
    case 'right': return { dx: w, dy: 0 };
    case 'up': return { dx: 0, dy: -h };
    case 'down': return { dx: 0, dy: h };
  }
}

export function sampleEffect(effect: AnimEffect, o: Opts): AnimState {
  const p = o.progress;
  switch (effect) {
    case 'appear':
      return { ...IDENTITY, hidden: o.phase === 'before' };
    case 'disappear':
      return { ...IDENTITY, hidden: o.phase === 'after' };
    case 'fadeIn':
      return { ...IDENTITY, opacity: p, hidden: o.phase === 'before' };
    case 'fadeOut':
      return { ...IDENTITY, opacity: 1 - p, hidden: o.phase === 'after' };
    case 'flyIn': {
      const { dx, dy } = offset(o.direction, o.slideW, o.slideH);
      return { ...IDENTITY, dx: dx * (1 - p), dy: dy * (1 - p), opacity: p, hidden: o.phase === 'before' };
    }
    case 'flyOut': {
      const { dx, dy } = offset(o.direction, o.slideW, o.slideH);
      return { ...IDENTITY, dx: dx * p, dy: dy * p, opacity: 1 - p, hidden: o.phase === 'after' };
    }
    case 'zoomIn':
      return { ...IDENTITY, scale: 0.3 + 0.7 * p, opacity: p, hidden: o.phase === 'before' };
    case 'zoomOut':
      return { ...IDENTITY, scale: 1 - 0.7 * p, opacity: 1 - p, hidden: o.phase === 'after' };
    case 'spin':
      return { ...IDENTITY, rotation: p * 2 * Math.PI, hidden: o.phase === 'before' };
    case 'pulse':
      return { ...IDENTITY, scale: 1 + 0.2 * Math.sin(p * Math.PI) };
    case 'grow':
      return { ...IDENTITY, scale: 1 + 0.3 * p };
  }
}
```

- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `git add packages/slides/src/anim/ && git commit -m "Add AnimState + effect registry"`

---

### Task 10: Timeline compilation

**Files:**
- Create: `packages/slides/src/anim/timeline.ts`
- Test: `packages/slides/src/anim/timeline.test.ts`

**Interfaces:**
- Consumes: `Slide`, `SlideAnimation`.
- Produces: `type ScheduledAnim = { anim: SlideAnimation; startAtMs: number; endAtMs: number }`; `type Step = { items: ScheduledAnim[] }`; `compileTimeline(slide: Slide, opts?: { existingElementIds?: Set<string>; paragraphCounts?: Map<string, number> }): Step[]`.

- [ ] **Step 1: Write the failing test**

```ts
// timeline.test.ts
import { describe, it, expect } from 'vitest';
import { compileTimeline } from './timeline';
import type { Slide, SlideAnimation } from '../model/presentation';

const a = (id: string, start: SlideAnimation['start'], dur = 500, delay = 0): SlideAnimation => ({
  id, elementId: 'e' + id, category: 'entrance', effect: 'fadeIn',
  start, durationMs: dur, delayMs: delay,
});
const slide = (anims: SlideAnimation[]): Slide => ({
  id: 's', layoutId: 'l', background: { fill: { kind: 'role', role: 'background' } },
  elements: [], notes: [], animations: anims,
});

describe('compileTimeline', () => {
  it('splits steps on onClick', () => {
    const steps = compileTimeline(slide([a('1','onClick'), a('2','onClick')]));
    expect(steps).toHaveLength(2);
  });
  it('withPrev shares the previous startAt within the same step', () => {
    const steps = compileTimeline(slide([a('1','onClick'), a('2','withPrev')]));
    expect(steps).toHaveLength(1);
    expect(steps[0].items[1].startAtMs).toBe(steps[0].items[0].startAtMs);
  });
  it('afterPrev starts at previous endAt', () => {
    const steps = compileTimeline(slide([a('1','onClick',500), a('2','afterPrev',300)]));
    expect(steps[0].items[1].startAtMs).toBe(steps[0].items[0].endAtMs);
    expect(steps[0].items[1].endAtMs).toBe(steps[0].items[0].endAtMs + 300);
  });
  it('applies delayMs to startAt', () => {
    const steps = compileTimeline(slide([a('1','onClick',500,200)]));
    expect(steps[0].items[0].startAtMs).toBe(200);
    expect(steps[0].items[0].endAtMs).toBe(700);
  });
  it('skips animations whose element no longer exists', () => {
    const steps = compileTimeline(slide([a('1','onClick')]), { existingElementIds: new Set() });
    expect(steps).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
// timeline.ts
import type { Slide, SlideAnimation } from '../model/presentation';

export type ScheduledAnim = { anim: SlideAnimation; startAtMs: number; endAtMs: number };
export type Step = { items: ScheduledAnim[] };

export function compileTimeline(
  slide: Slide,
  opts?: { existingElementIds?: Set<string>; paragraphCounts?: Map<string, number> },
): Step[] {
  const raw = (slide.animations ?? []).filter(
    (a) => !opts?.existingElementIds || opts.existingElementIds.has(a.elementId),
  );
  // Expand by-paragraph into one afterPrev-chained effect per paragraph.
  const seq: SlideAnimation[] = [];
  for (const a of raw) {
    const n = a.byParagraph ? (opts?.paragraphCounts?.get(a.elementId) ?? 1) : 1;
    for (let i = 0; i < n; i++) {
      seq.push(i === 0 ? a : { ...a, id: `${a.id}#${i}`, start: 'afterPrev' });
    }
  }

  const steps: Step[] = [];
  let cur: ScheduledAnim[] | null = null;
  let prev: ScheduledAnim | null = null;

  for (const anim of seq) {
    const dur = anim.durationMs;
    const delay = anim.delayMs ?? 0;
    if (anim.start === 'onClick' || cur === null) {
      cur = [];
      steps.push({ items: cur });
      const startAtMs = delay;
      const sa = { anim, startAtMs, endAtMs: startAtMs + dur };
      cur.push(sa); prev = sa;
    } else if (anim.start === 'withPrev') {
      const startAtMs = (prev?.startAtMs ?? 0) + delay;
      const sa = { anim, startAtMs, endAtMs: startAtMs + dur };
      cur.push(sa); prev = sa;
    } else { // afterPrev
      const startAtMs = (prev?.endAtMs ?? 0) + delay;
      const sa = { anim, startAtMs, endAtMs: startAtMs + dur };
      cur.push(sa); prev = sa;
    }
  }
  return steps;
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -am "Add timeline compilation (onClick/with/after, by-paragraph)"`

---

### Task 11: Step sampling

**Files:**
- Create: `packages/slides/src/anim/sample.ts`
- Test: `packages/slides/src/anim/sample.test.ts`

**Interfaces:**
- Consumes: `Step`, `applyEasing`, `sampleEffect`, `composeAnimStates`, `AnimState`.
- Produces: `sampleStep(step: Step, elapsedMs: number, slide: { w: number; h: number }): Map<string, AnimState>` (keyed by elementId); `stepDurationMs(step: Step): number`.

- [ ] **Step 1: Write the failing test**

```ts
// sample.test.ts
import { describe, it, expect } from 'vitest';
import { sampleStep, stepDurationMs } from './sample';
import type { Step } from './timeline';

const step: Step = { items: [
  { anim: { id:'1', elementId:'e1', category:'entrance', effect:'fadeIn', start:'onClick', durationMs:500 }, startAtMs: 0, endAtMs: 500 },
]};

describe('sampleStep', () => {
  it('is hidden before start and full after end', () => {
    expect(sampleStep(step, -1, { w:1920, h:1080 }).get('e1')!.hidden).toBe(true);
    expect(sampleStep(step, 250, { w:1920, h:1080 }).get('e1')!.opacity).toBeGreaterThan(0);
    expect(sampleStep(step, 600, { w:1920, h:1080 }).get('e1')!.opacity).toBeCloseTo(1);
  });
  it('reports total duration', () => {
    expect(stepDurationMs(step)).toBe(500);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
// sample.ts
import type { Step } from './timeline';
import { applyEasing } from './easing';
import { sampleEffect } from './effects';
import { composeAnimStates, type AnimState } from './state';

export function stepDurationMs(step: Step): number {
  return step.items.reduce((m, it) => Math.max(m, it.endAtMs), 0);
}

export function sampleStep(step: Step, elapsedMs: number, slide: { w: number; h: number }): Map<string, AnimState> {
  const byEl = new Map<string, AnimState[]>();
  for (const it of step.items) {
    const dur = it.endAtMs - it.startAtMs;
    let phase: 'before' | 'active' | 'after';
    let progress: number;
    if (elapsedMs < it.startAtMs) { phase = 'before'; progress = 0; }
    else if (elapsedMs >= it.endAtMs) { phase = 'after'; progress = 1; }
    else { phase = 'active'; progress = dur > 0 ? (elapsedMs - it.startAtMs) / dur : 1; }
    const eased = applyEasing(it.anim.easing, progress);
    const s = sampleEffect(it.anim.effect, {
      progress: eased, phase, direction: it.anim.direction, slideW: slide.w, slideH: slide.h,
    });
    const arr = byEl.get(it.anim.elementId) ?? [];
    arr.push(s);
    byEl.set(it.anim.elementId, arr);
  }
  const out = new Map<string, AnimState>();
  for (const [id, arr] of byEl) out.set(id, composeAnimStates(arr));
  return out;
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -am "Add step sampling (phase/easing/compose)"`

---

### Task 12: Transition cross-paint descriptor

**Files:**
- Create: `packages/slides/src/anim/transition.ts`
- Test: `packages/slides/src/anim/transition.test.ts`

**Interfaces:**
- Consumes: `SlideTransition`.
- Produces: `type CrossPaint = { prevAlpha: number; nextAlpha: number; prevDx: number; nextDx: number; prevDy: number; nextDy: number; clipNext?: { x: number; y: number; w: number; h: number } }`; `sampleTransition(t: SlideTransition, progress: number, size: { w: number; h: number }): CrossPaint`.

- [ ] **Step 1: Write the failing test**

```ts
// transition.test.ts
import { describe, it, expect } from 'vitest';
import { sampleTransition } from './transition';
const size = { w: 1920, h: 1080 };

describe('sampleTransition', () => {
  it('fade cross-fades alpha', () => {
    const c = sampleTransition({ type:'fade', durationMs:400 }, 0.5, size);
    expect(c.prevAlpha).toBeCloseTo(0.5);
    expect(c.nextAlpha).toBeCloseTo(0.5);
  });
  it('push slides next in from the right by default', () => {
    const c = sampleTransition({ type:'push', durationMs:400 }, 0, size);
    expect(c.nextDx).toBeCloseTo(size.w);
    const end = sampleTransition({ type:'push', durationMs:400 }, 1, size);
    expect(end.nextDx).toBeCloseTo(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
// transition.ts
import type { SlideTransition } from '../model/presentation';

export type CrossPaint = {
  prevAlpha: number; nextAlpha: number;
  prevDx: number; nextDx: number; prevDy: number; nextDy: number;
  clipNext?: { x: number; y: number; w: number; h: number };
};

export function sampleTransition(t: SlideTransition, progress: number, size: { w: number; h: number }): CrossPaint {
  const p = Math.max(0, Math.min(1, progress));
  const base: CrossPaint = { prevAlpha: 1, nextAlpha: 1, prevDx: 0, nextDx: 0, prevDy: 0, nextDy: 0 };
  switch (t.type) {
    case 'none':
      return { ...base, prevAlpha: 1 - p, nextAlpha: 1 }; // instant-ish; presenter may skip
    case 'fade':
    case 'dissolve':
    case 'flip':   // approximated as fade
    case 'cube':   // approximated as fade
      return { ...base, prevAlpha: 1 - p, nextAlpha: p };
    case 'push':
    case 'slide': {
      const sign = t.direction === 'left' ? -1 : 1; // default: from right
      return { ...base, prevDx: -sign * size.w * p, nextDx: sign * size.w * (1 - p) };
    }
    case 'wipe':
      return { ...base, clipNext: { x: 0, y: 0, w: size.w * p, h: size.h } };
  }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -am "Add transition cross-paint descriptor"`

---

### Task 13: AnimationPlayer

**Files:**
- Create: `packages/slides/src/anim/player.ts`
- Test: `packages/slides/src/anim/player.test.ts`

**Interfaces:**
- Consumes: `Step`, `sampleStep`, `stepDurationMs`, `AnimState`.
- Produces: `class AnimationPlayer` with `constructor(steps: Step[], size: {w:number;h:number}, onFrame: (s: Map<string, AnimState>) => void)`, `advance(): void`, `tick(nowMs: number): void`, `get isLastStep(): boolean`, `get done(): boolean`, `reset(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// player.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AnimationPlayer } from './player';
import type { Step } from './timeline';

const mk = (dur: number): Step => ({ items: [
  { anim: { id:'1', elementId:'e1', category:'entrance', effect:'fadeIn', start:'onClick', durationMs:dur }, startAtMs:0, endAtMs:dur },
]});
const size = { w: 1920, h: 1080 };

describe('AnimationPlayer', () => {
  it('plays a step over time on advance', () => {
    const frames: number[] = [];
    const p = new AnimationPlayer([mk(500), mk(500)], size, (s) => frames.push(s.get('e1')!.opacity));
    p.advance();          // start step 0 at t0
    p.tick(0); p.tick(250); p.tick(500);
    expect(frames.at(-1)).toBeCloseTo(1);
    expect(p.isLastStep).toBe(false);
  });
  it('skip-to-end: advancing mid-step completes the current step', () => {
    const onFrame = vi.fn();
    const p = new AnimationPlayer([mk(500), mk(500)], size, onFrame);
    p.advance(); p.tick(0); p.tick(100);
    p.advance();          // mid-step → snap to end, do NOT start next
    const lastBefore = onFrame.mock.calls.at(-1)![0].get('e1').opacity;
    expect(lastBefore).toBeCloseTo(1);
    p.advance();          // now start step 1
    expect(p.isLastStep).toBe(true);
  });
  it('done after last step finishes', () => {
    const p = new AnimationPlayer([mk(100)], size, () => {});
    p.advance(); p.tick(0); p.tick(100);
    expect(p.isLastStep).toBe(true);
    expect(p.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
// player.ts
import type { Step } from './timeline';
import { sampleStep, stepDurationMs } from './sample';
import type { AnimState } from './state';

export class AnimationPlayer {
  private index = -1;        // current step index, -1 = not started
  private startNow: number | null = null;
  private playing = false;
  private finishedCurrent = true;

  constructor(
    private readonly steps: Step[],
    private readonly size: { w: number; h: number },
    private readonly onFrame: (s: Map<string, AnimState>) => void,
  ) {}

  get isLastStep(): boolean { return this.index >= this.steps.length - 1; }
  get done(): boolean { return this.index >= this.steps.length - 1 && this.finishedCurrent; }

  /** Next user input. Returns true if it consumed an animation step
   *  (so the caller should NOT also advance the slide). */
  advance(): boolean {
    if (this.playing && !this.finishedCurrent) {
      this.snapToEnd();                  // skip-to-end
      return true;
    }
    if (this.index >= this.steps.length - 1) return false; // nothing left
    this.index += 1;
    this.startNow = null;
    this.playing = true;
    this.finishedCurrent = false;
    return true;
  }

  tick(nowMs: number): void {
    if (!this.playing || this.index < 0) return;
    if (this.startNow === null) this.startNow = nowMs;
    const elapsed = nowMs - this.startNow;
    const step = this.steps[this.index];
    this.onFrame(sampleStep(step, elapsed, this.size));
    if (elapsed >= stepDurationMs(step)) { this.finishedCurrent = true; this.playing = false; }
  }

  private snapToEnd(): void {
    const step = this.steps[this.index];
    this.onFrame(sampleStep(step, stepDurationMs(step), this.size));
    this.finishedCurrent = true;
    this.playing = false;
  }

  reset(): void {
    this.index = -1; this.startNow = null; this.playing = false; this.finishedCurrent = true;
  }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -am "Add AnimationPlayer (advance/skip-to-end/tick)"`

---

### Task 14: Export the engine + render element-level injection

**Files:**
- Create: `packages/slides/src/anim/index.ts` (barrel)
- Modify: `packages/slides/src/index.ts` (re-export anim types/engine + the new model types)
- Modify: `packages/slides/src/view/canvas/element-renderer.ts` (`drawElement` optional `anim?: AnimState`)
- Test: `packages/slides/src/view/canvas/element-renderer-anim.test.ts`

**Interfaces:**
- Consumes: `AnimState` from `../../anim/state`.
- Produces: `drawElement(..., anim?: AnimState)` applies opacity/translate/scale/rotation in slide space, skips when `anim.hidden`.

- [ ] **Step 1: Write the failing test** (assert the wrapper transforms are applied via a mock ctx)

```ts
// element-renderer-anim.test.ts
import { describe, it, expect, vi } from 'vitest';
import { drawElement } from './element-renderer';
// Build a minimal element + doc + theme as the existing element-renderer tests do.
// Import those fixtures/helpers from the sibling test if exported, else inline a tiny shape element.

describe('drawElement anim injection', () => {
  it('skips paint when anim.hidden', () => {
    const ctx = makeMockCtx();                 // mock with save/restore/translate/scale/rotate spies
    drawElement(ctx as any, shapeFixture, docFixture, themeFixture, () => {}, undefined, undefined, undefined,
      { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0, hidden: true });
    expect(ctx.fillRect).not.toHaveBeenCalled();     // or whatever the shape painter calls
  });
  it('applies translate/scale when anim present', () => {
    const ctx = makeMockCtx();
    drawElement(ctx as any, shapeFixture, docFixture, themeFixture, () => {}, undefined, undefined, undefined,
      { opacity: 0.5, scale: 2, dx: 10, dy: 20, rotation: 0, hidden: false });
    expect(ctx.translate).toHaveBeenCalledWith(10, 20);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  });
});
```

> Match `drawElement`'s real parameter list (the explore noted `drawElement(ctx, element, doc, theme, onAssetLoad, elementsLookup, parentFlip, parentTransform)`). Append `anim?: AnimState` as the final optional parameter; update the test's argument positions to match the actual signature you find in the file.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — wrap the existing body:

```ts
// element-renderer.ts — at the top of drawElement, after computing center cx, cy
export function drawElement(/* …existing params…, */ anim?: AnimState): void {
  if (anim?.hidden) return;
  const hasAnim = anim && (anim.opacity !== 1 || anim.scale !== 1 || anim.dx !== 0 || anim.dy !== 0 || anim.rotation !== 0);
  if (hasAnim) {
    ctx.save();
    ctx.globalAlpha *= anim!.opacity;
    ctx.translate(anim!.dx, anim!.dy);
    const cx = element.frame.x + element.frame.w / 2;
    const cy = element.frame.y + element.frame.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(anim!.scale, anim!.scale);
    ctx.rotate(anim!.rotation);
    ctx.translate(-cx, -cy);
  }
  /* …existing drawElement body unchanged… */
  if (hasAnim) ctx.restore();
}
```

> If the body has early `return`s, refactor so the single `ctx.restore()` always runs (wrap the existing body in a helper or use try/finally). Keep behavior identical when `anim` is undefined.

- [ ] **Step 4: Add the barrel + package exports**

```ts
// packages/slides/src/anim/index.ts
export * from './state';
export * from './easing';
export * from './effects';
export * from './timeline';
export * from './sample';
export * from './transition';
export * from './player';
```

Add to `packages/slides/src/index.ts`: `export * from './anim';` and ensure the new model types (`ObjectAnimation`, `SlideTransition`, `SlideAnimation`, `AnimEffect`, `AnimStart`, etc.) are re-exported (they are if `index.ts` does `export * from './model/element'` / `'./model/presentation'`; otherwise add them).

- [ ] **Step 5: Run → PASS** then `pnpm slides build` (memory: frontend resolves slides via dist).
- [ ] **Step 6: Commit** `git commit -am "Inject AnimState into element renderer + export anim engine"`

---

### Task 15: Slide-renderer animStates passthrough + dirty flag

**Files:**
- Modify: `packages/slides/src/view/canvas/slide-renderer.ts` (`drawSlide`, `forceRender`, dirty handling)
- Test: `packages/slides/src/view/canvas/slide-renderer-anim.test.ts`

**Interfaces:**
- Consumes: `Map<string, AnimState>`, `drawElement(..., anim?)`.
- Produces: `drawSlide(ctx, slide, doc, options, onAssetLoad, ghosts?, animStates?)`; `forceRender(slide, doc, ghosts?, animStates?)`; passing the per-element `AnimState` through to `drawElement`.

- [ ] **Step 1: Write the failing test**

```ts
// slide-renderer-anim.test.ts
import { describe, it, expect } from 'vitest';
// Render a slide with one element twice: once with no animStates, once with an
// animStates Map setting that element hidden. Assert: (a) no-animStates output
// equals the pre-existing snapshot (byte-identical guard), (b) hidden element is
// not painted when animStates marks it hidden.
```

> Reuse the package's existing canvas test harness (look for how `slide-renderer.test.ts` constructs a canvas/mock ctx). The key assertion is the **no-arg path is unchanged**.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — thread `animStates?: Map<string, AnimState>` through `drawSlide` and into the per-element loop: `drawElement(ctx, el, doc, theme, onAssetLoad, lookup, parentFlip, parentTransform, animStates?.get(el.id))`. Add the same optional param to `forceRender`. When animation is active the caller pins dirty; expose a setter or have `forceRender` always paint (it already does).

- [ ] **Step 4: Run → PASS** then `pnpm slides build`.
- [ ] **Step 5: Commit** `git commit -am "Thread animStates through slide renderer"`

---

### Task 16: Presenter playback integration

**Files:**
- Modify: `packages/slides/src/view/present/presenter.ts`
- Test: `packages/slides/src/view/present/presenter-anim.test.ts`

**Interfaces:**
- Consumes: `compileTimeline`, `AnimationPlayer`, `sampleTransition`, `forceRender`.
- Produces: presenter that, per slide, plays `transition` then runs the step queue; advance keys mean "next step, else next slide".

- [ ] **Step 1: Write the failing test** — drive the presenter with injected time:
  - A slide with 2 onClick steps: first `advance()` plays step 0 (assert element becomes visible), does NOT change slide; after both steps, next `advance()` moves to the next slide.
  - A slide with a `fade` transition entering plays the cross-fade before steps.
  Use the presenter's existing test seams (it already has `presenter.test.ts`; mirror how it injects RAF / advances).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement:**
  - On entering a slide, build `compileTimeline(slide, { existingElementIds })` and a fresh `AnimationPlayer(steps, { w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, (states) => this.renderer.forceRender(slide, doc, undefined, states))`.
  - Start a RAF loop (`requestAnimationFrame`) that calls `player.tick(now)` while not `player.done`; pin renderer dirty during playback.
  - Replace the advance handler: `if (player.advance()) { /* consumed a step */ } else { goToNextSlide(); }`. Previous-slide key resets to the slide's end-state (all steps complete) — render with the final composed state or simply paint statically.
  - Play transition on slide change: before starting the next slide's step player, run a short transition RAF using `sampleTransition`, painting prev+next per `CrossPaint`. For `none`, skip.

- [ ] **Step 4: Run → PASS** then `pnpm slides build`.
- [ ] **Step 5: Commit** `git commit -am "Play transitions + object animations in presentation mode"`

---

### Task 17: Motion panel Play preview

**Files:**
- Modify: `packages/frontend/src/app/slides/motion-panel/animation-section.tsx` (add ▶ Play)
- Modify: editor canvas host to accept transient `animStates` for preview (find the editor render entry that calls `forceRender`/`drawSlide` in `packages/slides/src/view/editor/` or the frontend canvas host).

**Interfaces:**
- Consumes: `compileTimeline`, `AnimationPlayer`, the editor's render entry that can accept `animStates`.

- [ ] **Step 1:** Add a ▶ Play button that builds `compileTimeline(currentSlide)` + an `AnimationPlayer` whose `onFrame` pushes `animStates` into the editor canvas (a transient overlay state, NOT the store). Auto-advance through all steps for preview (call `advance()` on each step boundary via the player's `done`/`isLastStep`), driven by a local `requestAnimationFrame` loop.
- [ ] **Step 2:** When preview finishes (`player.done`), clear the transient `animStates` so the editor returns to static render.
- [ ] **Step 3: Manual verify** in `pnpm dev`: select element(s) with animations, click Play → effects animate on the editor canvas, then settle to final state.
- [ ] **Step 4: Commit** `git commit -am "Add Play preview to Motion panel"`

---

## Phase 2 — Advanced timing/effects + composition

> Timeline already supports with/after-previous and by-paragraph (Task 10), and effects already include exit/emphasis (Task 9). Phase 2 surfaces them in the UI and locks composition behavior with tests.

### Task 18: Exit/emphasis + by-paragraph in the panel

**Files:**
- Modify: `packages/frontend/src/app/slides/motion-panel/animation-section.tsx`

- [ ] **Step 1:** Add a category selector (`entrance | exit | emphasis`) per animation row; filter the effect dropdown by category: entrance `[appear,fadeIn,flyIn,zoomIn,spin]`, exit `[disappear,fadeOut,flyOut,zoomOut]`, emphasis `[pulse,grow]`. On category change, set `category` and a sensible default `effect` in one `updateAnimation` patch.
- [ ] **Step 2:** Add a direction selector shown only for `flyIn`/`flyOut`.
- [ ] **Step 3:** Add a `By paragraph` checkbox shown only when the target element is a text element (check the element type from `store.read()`), wired to `updateAnimation(..., { byParagraph })`.
- [ ] **Step 4:** Add a `delay` number input wired to `delayMs`, and an `easing` selector wired to `easing`.
- [ ] **Step 5: Manual verify** in `pnpm dev`: exit effect hides element at end in Play preview; flyIn direction changes entry side; by-paragraph reveals a multi-paragraph text box line-by-line.
- [ ] **Step 6: Commit** `git commit -am "Surface exit/emphasis/direction/by-paragraph in Motion panel"`

---

### Task 19: by-paragraph paragraph counts wiring

**Files:**
- Modify: presenter + Play preview call sites to pass `paragraphCounts` into `compileTimeline`.
- Test: `packages/slides/src/anim/timeline.test.ts` (add a by-paragraph expansion case)

**Interfaces:**
- Consumes: a helper that counts paragraphs (blocks) for a text/shape element from the slide model.

- [ ] **Step 1: Write the failing test** asserting `compileTimeline(slide([{...byParagraph:true}]), { paragraphCounts: new Map([['e1', 3]]) })` yields 3 afterPrev-chained scheduled anims in one step.
- [ ] **Step 2: Run → FAIL** (only if not already covered) / adjust.
- [ ] **Step 3: Implement** the paragraph-count helper (read the element's `TextBody`/`data.text` block count) and pass it from both presenter (Task 16) and Play preview (Task 17) call sites.
- [ ] **Step 4: Run → PASS** then `pnpm slides build`.
- [ ] **Step 5: Commit** `git commit -am "Wire paragraph counts into by-paragraph expansion"`

---

### Task 20: Composition + regression snapshot tests

**Files:**
- Test: `packages/slides/src/view/canvas/element-renderer-anim.test.ts` (extend)
- Test: `packages/slides/src/anim/sample.test.ts` (extend)

- [ ] **Step 1:** Add a sample test: one element with two overlapping animations (e.g. `spin` + `fadeIn` via two `withPrev` items) composes to rotation + partial opacity at mid-step.
- [ ] **Step 2:** Add a renderer test: a rotated shape (`frame.rotation = π/4`) with `anim = { dx:10, scale:2 }` calls ctx transforms in the order translate(dx) → translate(center) → scale → rotate(anim) → translate(-center), THEN the element's own local rotate — assert the outer wrapper runs before the inner body via spy call order.
- [ ] **Step 3:** Add the byte-identical guard explicitly: render the fixture with `animStates` undefined and compare against a committed reference (image hash or recorded ctx call list) to prove zero regression.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -am "Add animation composition + render regression tests"`

---

## Phase 3 — PPTX import

### Task 21: Transition import

**Files:**
- Create: `packages/slides/src/import/pptx/transition-map.ts`
- Modify: `packages/slides/src/import/pptx/slide.ts` (`parseSlide` reads `<p:transition>`)
- Test: `packages/slides/src/import/pptx/transition.test.ts`

**Interfaces:**
- Consumes: the XML node helper utilities already used in `slide.ts` (find how it reads child elements / attributes).
- Produces: `parseTransition(transitionEl): SlideTransition | undefined`; `parseSlide` sets `slide.transition`.

- [ ] **Step 1: Write the failing test** with a small `<p:transition>` XML fixture:

```ts
// transition.test.ts
import { describe, it, expect } from 'vitest';
import { parseTransition } from './transition-map';
// Parse the fixture using the same XML parser slide.ts uses (e.g. fast-xml-parser);
// construct the node the way parseSlide will hand it in.

describe('parseTransition', () => {
  it('maps <p:fade> with spd', () => {
    const t = parseTransition(/* node for <p:transition spd="slow"><p:fade/></p:transition> */);
    expect(t).toEqual({ type: 'fade', durationMs: 1000 });
  });
  it('maps <p:push dir="r"> to push with direction', () => {
    const t = parseTransition(/* <p:transition><p:push dir="r"/></p:transition> */);
    expect(t?.type).toBe('push');
  });
  it('returns undefined for an empty/absent transition', () => {
    expect(parseTransition(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `transition-map.ts` with: a `spd → durationMs` map (`slow:1000, med:500, fast:250`, default med); a child-tag → `SlideTransition['type']` map (`fade→fade`, `dissolve→dissolve`, `push→push`, `pull→push`, `wipe→wipe`, `cut→none`, `cover→push`, `cube→cube`, `flip→flip`, default → `fade`); read `dir` attribute → `direction`. Then call it from `parseSlide` (transition node is a sibling of `<p:cSld>`).
- [ ] **Step 4: Run → PASS** then `pnpm slides build`.
- [ ] **Step 5: Commit** `git commit -am "Import PPTX slide transitions"`

---

### Task 22: Animation preset map

**Files:**
- Create: `packages/slides/src/import/pptx/anim-preset-map.ts`
- Test: `packages/slides/src/import/pptx/anim-preset-map.test.ts`

**Interfaces:**
- Produces: `mapPreset(presetClass: string, presetID: number, presetSubtype?: number): { category: AnimCategory; effect: AnimEffect; direction?: AnimDirection } | null` — returns `null` for unmapped presets.

- [ ] **Step 1: Write the failing test**

```ts
// anim-preset-map.test.ts
import { describe, it, expect } from 'vitest';
import { mapPreset } from './anim-preset-map';

describe('mapPreset', () => {
  it('maps Fade entrance (entr, 10)', () => {
    expect(mapPreset('entr', 10)).toEqual({ category: 'entrance', effect: 'fadeIn' });
  });
  it('maps Fly In entrance (entr, 2) with subtype → direction', () => {
    const m = mapPreset('entr', 2, 4 /* from bottom */);
    expect(m?.effect).toBe('flyIn');
    expect(m?.category).toBe('entrance');
  });
  it('returns null for unknown presets', () => {
    expect(mapPreset('entr', 9999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** a lookup keyed by `${presetClass}:${presetID}`. Minimum coverage (PowerPoint preset IDs): entrance `1→appear`, `2→flyIn`, `10→fadeIn`, `23→zoomIn`, `8→spin`; exit `1→disappear`, `2→flyOut`, `10→fadeOut`, `23→zoomOut`; emphasis `→pulse`/`grow` where recognizable. Map `presetSubtype` directional codes (`4→down`/`from bottom`, `8→up`, `1→across`, etc. — encode the common Fly subtypes; default `left`). Return `null` otherwise.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git commit -am "Add PPTX animation preset map"`

---

### Task 23: Timing parse + flatten + preservation

**Files:**
- Create: `packages/slides/src/import/pptx/timing.ts`
- Modify: `packages/slides/src/import/pptx/shape.ts` or `slide.ts` (call `parseTiming`, attach `slide.animations`)
- Modify: `packages/slides/src/import/pptx/report.ts` (new warning keys)
- Test: `packages/slides/src/import/pptx/timing.test.ts`

**Interfaces:**
- Consumes: `mapPreset`, the spid↔elementId table built during shape parsing, the XML node helpers.
- Produces: `parseTiming(timingEl, ctx: { spidToElementId: Map<string,string>; report: ImportReport }): SlideAnimation[]`.

- [ ] **Step 1: Write the failing test** with a small `<p:timing>` fixture containing a `mainSeq` with one `clickEffect` par (presetClass `entr`, presetID `10`, target spid `3`, dur `500`):

```ts
// timing.test.ts
import { describe, it, expect } from 'vitest';
import { parseTiming } from './timing';

describe('parseTiming', () => {
  it('flattens a mapped entrance click effect', () => {
    const ctx = { spidToElementId: new Map([['3','e3']]), report: { warn: () => {} } as any };
    const anims = parseTiming(/* timing node */, ctx);
    expect(anims).toHaveLength(1);
    expect(anims[0]).toMatchObject({ elementId: 'e3', category: 'entrance', effect: 'fadeIn', start: 'onClick', durationMs: 500 });
  });
  it('preserves an unmapped preset and warns', () => {
    const warn = vi.fn();
    const ctx = { spidToElementId: new Map([['3','e3']]), report: { warn } as any };
    const anims = parseTiming(/* unmapped presetID */, ctx);
    expect(anims[0].pptxPreset).toBeDefined();
    expect(warn).toHaveBeenCalledWith('animation-preset-unmapped', expect.anything());
  });
  it('drops interactiveSeq triggers with a warning', () => {
    const warn = vi.fn();
    const ctx = { spidToElementId: new Map(), report: { warn } as any };
    parseTiming(/* timing with interactiveSeq */, ctx);
    expect(warn).toHaveBeenCalledWith('animation-trigger-dropped', expect.anything());
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `parseTiming`:
  - Walk `tnLst > par(tmRoot) > childTnLst > seq[nodeType="mainSeq"]`. For each effect `par` under it: read `cTn.presetClass`/`presetID`/`presetSubtype`, `cTn.nodeType` (`clickEffect→onClick`, `withEffect→withPrev`, `afterEffect→afterPrev`), `cTn.dur→durationMs`, child `cond.delay→delayMs`, `accel`/`decel → easing` (both high → `easeInOut`, only accel → `easeIn`, only decel → `easeOut`, else `linear`).
  - Resolve target via `tgtEl>spTgt@spid → spidToElementId`. Skip (warn `animation-target-missing`) if unresolved.
  - `mapPreset(...)`: if non-null, build a `SlideAnimation`; if null, build one preserving `pptxPreset` (and `motionPath` if the effect is `animMotion`) with a best-guess `effect` (`appear`) marked preview-only, and `report.warn('animation-preset-unmapped', …)`.
  - `txEl`/paragraph build conditions → `byParagraph: true`.
  - `seq[nodeType="interactiveSeq"]` present → `report.warn('animation-trigger-dropped', …)`, skip.
  - audio/video time nodes → `report.warn('animation-media-dropped', …)`, skip.
  - Attach result as `slide.animations` in the caller (only if non-empty).

- [ ] **Step 4:** Add the warning keys to `report.ts` (`transition-approximated`, `animation-preset-unmapped`, `animation-target-missing`, `animation-trigger-dropped`, `animation-media-dropped`).

- [ ] **Step 5: Run → PASS** then `pnpm slides build`.
- [ ] **Step 6: Commit** `git commit -am "Import PPTX object animations (map + preserve + report)"`

---

### Task 24: spid↔elementId table during shape parse

**Files:**
- Modify: `packages/slides/src/import/pptx/shape.ts` (record each created element's source spid)
- Modify: `packages/slides/src/import/pptx/slide.ts` (build the map, pass to `parseTiming`)
- Test: covered by an end-to-end `import/pptx/*.e2e`-style fixture test if the package has one; else extend `timing.test.ts` with a small integration that runs `parseSpTree` then `parseTiming`.

- [ ] **Step 1:** In `parseSpTree`, capture each shape's `<p:nvSpPr><p:cNvPr id="N">` and map `N → createdElementId` into a `Map<string,string>` carried on the parse `ctx`.
- [ ] **Step 2:** In `parseSlide`, after `parseSpTree`, call `parseTiming(timingEl, { spidToElementId, report })` and assign the returned array to `slide.animations` when non-empty.
- [ ] **Step 3:** Add/extend a fixture test importing a tiny `.pptx`-shaped input (or synthetic slide XML + timing XML) and assert the animation's `elementId` matches the created element.
- [ ] **Step 4: Run → PASS** then `pnpm slides build`.
- [ ] **Step 5: Commit** `git commit -am "Resolve animation targets via spid↔element map"`

---

## Finalization

### Task 25: Docs, lessons, verify, archive

**Files:**
- Modify: `docs/design/slides/slides-animation.md` (mark phases shipped; note any approximations the implementation settled on)
- Create: `docs/tasks/active/20260620-slides-animation-lessons.md`
- Modify: `docs/tasks/README.md` (index entry for this task's todo + lessons)
- Modify: `packages/slides/README.md` and/or `docs/design/slides/slides-presentation-mode.md` (remove the "cuts only / no transitions" non-goal now that motion ships)

- [ ] **Step 1:** Update the presentation-mode doc + slides.md non-goals to point at `slides-animation.md` (they listed animations as non-goals).
- [ ] **Step 2:** Write the lessons file capturing anything non-obvious found during implementation (e.g. exact `drawElement` signature, presenter RAF seam, Yorkie array reorder quirks).
- [ ] **Step 3: Run the full gate**

Run: `pnpm verify:fast` then `pnpm slides build` then `pnpm verify:self`
Expected: all green.

- [ ] **Step 4: Browser smoke**

Run: `pnpm verify:browser:docker` (or manual `pnpm dev`): author transition + multi-step animation, present it, import a PPTX with animations and confirm the report lists drops without crashing.

- [ ] **Step 5: Archive + index**

Run: `pnpm tasks:archive && pnpm tasks:index`

- [ ] **Step 6: Commit**

```bash
git add docs/ packages/slides/README.md
git commit -m "Document slides motion; capture lessons; archive task"
```

- [ ] **Step 7: Open PR** with Summary + Test plan; request `/code-review` over the full branch diff before merge (CLAUDE.md task workflow).

---

## Self-Review notes (author)

- Spec coverage: data model (T1), CRDT/store (T2–T3), Motion panel transitions + animations + badges (T4–T7), engine easing/effects/timeline/sample/transition/player (T8–T13), render injection (T14–T15), presenter playback (T16), editor Play (T17), advanced UI + by-paragraph + composition (T18–T20), PPTX transitions/animations/preservation/report (T21–T24), docs/non-goal removal/lessons/archive (T25). All design sections map to a task.
- Type consistency: `AnimState` shape, `composeAnimStates`, `compileTimeline`/`Step`/`ScheduledAnim`, `AnimationPlayer.advance(): boolean`, `sampleStep(step, elapsedMs, {w,h})`, `mapPreset(...): {...}|null`, store ops `setSlideTransition/addAnimation/updateAnimation/removeAnimation/reorderAnimation` are referenced consistently across tasks.
- Known interface lookups the implementer must confirm against the live code (flagged inline): `MemSlidesStore` construction helper, exact `drawElement` parameter order, presenter RAF/advance test seam, Yorkie array mutation idiom, the PPTX XML parser node shape. These are existing-codebase facts, not new design.
