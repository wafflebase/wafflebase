# Board SP4 Editing Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the board infinite canvas object/text formatting, undo/redo buttons, a zoom control, two missing canvas-menu entries, and live peer cursors — by composing controls the slides toolbar already ships against the board's existing `SlidesStore` adapter.

**Architecture:** `YorkieBoardStore.read()` returns a complete `SlidesDocument` whose single synthetic slide (`id === 'board'`) is the board, so slides' leaf toolbar controls and `getToolbarState()` operate on a board unmodified. SP4 composes those leaf controls board-side (rather than reusing the `SlidesToolbar`/`ObjectSection` shells, which mount slide-scoped controls the board store throws `notSupported` on), adds a board-local `ZoomController`, and extends the slides peer overlay with an additive cursor field.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, Tailwind + Radix, Yorkie CRDT. Packages: `@wafflebase/slides` (scene engine), `@wafflebase/board` (viewport/model), `packages/frontend` (React mount + CRDT adapter).

**Spec:** `docs/design/board/board-editing-parity.md` (committed as `a0917ccf3`)

**Lessons:** `docs/tasks/active/20260806-board-sp4-editing-parity-lessons.md` (written in Task 7)

## Global Constraints

- **Branch:** `board-sp4-editing-parity` (already created, spec already committed as `a0917ccf3`). Never push to `main`.
- **Every slides-side change must be additive with a slides-preserving default.** `minAlignSelection ?? 1`, absent `onFitToContent`, empty `cursors`. A slides mount must behave as before, with one deliberate exception: the `Select all` context-menu entry is visible and functional on slides too — it dispatches the existing `Mod+A` rule, so it adds an affordance without changing any behavior.
- **Pre-commit gate:** `pnpm verify:fast` green before every commit. If it fails with a phantom `TextBoxEditorAPI` / `stepSelectionFontSize` typecheck error, the docs `dist` is stale — run `pnpm --filter @wafflebase/docs build` and re-run. This is a known gate gap, not a real error.
- **Commit format:** subject ≤ 70 chars describing *what* changed, blank line, body explaining *why*. Use multiple `-m` flags for real newlines. End with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **All repo artifacts in English** — code, comments, commit messages, docs.
- **Tests are colocated** next to the module under test (`foo.ts` → `foo.test.ts`), Vitest, `describe`/`it`/`expect` imported explicitly from `vitest`.
- **Board never has tables.** The `table` selection branch must render nothing; never mount `TableControls` on a board.
- **Board zoom range is `[0.1, 8]`** (`packages/board/src/view/viewport.ts` `zoomAt` defaults). Slides' `MIN_ZOOM`/`MAX_ZOOM` (`[0.25, 4]`) do NOT apply to the board.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/slides/src/view/editor/peers.ts` | `PeerView.cursor` in, `PeerOverlays.cursors` out | 1 |
| `packages/slides/src/view/editor/peers.test.ts` (new) | Cursor mapping + the "slides unaffected" guard | 1 |
| `packages/slides/src/view/editor/overlay.ts` | Paint cursor dot + name tag | 1 |
| `packages/frontend/src/app/slides/toolbar/arrange-menu.tsx` | `minAlignSelection` prop | 2 |
| `packages/frontend/src/app/slides/toolbar/arrange-menu.test.tsx` (new) | Align gating at sizes 1 / 2 | 2 |
| `packages/slides/src/view/editor/editor.ts` | `onFitToContent` option + 2 canvas-menu entries | 3 |
| `packages/frontend/src/app/board/board-zoom.ts` (new) | Board `ZoomController` + FIT/preset viewport math | 4 |
| `packages/frontend/src/app/board/board-zoom.test.ts` (new) | Clamp, presets, FIT, wheel write-back | 4 |
| `packages/frontend/src/app/board/board-toolbar.tsx` | Morphing shell: globals + insert + contextual | 5 |
| `packages/frontend/src/app/board/board-toolbar-state.test.ts` (new) | `getToolbarState` transitions on a board store | 5 |
| `packages/frontend/src/app/board/board-view.tsx` | Lift `store` to state; wire zoom, fit hook, cursor publish | 4, 5, 6 |

Tasks 1–3 are the slides-side additive surface and land first, so the slides suite gates them before any board code depends on them. Tasks 4–6 are board-local.

---

### Task 1: Peer cursors in the slides overlay

**Files:**
- Modify: `packages/slides/src/view/editor/peers.ts`
- Modify: `packages/slides/src/view/editor/overlay.ts:882-960` (`renderPeerOverlays`)
- Test: `packages/slides/src/view/editor/peers.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `PeerView.cursor?: { x: number; y: number }` — world coords, optional.
  - `interface PeerCursor { x: number; y: number; color: string; label: string }`
  - `PeerOverlays.cursors: PeerCursor[]` — always present, empty when no peer publishes a cursor.

Background: `PeerOverlays` is painted into a **DOM overlay** (`overlay: HTMLDivElement`), not the canvas — cursors are appended `div`s like the existing rings and labels. `computePeerOverlays` filters peers by `activeSlideId === currentSlideId`; cursors use the same filter.

- [x] **Step 1: Write the failing test**

Create `packages/slides/src/view/editor/peers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computePeerOverlays, type PeerView } from './peers';

/** No element frames resolve — isolates cursor behavior from ring behavior. */
const noFrames = () => undefined;

describe('computePeerOverlays cursors', () => {
  it('maps a peer cursor into a coloured, labelled cursor entry', () => {
    const peers: PeerView[] = [
      {
        clientID: 'c1',
        color: '#ff0000',
        label: 'Ada',
        activeSlideId: 's1',
        cursor: { x: 120, y: 340 },
      },
    ];

    const out = computePeerOverlays(peers, 's1', noFrames);

    expect(out.cursors).toEqual([
      { x: 120, y: 340, color: '#ff0000', label: 'Ada' },
    ]);
  });

  it('yields no cursors when peers publish none (slides regression guard)', () => {
    const peers: PeerView[] = [
      {
        clientID: 'c1',
        color: '#ff0000',
        label: 'Ada',
        activeSlideId: 's1',
        selectedElementIds: ['e1'],
      },
    ];

    const out = computePeerOverlays(peers, 's1', noFrames);

    expect(out.cursors).toEqual([]);
  });

  it('ignores a cursor from a peer on another slide', () => {
    const peers: PeerView[] = [
      {
        clientID: 'c1',
        color: '#ff0000',
        label: 'Ada',
        activeSlideId: 's2',
        cursor: { x: 10, y: 10 },
      },
    ];

    const out = computePeerOverlays(peers, 's1', noFrames);

    expect(out.cursors).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- peers.test.ts`
Expected: FAIL — `out.cursors` is `undefined` (property does not exist on `PeerOverlays`), and TypeScript rejects `cursor` on `PeerView`.

- [x] **Step 3: Extend the peers model and mapping**

In `packages/slides/src/view/editor/peers.ts`, add to the `PeerView` interface (after `selectedTableCells`):

```ts
  /**
   * Live pointer position in WORLD (slide-root) coords, when the peer
   * publishes one. Slides does not publish it today — only the board
   * (an unbounded plane, where a bare selection ring is not enough to
   * tell where a collaborator is working) — so `cursors` stays empty on
   * a slides mount and this is a no-op there.
   */
  cursor?: { x: number; y: number };
```

Add the cursor spec type next to `PeerRing` / `PeerLabel`:

```ts
/** A peer's live pointer, anchored at a world-coord point. */
export interface PeerCursor {
  x: number;
  y: number;
  color: string;
  label: string;
}
```

Add to `PeerOverlays`:

```ts
export interface PeerOverlays {
  rings: PeerRing[];
  labels: PeerLabel[];
  guides: PeerGuideLine[];
  cellRects: PeerCellRect[];
  cursors: PeerCursor[];
}
```

In `computePeerOverlays`, declare the accumulator alongside the others:

```ts
  const cursors: PeerCursor[] = [];
```

Update the early return:

```ts
  if (!currentSlideId) return { rings, labels, guides, cellRects, cursors };
```

Inside the per-peer loop, after the `draggingGuide` block and **before** the `if (anchor)` label block:

```ts
    if (peer.cursor) {
      cursors.push({
        x: peer.cursor.x,
        y: peer.cursor.y,
        color: peer.color,
        label: peer.label,
      });
    }
```

Update the final return:

```ts
  return { rings, labels, guides, cellRects, cursors };
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- peers.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Paint the cursors in the overlay**

In `packages/slides/src/view/editor/overlay.ts`, at the end of `renderPeerOverlays` (after the `peers.labels` loop), append:

```ts
  // Peer cursors: a small dot at the peer's live pointer with its name
  // tag beside it. Painted last so a cursor is never hidden under a
  // ring or another peer's tag. World coords → screen via the same
  // `scale`/`pan` the rings use, so a cursor and its owner's selection
  // ring can never drift apart during a pan or zoom.
  for (const cursor of peers.cursors) {
    const el = document.createElement('div');
    el.className = 'wfb-slides-peer-cursor';
    el.style.position = 'absolute';
    el.style.left = `${cursor.x * scale + px}px`;
    el.style.top = `${cursor.y * scale + py}px`;
    el.style.width = '10px';
    el.style.height = '10px';
    el.style.borderRadius = '50%';
    el.style.background = cursor.color;
    el.style.border = '2px solid #fff';
    el.style.boxSizing = 'border-box';
    el.style.pointerEvents = 'none';
    // Anchor the dot's centre on the pointer position.
    el.style.transform = 'translate(-50%, -50%)';
    overlay.appendChild(el);

    const tag = document.createElement('div');
    tag.className = 'wfb-slides-peer-cursor-label';
    tag.textContent = cursor.label;
    tag.style.position = 'absolute';
    tag.style.left = `${cursor.x * scale + px + 10}px`;
    tag.style.top = `${cursor.y * scale + py + 10}px`;
    tag.style.background = cursor.color;
    tag.style.color = '#fff';
    tag.style.font = '11px/1.4 system-ui, -apple-system, sans-serif';
    tag.style.padding = '1px 6px';
    tag.style.borderRadius = '3px';
    tag.style.whiteSpace = 'nowrap';
    tag.style.maxWidth = '140px';
    tag.style.overflow = 'hidden';
    tag.style.textOverflow = 'ellipsis';
    tag.style.pointerEvents = 'none';
    overlay.appendChild(tag);
  }
```

- [x] **Step 6: Run the full slides suite (the regression gate)**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS, with no pre-existing test newly failing. `cursors` is empty on every slides path, so no overlay snapshot or count assertion should move.

- [x] **Step 7: Commit**

```bash
git add packages/slides/src/view/editor/peers.ts \
        packages/slides/src/view/editor/peers.test.ts \
        packages/slides/src/view/editor/overlay.ts
git commit -m "Add an optional peer cursor to the slides peer overlay" \
  -m "The board is an unbounded plane, so a collaborator's selection ring
alone does not say where they are working — a board peer can be
editing far outside the current viewport with nothing on screen to
show it. Peer cursors need a place to be painted.

They belong in the existing overlay pass rather than a board-local
DOM layer: rings and cursors then share one transform path, so a
peer's dot cannot drift away from their selection ring during a fast
pan or zoom.

Slides never populates \`cursor\`, so \`cursors\` is always empty there
and the new paint loop is a no-op — the change is unreachable from a
slides mount." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Gate Align behind a minimum selection size

**Files:**
- Modify: `packages/frontend/src/app/slides/toolbar/arrange-menu.tsx:23-45`
- Test: `packages/frontend/src/app/slides/toolbar/arrange-menu.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `ArrangeMenuProps.minAlignSelection?: number` (default `1`). Task 5 passes `2` from the board.

Background: `SlidesEditor.align()` aligns to the combined bounding box of the selection when ≥ 2 elements are selected, but to **the slide canvas (1920 × 1080)** when exactly 1 is (`packages/slides/src/view/editor/editor.ts:511-513`). On an unbounded board that second rule teleports a lone element into a phantom rectangle near the world origin. `align()` itself is not changed — the board simply never reaches that branch.

- [x] **Step 1: Write the failing test**

Create `packages/frontend/src/app/slides/toolbar/arrange-menu.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrangeMenu } from "./arrange-menu";

/**
 * The Align submenu trigger is the observable proxy for `canAlign` —
 * it and every item under it share the same disabled flag.
 */
async function openArrange() {
  await userEvent.click(screen.getByRole("button", { name: /arrange/i }));
}

describe("ArrangeMenu minAlignSelection", () => {
  it("enables Align at a single selection by default (slides behavior)", async () => {
    render(<ArrangeMenu editor={{} as never} selectionSize={1} />);
    await openArrange();
    expect(screen.getByText("Align").closest("[role]")).not.toHaveAttribute(
      "data-disabled",
    );
  });

  it("disables Align at a single selection when minAlignSelection is 2", async () => {
    render(
      <ArrangeMenu editor={{} as never} selectionSize={1} minAlignSelection={2} />,
    );
    await openArrange();
    expect(screen.getByText("Align").closest("[role]")).toHaveAttribute(
      "data-disabled",
    );
  });

  it("enables Align at two selected elements when minAlignSelection is 2", async () => {
    render(
      <ArrangeMenu editor={{} as never} selectionSize={2} minAlignSelection={2} />,
    );
    await openArrange();
    expect(screen.getByText("Align").closest("[role]")).not.toHaveAttribute(
      "data-disabled",
    );
  });
});
```

If the `Arrange` trigger's accessible name or the submenu's disabled attribute differs from the above, read `arrange-menu.tsx` and adjust the queries to match the real markup — but keep all three cases and keep them asserting on rendered output, not on internals.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- arrange-menu`
Expected: FAIL — TypeScript rejects the unknown `minAlignSelection` prop; the second case renders Align enabled.

- [x] **Step 3: Add the prop**

In `packages/frontend/src/app/slides/toolbar/arrange-menu.tsx`, add to `ArrangeMenuProps` (after `selectionSize`):

```ts
  /**
   * Minimum selection size for Align to be enabled. Defaults to 1,
   * which is the slides behavior: `editor.align()` aligns a lone
   * element to the 1920x1080 slide canvas. A board is an unbounded
   * plane with no such rect, so a board mount passes 2 and only ever
   * reaches `align()`'s selection-bounding-box branch.
   */
  minAlignSelection?: number;
```

Update the signature and the `canAlign` computation:

```ts
export function ArrangeMenu({
  editor,
  selectionSize,
  canUngroup = false,
  minAlignSelection = 1,
}: ArrangeMenuProps) {
  const canAlign = !!editor && selectionSize >= minAlignSelection;
```

Leave `canDistribute` (`>= 3`) and `canGroup` (`>= 2`) untouched.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- arrange-menu`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/arrange-menu.tsx \
        packages/frontend/src/app/slides/toolbar/arrange-menu.test.tsx
git commit -m "Let Arrange raise the selection size Align requires" \
  -m "editor.align() aligns to the selection's bounding box at two or
more elements, but to the 1920x1080 slide canvas at exactly one. The
board is an unbounded plane where that rect does not exist, so
aligning a lone element there would teleport it into a phantom box
near the world origin.

Raising the threshold is preferable to changing align(): the slide
rule is correct for slides, and the board simply never reaches that
branch. Defaulting to 1 leaves slides untouched." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Canvas menu — Select all and Fit to content

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` — `SlidesEditorOptions` (near `suppressSlideChrome`, ~line 309) and `canvasContextItems` (~line 3273)

**Interfaces:**
- Consumes: nothing.
- Produces: `SlidesEditorOptions.onFitToContent?: () => void`. Task 5 supplies it from the board mount.

Background: the engine already builds the canvas context menu, and board mounts already pass `suppressSlideChrome: true`. `Mod+A` select-all already exists as a keyboard rule (`shortcuts-catalog.ts:41`: "Select all elements on the current slide"), so the menu entry dispatches it exactly the way the existing Copy / Cut / Paste entries dispatch theirs — no new selection logic.

- [x] **Step 1: Add the `onFitToContent` option**

In `packages/slides/src/view/editor/editor.ts`, add to `SlidesEditorOptions` immediately after `suppressSlideChrome`:

```ts
  /**
   * Host hook for the empty-canvas menu's "Fit to content". Framing the
   * scene is a viewport concern the editor does not own — slides fits to
   * its column, the board fits all elements — so the host supplies it.
   * Omitted on a slides mount, where the entry is skipped entirely.
   */
  onFitToContent?: () => void;
```

- [x] **Step 2: Add the two menu entries**

In `canvasContextItems`, replace the opening `items` declaration:

```ts
  private canvasContextItems(x: number, y: number): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: 'Paste', run: () => this.dispatchKey('v', { meta: true }) },
      { label: 'Select all', run: () => this.dispatchKey('a', { meta: true }) },
    ];
    // Framing the scene is host-owned (see `onFitToContent`), so the
    // entry only appears when a host supplies the hook.
    if (this.options.onFitToContent) {
      const fit = this.options.onFitToContent;
      items.push({ label: 'Fit to content', run: () => fit() });
    }
```

Leave the rest of the method (the `suppressSlideChrome` block and the Insert entries) unchanged.

- [x] **Step 3: Typecheck**

Run: `pnpm --filter @wafflebase/slides typecheck`
Expected: PASS. If it fails on `TextBoxEditorAPI` / `stepSelectionFontSize`, run `pnpm --filter @wafflebase/docs build` first (stale-dist gate gap) and re-run.

- [x] **Step 4: Run the full slides suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS. A slides mount passes no `onFitToContent`, so its canvas menu gains only `Select all`.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts
git commit -m "Add Select all and a host Fit to content to the canvas menu" \
  -m "The empty-canvas menu offered Paste and three Insert entries but no
way to reach the whole scene. Select all already existed as a Mod+A
keyboard rule with no menu affordance, so the entry just dispatches
it rather than duplicating selection logic.

Fit to content is a viewport concern the editor does not own — slides
fits to its column, a board fits all its elements — so it arrives as
an optional host hook and the entry is skipped when no host supplies
one, keeping the slides menu unchanged." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Board zoom controller

**Files:**
- Create: `packages/frontend/src/app/board/board-zoom.ts`
- Test: `packages/frontend/src/app/board/board-zoom.test.ts` (create)

**Interfaces:**
- Consumes: `ZoomController`, `FIT_ZOOM`, `ZOOM_PRESETS` from `../slides/zoom-controller`; `Viewport`, `zoomAt` from `@wafflebase/board`; `fitViewportToScene` from `./fit-to-content`; `sceneBounds` from `./minimap-geometry`.
- Produces:
  - `BOARD_MIN_ZOOM = 0.1`, `BOARD_MAX_ZOOM = 8`
  - `createBoardZoomController(initial?: number): ZoomController`
  - `applyZoomValue(vp: Viewport, value: number, host: { w: number; h: number }, frames: Frame[]): Viewport | undefined`

`applyZoomValue` is the pure heart: given the current viewport and a controller value, return the viewport to commit. `FIT_ZOOM` frames all content (reusing `fitViewportToScene`, the repeatable form — **not** `createFitToContentOnce`, which is the one-shot open latch). A preset zooms about the host centre so content does not slide sideways. `undefined` means "nothing to do" (empty scene on FIT, or a zero-area host).

- [x] **Step 1: Write the failing test**

Create `packages/frontend/src/app/board/board-zoom.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Frame } from "@wafflebase/slides";
import { DEFAULT_VIEWPORT } from "@wafflebase/board";
import { FIT_ZOOM } from "../slides/zoom-controller";
import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  applyZoomValue,
  createBoardZoomController,
} from "./board-zoom";

const host = { w: 800, h: 600 };
const frames: Frame[] = [{ x: 0, y: 0, w: 400, h: 300, rotation: 0 }];

describe("createBoardZoomController", () => {
  it("clamps to the board range, not the slides range", () => {
    const c = createBoardZoomController();
    c.set(0.15);
    expect(c.get()).toBe(0.15); // slides would have clamped up to 0.25
    c.set(6);
    expect(c.get()).toBe(6); // slides would have clamped down to 4
    c.set(0.01);
    expect(c.get()).toBe(BOARD_MIN_ZOOM);
    c.set(99);
    expect(c.get()).toBe(BOARD_MAX_ZOOM);
  });

  it("preserves the FIT sentinel through clamping", () => {
    const c = createBoardZoomController();
    c.set(2);
    c.set(FIT_ZOOM);
    expect(c.get()).toBe(FIT_ZOOM);
  });

  it("notifies subscribers only when the value actually changes", () => {
    const c = createBoardZoomController(1);
    let calls = 0;
    const off = c.subscribe(() => calls++);
    c.set(1);
    expect(calls).toBe(0);
    c.set(2);
    expect(calls).toBe(1);
    off();
    c.set(3);
    expect(calls).toBe(1);
  });
});

describe("applyZoomValue", () => {
  it("zooms to a preset about the host centre", () => {
    const next = applyZoomValue(DEFAULT_VIEWPORT, 2, host, frames);
    expect(next).toBeDefined();
    expect(next!.zoom).toBe(2);
    // The world point under the host centre must stay under it.
    const centreWorldBefore = {
      x: (host.w / 2 - DEFAULT_VIEWPORT.panX) / DEFAULT_VIEWPORT.zoom,
      y: (host.h / 2 - DEFAULT_VIEWPORT.panY) / DEFAULT_VIEWPORT.zoom,
    };
    expect(centreWorldBefore.x * next!.zoom + next!.panX).toBeCloseTo(host.w / 2);
    expect(centreWorldBefore.y * next!.zoom + next!.panY).toBeCloseTo(host.h / 2);
  });

  it("frames all content on FIT", () => {
    const next = applyZoomValue(DEFAULT_VIEWPORT, FIT_ZOOM, host, frames);
    expect(next).toBeDefined();
    // The scene centre (200, 150) lands at the host centre.
    expect(200 * next!.zoom + next!.panX).toBeCloseTo(host.w / 2);
    expect(150 * next!.zoom + next!.panY).toBeCloseTo(host.h / 2);
  });

  it("returns undefined on FIT with an empty scene", () => {
    expect(applyZoomValue(DEFAULT_VIEWPORT, FIT_ZOOM, host, [])).toBeUndefined();
  });

  it("returns undefined for a zero-area host", () => {
    expect(applyZoomValue(DEFAULT_VIEWPORT, 2, { w: 0, h: 0 }, frames)).toBeUndefined();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- board-zoom`
Expected: FAIL — `./board-zoom` does not exist.

- [x] **Step 3: Write the implementation**

Create `packages/frontend/src/app/board/board-zoom.ts`:

```ts
import type { Frame } from "@wafflebase/slides";
import { zoomAt, type Viewport } from "@wafflebase/board";
import { FIT_ZOOM, type ZoomController } from "../slides/zoom-controller";
import { fitViewportToScene } from "./fit-to-content";
import { sceneBounds } from "./minimap-geometry";

/**
 * The board's own zoom range — the defaults `zoomAt` clamps to in
 * `@wafflebase/board`'s viewport module. Deliberately wider than slides'
 * [0.25, 4]: an infinite plane is routinely surveyed further out and
 * inspected further in than a single slide.
 */
export const BOARD_MIN_ZOOM = 0.1;
export const BOARD_MAX_ZOOM = 8;

function clamp(value: number): number {
  if (value === FIT_ZOOM) return FIT_ZOOM;
  return Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, value));
}

/**
 * Board zoom controller, satisfying the same {@link ZoomController}
 * interface `ZoomControl` renders against so the slides dropdown is
 * reused unchanged.
 *
 * Board-local rather than slides' `createZoomController` purely because
 * of the clamp: that factory pins values into [0.25, 4], which would
 * clip the wheel-zoom write-back below 0.25 or above 4 and leave the
 * dropdown reporting a scale the canvas is not at.
 *
 * The controller is an intent/label channel, never a second copy of the
 * scale — the viewport in `BoardView` stays the single source of truth.
 * Session-only, like the slides controller: no Yorkie, no localStorage.
 */
export function createBoardZoomController(
  initial: number = FIT_ZOOM,
): ZoomController {
  let value = clamp(initial);
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      const next = clamp(v);
      if (next === value) return;
      value = next;
      for (const cb of listeners) cb();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/**
 * Resolve a controller value into the viewport to commit.
 *
 * - `FIT_ZOOM` frames every element (the repeatable form of the board's
 *   open-time fit — `createFitToContentOnce` is a one-shot latch and
 *   must not be reused here).
 * - A preset zooms about the HOST CENTRE, so the content the user is
 *   looking at stays put instead of sliding toward a corner.
 *
 * `undefined` means "nothing to commit": an empty scene on FIT, or a
 * host with no area yet. Callers must treat it as a no-op, never as a
 * viewport reset.
 */
export function applyZoomValue(
  vp: Viewport,
  value: number,
  host: { w: number; h: number },
  frames: Frame[],
): Viewport | undefined {
  if (!(host.w > 0) || !(host.h > 0)) return undefined;
  if (value === FIT_ZOOM) {
    return fitViewportToScene(sceneBounds(frames), host);
  }
  const target = clamp(value);
  // zoomAt takes a multiplicative factor; convert the absolute target.
  return zoomAt(
    vp,
    { x: host.w / 2, y: host.h / 2 },
    target / vp.zoom,
    BOARD_MIN_ZOOM,
    BOARD_MAX_ZOOM,
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- board-zoom`
Expected: PASS (7 tests).

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/board/board-zoom.ts \
        packages/frontend/src/app/board/board-zoom.test.ts
git commit -m "Add a board zoom controller with a fit-all-content Fit" \
  -m "The board had no zoom affordance at all: no readout, no presets,
and the only fit was the one-shot framing that runs when the document
opens. A user who wheel-zoomed into a corner had no way back out
short of scrolling.

The controller is board-local rather than the slides factory because
the clamps differ — the board viewport allows [0.1, 8] where slides
allows [0.25, 4] — and reusing the slides clamp would clip the
wheel-zoom write-back, leaving the dropdown reporting a scale the
canvas is not at. It stays an intent/label channel; the viewport
remains the single source of truth." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The morphing board toolbar

**Files:**
- Modify: `packages/frontend/src/app/board/board-toolbar.tsx`
- Modify: `packages/frontend/src/app/board/board-view.tsx` (lift `store` into state; pass `store`, `zoomController`, `onFitToContent`)
- Test: `packages/frontend/src/app/board/board-toolbar-state.test.ts` (create)

**Interfaces:**
- Consumes: `minAlignSelection` (Task 2), `createBoardZoomController` / `applyZoomValue` (Task 4).
- Produces: `BoardToolbarProps` gains `store?: SlidesStore | null` and `zoomController?: ZoomController | null`.

Target layout:

```text
[↶][↷] │ [Zoom ▾] │ [Select][Text][Sticky▾][Image][Shape▾][Line▾] │ ‹contextual›
```

Contextual routing on `getToolbarState(editor, store)`:

| State | Rendered |
| --- | --- |
| `idle` | nothing |
| `object` + `shape` / `connector` | `ShapeControls` + `ArrangeMenu` |
| `object` + `image` | `ImageControls` + `ArrangeMenu` |
| `object` + `text-element` | `TextElementControls` + `ArrangeMenu` |
| `object` + `mixed` | `ArrangeMenu` only |
| `object` + `table` | nothing (unreachable on a board) |
| `text-edit` | `TextEditSection` |

`ObjectSection` is **not** reused — it hardcodes the slides `InsertGroup` (with the table picker the board omits) and routes `table` into `TableControls`.

- [x] **Step 1: Write the failing test**

Create `packages/frontend/src/app/board/board-toolbar-state.test.ts`. This pins the contract the toolbar depends on — that slides' `getToolbarState` reads a board store correctly:

```ts
import { describe, expect, it } from "vitest";
import type { SlidesDocument, SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";
import { getToolbarState } from "../slides/toolbar/state";

/** Minimal board-shaped store: one synthetic slide holding `elements`. */
function boardStore(elements: SlidesDocument["slides"][number]["elements"]) {
  return {
    read: () => ({ slides: [{ id: SYNTHETIC_SLIDE_ID, elements }] }),
  } as unknown as SlidesStore;
}

/** Minimal editor stub exposing only what `getToolbarState` reads. */
function editorStub(over: Partial<Record<string, unknown>> = {}) {
  return {
    isTextEditing: () => false,
    getEditingElementId: () => null,
    getActiveTextEditor: () => null,
    getSelection: () => [],
    getCurrentSlideId: () => SYNTHETIC_SLIDE_ID,
    getCellSelection: () => null,
    ...over,
  } as unknown as SlidesEditor;
}

const shape = { id: "e1", type: "shape", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: {} };
const text = { id: "e2", type: "text", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: {} };

describe("getToolbarState on a board store", () => {
  it("is idle with nothing selected", () => {
    const state = getToolbarState(editorStub(), boardStore([shape] as never));
    expect(state.kind).toBe("idle");
  });

  it("reports a shape selection", () => {
    const state = getToolbarState(
      editorStub({ getSelection: () => ["e1"] }),
      boardStore([shape] as never),
    );
    expect(state).toMatchObject({ kind: "object", selectionType: "shape", ids: ["e1"] });
  });

  it("reports a text-element selection", () => {
    const state = getToolbarState(
      editorStub({ getSelection: () => ["e2"] }),
      boardStore([text] as never),
    );
    expect(state).toMatchObject({ kind: "object", selectionType: "text-element" });
  });

  it("reports a mixed selection", () => {
    const state = getToolbarState(
      editorStub({ getSelection: () => ["e1", "e2"] }),
      boardStore([shape, text] as never),
    );
    expect(state).toMatchObject({ kind: "object", selectionType: "mixed" });
  });

  it("reports text-edit while editing a text box", () => {
    const textEditor = { marker: true };
    const state = getToolbarState(
      editorStub({
        isTextEditing: () => true,
        getEditingElementId: () => "e2",
        getActiveTextEditor: () => textEditor,
      }),
      boardStore([text] as never),
    );
    expect(state).toMatchObject({ kind: "text-edit", elementId: "e2" });
  });
});
```

- [x] **Step 2: Run test to verify it fails or passes**

Run: `pnpm --filter @wafflebase/frontend test -- board-toolbar-state`
Expected: PASS — this is a **characterization test** locking in behavior the toolbar relies on. If any case fails, that is a real incompatibility between `getToolbarState` and the board store; stop and report it rather than editing the test to match.

- [x] **Step 3: Rebuild the toolbar**

Rewrite `packages/frontend/src/app/board/board-toolbar.tsx`. Keep the existing Select / Text / Sticky ▾ / Image / Shape ▾ / Line ▾ block **exactly as it is today** (including the `onCloseAutoFocus` sticky-color deferral and the "no table picker" doc comment) and add around it:

```tsx
import type { SlidesEditor, SlidesStore, InsertKind } from "@wafflebase/slides";
import type { ZoomController } from "../slides/zoom-controller";
import { getToolbarState, type ToolbarState } from "../slides/toolbar/state";
import { UndoRedoGroup } from "../slides/toolbar/global-controls";
import { ZoomControl } from "../slides/toolbar/zoom-control";
import { ShapeControls } from "../slides/toolbar/shape-controls";
import { ImageControls } from "../slides/toolbar/image-controls";
import { TextElementControls } from "../slides/toolbar/text-element-controls";
import { TextEditSection } from "../slides/toolbar/text-edit-section";
import { ArrangeMenu } from "../slides/toolbar/arrange-menu";
import { ToolbarSeparator } from "@/components/ui/toolbar";
```

Extend the props:

```tsx
export interface BoardToolbarProps {
  editor: SlidesEditor | null;
  /**
   * The board's `SlidesStore` adapter. Needed by the contextual
   * controls (they read element data through it) and by Undo/Redo.
   */
  store?: SlidesStore | null;
  zoomController?: ZoomController | null;
  disabled?: boolean;
  onInsertSticky?: (colorValue: string) => void;
  onInsertImage?: (file: File) => void;
}
```

Track the contextual state alongside the existing `insertMode` state:

```tsx
  const [state, setState] = useState<ToolbarState>(() =>
    getToolbarState(editor, store ?? null),
  );

  useEffect(() => {
    if (!editor) {
      setState(getToolbarState(null, store ?? null));
      return;
    }
    const refresh = () => setState(getToolbarState(editor, store ?? null));
    refresh();
    const offs = [
      editor.onSelectionChange(refresh),
      editor.onTextEditingChange(refresh),
      store?.onChange?.(refresh) ?? (() => {}),
    ];
    return () => offs.forEach((off) => off());
  }, [editor, store]);
```

`onCurrentSlideChange` / `onCellSelectionChange` are deliberately not subscribed: a board has one fixed synthetic slide and no tables.

Resolve the theme from the store's synthesized deck:

```tsx
  // The board's synthetic deck pins `defaultLight` (see
  // `boardToSlidesDocument`), which is also what the renderer resolves
  // themed colours against — so the picker's swatches and the painted
  // result agree. A board has no theme switcher.
  const theme = store?.read().themes[0] ?? null;
```

Render the globals before the insert block:

```tsx
      <UndoRedoGroup store={store ?? null} />
      <ToolbarSeparator className="mx-1" />
      <ZoomControl controller={zoomController} />
      <ToolbarSeparator className="mx-1" />
```

…the existing insert controls…

…then the contextual zone at the end:

```tsx
      {state.kind === "object" && (
        <>
          <ToolbarSeparator className="mx-1" />
          {(state.selectionType === "shape" ||
            state.selectionType === "connector") && (
            <ShapeControls editor={editor} store={store ?? null} theme={theme} ids={state.ids} />
          )}
          {state.selectionType === "image" && (
            <ImageControls editor={editor} store={store ?? null} ids={state.ids} />
          )}
          {state.selectionType === "text-element" && (
            <TextElementControls
              editor={editor}
              store={store ?? null}
              theme={theme}
              ids={state.ids}
            />
          )}
          {/* `table` renders nothing: a board never creates tables (no
              picker, paste strips them) and `YorkieBoardStore` throws
              `notSupported` on every table op. */}
          <ArrangeMenu
            editor={editor}
            selectionSize={state.ids.length}
            minAlignSelection={2}
          />
        </>
      )}
      {state.kind === "text-edit" && (
        <>
          <ToolbarSeparator className="mx-1" />
          <TextEditSection state={state} editor={editor} />
        </>
      )}
```

`ArrangeMenu`'s `canUngroup` is left at its default `false` for now — the board's group/ungroup path stays on the context menu, which already offers both with correct enablement.

`ImageControls` is passed no `upload`, so its Replace affordance is inert; the board's Image button in the insert block remains the insertion path. Do not thread `makeBoardImageUpload` here — that is out of SP4's scope.

- [x] **Step 4: Wire the toolbar in board-view**

In `packages/frontend/src/app/board/board-view.tsx`. New imports needed:

```tsx
import type { Frame } from "@wafflebase/slides";
import { FIT_ZOOM } from "../slides/zoom-controller";
import { applyZoomValue, createBoardZoomController } from "./board-zoom";
```

(`Slide`, `SlidesDocument`, `Viewport` and `screenToWorld` are already imported.)

1. Lift the store into React state so the toolbar re-renders when it exists, mirroring the existing `editor` lift:

```tsx
  const [store, setStore] = useState<YorkieBoardStore | null>(null);
```

Inside the mount effect, right after `const store = new YorkieBoardStore(doc);` add `setStore(store);`, and in the cleanup add `setStore(null);` next to `setEditor(null)`.

2. Create the zoom controller as a ref-held singleton (outside the effect, so it survives effect re-runs):

```tsx
  const zoomController = useRef(createBoardZoomController()).current;
```

3. Inside the mount effect, after `fitToContentOnce()`, define a reusable frame reader and the fit callback, then subscribe the controller:

```tsx
    const readFrames = (): Frame[] => {
      const snapshot = store.read() as SlidesDocument;
      const slide = snapshot.slides[0] as Slide | undefined;
      return slide ? slide.elements.map((e) => e.frame) : [];
    };

    const commitViewport = (next: Viewport) => {
      vp.current = next;
      editor.setViewport(vp.current);
      minimap.repaintViewport(vp.current);
    };

    const fitToContentNow = () => {
      const next = applyZoomValue(
        vp.current,
        FIT_ZOOM,
        { w: hostW, h: hostH },
        readFrames(),
      );
      if (next) commitViewport(next);
    };

    const offZoom = zoomController.subscribe(() => {
      const next = applyZoomValue(
        vp.current,
        zoomController.get(),
        { w: hostW, h: hostH },
        readFrames(),
      );
      if (next) commitViewport(next);
    });
```

Reuse `readFrames` in the existing `createFitToContentOnce({ getFrames: readFrames, ... })` call rather than leaving the duplicated inline reader.

4. Pass `onFitToContent: fitToContentNow` into `initializeEditor({ ... })`. Because `fitToContentNow` is defined after the `initializeEditor` call, either hoist the fit helpers above it or pass `onFitToContent: () => fitToContentNow()` — prefer the arrow so the declaration order stays readable.

5. Keep the wheel handler as the source of truth and write the resulting scale back so the dropdown label tracks it. In `onWheel`, after `editor.setViewport(vp.current)`:

```tsx
      // Reflect wheel/pinch zoom in the toolbar readout. `set` is a
      // no-op when the value is unchanged (a pan tick), so this does
      // not churn subscribers — and the subscriber it would notify
      // recomputes from the same viewport, so there is no feedback loop.
      zoomController.set(vp.current.zoom);
```

6. Add `offZoom();` to the effect cleanup.

7. Pass the new props to the toolbar:

```tsx
        <BoardToolbar
          editor={editor}
          store={store}
          zoomController={zoomController}
          onInsertSticky={(color) => stickyInserterRef.current?.(color)}
          onInsertImage={(file) => imageInserterRef.current?.(file)}
          disabled={!workspaceId}
        />
```

- [x] **Step 5: Typecheck and run the board + slides suites**

Run: `pnpm --filter @wafflebase/frontend typecheck && pnpm --filter @wafflebase/frontend test -- board && pnpm --filter @wafflebase/slides test`
Expected: PASS.

- [x] **Step 6: Manual smoke**

Run `docker compose up -d && pnpm dev`, open a board, and confirm:
- Selecting a shape shows Fill + Border; changing fill repaints and survives reload.
- Selecting an image shows the image controls; selecting a text box shows its fill/border.
- Double-clicking into text shows the text-edit section (font, size, bold, align, Done).
- Align is greyed at one selected element and active at two.
- Undo/Redo buttons enable/disable correctly and undo the formatting change.
- The zoom dropdown shows `Fit` / presets, `Fit` frames all content, and wheel-zooming updates the label.

- [x] **Step 7: Commit**

```bash
git add packages/frontend/src/app/board/board-toolbar.tsx \
        packages/frontend/src/app/board/board-view.tsx \
        packages/frontend/src/app/board/board-toolbar-state.test.ts
git commit -m "Give the board toolbar formatting, undo/redo, and zoom" \
  -m "The board toolbar has been insert-only since SP1: a user could place
a shape, a sticky, or a text box and then had no way to change
anything about it — no fill, no border, no text formatting, no align
or order. Undo worked only from the keyboard, and zoom had no
readout.

None of it needed new engine code. YorkieBoardStore.read() already
returns a complete SlidesDocument whose single synthetic slide is the
board, so the slides leaf controls and getToolbarState operate on it
unmodified. Only the slide-scoped shells had to be left behind —
SlidesToolbar and ObjectSection mount a table picker and table
controls the board store throws notSupported on." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Publish and map board peer cursors

**Files:**
- Modify: `packages/frontend/src/app/board/board-view.tsx` — `mapBoardPeers` (~line 75) and the mount effect's presence wiring (~line 371)

**Interfaces:**
- Consumes: `PeerView.cursor` (Task 1). `BoardPresence.cursor?: { x: number; y: number } | null` already exists in `packages/frontend/src/types/board-document.ts:17` — SP1 defined it and left it unwritten.
- Produces: nothing downstream.

- [x] **Step 1: Forward the cursor in `mapBoardPeers`**

In `mapBoardPeers`, add to the pushed object (after `selectedElementIds`):

```ts
      // SP1 defined `cursor` on BoardPresence but never published or
      // painted it; SP4 completes both ends. `null` (peer left the
      // canvas) must become `undefined` so the overlay skips it.
      cursor: presence.cursor ?? undefined,
```

Update the function's doc comment: `cursor` is no longer among the omitted fields.

- [x] **Step 2: Publish the local cursor**

In the mount effect, immediately after the `offSelection` subscription block, add:

```tsx
    // Broadcast the local pointer so peers can see where this user is
    // working. A board is unbounded, so a selection ring alone does not
    // locate a collaborator who is editing off-screen.
    //
    // Coalesced to one write per animation frame: a raw pointermove
    // publish would push a CRDT presence update per mouse sample and
    // flood the channel. Presence only — the document root is untouched.
    let cursorFrame = 0;
    let pendingCursor: { x: number; y: number } | null = null;
    const flushCursor = () => {
      cursorFrame = 0;
      doc.update((_, p) => {
        p.set({ cursor: pendingCursor });
      });
    };
    const queueCursor = (next: { x: number; y: number } | null) => {
      pendingCursor = next;
      if (cursorFrame) return;
      cursorFrame = requestAnimationFrame(flushCursor);
    };
    const onCursorMove = (e: PointerEvent) => {
      queueCursor(
        screenToWorld(vp.current, {
          x: e.clientX - canvasRect.left,
          y: e.clientY - canvasRect.top,
        }),
      );
    };
    // Clear on leave so a departed cursor does not stick on peers'
    // screens at the last position it was seen.
    const onCursorLeave = () => queueCursor(null);
    if (!readOnly) {
      container.addEventListener("pointermove", onCursorMove);
      container.addEventListener("pointerleave", onCursorLeave);
    }
```

`canvasRect` is the cached rect already maintained by the `ResizeObserver` above — reuse it rather than calling `getBoundingClientRect()` on the pointer hot path.

- [x] **Step 3: Clean up**

In the effect's cleanup, before `offSelection();`:

```tsx
      container.removeEventListener("pointermove", onCursorMove);
      container.removeEventListener("pointerleave", onCursorLeave);
      if (cursorFrame) cancelAnimationFrame(cursorFrame);
```

Removing a listener that was never added (read-only mount) is a safe no-op, so this needs no `readOnly` guard.

- [x] **Step 4: Typecheck and test**

Run: `pnpm --filter @wafflebase/frontend typecheck && pnpm --filter @wafflebase/frontend test -- board`
Expected: PASS.

- [x] **Step 5: Manual smoke (two tabs)**

With `pnpm dev` running, open the same board in two browser tabs (or two profiles). Moving the pointer in one shows a coloured dot with the user's name tracking it in the other. Panning and zooming either tab keeps the dot on the same world point. Moving the pointer off the canvas removes the dot in the other tab.

- [x] **Step 6: Commit**

```bash
git add packages/frontend/src/app/board/board-view.tsx
git commit -m "Publish and paint live peer cursors on the board" \
  -m "SP1 defined `cursor` on BoardPresence and then left both ends
unwired — nothing wrote it and nothing read it. On an unbounded plane
that gap matters more than it would on a slide: a collaborator can be
working entirely outside the current viewport with no on-screen sign
of where they are.

Pointer samples are coalesced to one presence write per animation
frame; a raw pointermove publish would push a CRDT update per mouse
sample. Leaving the canvas publishes null so a departed cursor does
not stick at its last position." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Full verification and PR

**Files:** none (verification + docs)

- [x] **Step 1: Run the full self-verification lane**

Run: `pnpm verify:self`
Expected: PASS. On a `TextBoxEditorAPI` / `stepSelectionFontSize` typecheck failure, run `pnpm --filter @wafflebase/docs build` and re-run — known stale-dist gate gap, not a real error.

- [x] **Step 2: Self-review the branch diff**

Dispatch a code review over the full branch diff (`superpowers:requesting-code-review` or `/code-review`). Apply blocking findings; record non-blocking ones as known limitations in the task lessons file.

- [x] **Step 3: Write the task docs**

Add a **Review** section to the bottom of this file recording what actually shipped per task and any deviation from the plan. Create `docs/tasks/active/20260806-board-sp4-editing-parity-lessons.md` capturing what surprised you — at minimum the `align()` phantom-slide-rect trap, the board/slides zoom clamp mismatch, the stale docs-`dist` typecheck gate gap, and the fact that the canvas context menu already existed in the engine (which shrank this task's scope mid-design). Then run `pnpm tasks:index` — it regenerates `docs/tasks/README.md` (and the archive index) from the files on disk. Do not hand-edit either README; `docs/tasks/active/README.md` is a static description, not a per-task index.

- [x] **Step 4: Commit the task docs**

```bash
git add docs/tasks/active/20260806-board-sp4-editing-parity-todo.md \
        docs/tasks/active/20260806-board-sp4-editing-parity-lessons.md \
        docs/tasks/README.md
git commit -m "Add board SP4 task notes" \
  -m "Records the scope actually shipped and the traps found while
scoping it, so the next board pass does not rediscover them." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [x] **Step 5: Sync and open the PR**

```bash
git fetch && git rebase origin/main
git push -u origin board-sp4-editing-parity
```

The pre-push hook runs `verify:self` (~2.5 min) — run the push in the background with a generous timeout or it silently never lands.

Open a PR titled `Give the board formatting, undo/redo, zoom, and peer cursors` (≤ 70 chars) with a Summary + Test plan body.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| Object/text formatting toolbar | 5 |
| Undo/Redo buttons | 5 |
| Zoom control (`Fit` = fit-all) | 4, 5 |
| Canvas menu `Select all` / `Fit to content` | 3 |
| Peer cursors (engine + publish) | 1, 6 |
| `minAlignSelection` guard on `align()` | 2 |
| Slides regression gate | 1 (step 6), 3 (step 4), 5 (step 5), 7 |
| Non-goals (mobile, comments, export, CLI, board theme, tables) | Not implemented, by design; the `table` branch renders nothing (Task 5) |

**Type consistency**

- `PeerCursor` is defined in Task 1 and consumed only by Task 1's overlay loop; Task 6 sets `PeerView.cursor`, which Task 1 defined with the same `{ x: number; y: number }` shape as `BoardPresence.cursor`.
- `applyZoomValue` / `createBoardZoomController` / `BOARD_MIN_ZOOM` / `BOARD_MAX_ZOOM` are defined in Task 4 and used with those exact names in Task 5.
- `minAlignSelection` is defined in Task 2 and passed in Task 5.
- `onFitToContent` is defined in Task 3 and supplied in Task 5.

**Known follow-ups (deliberately out of scope)**

- `ImageControls` mounts without an `upload`, so its Replace button is inert on a board. Threading `makeBoardImageUpload` through the toolbar is a small follow-up, not SP4.
- `ArrangeMenu` receives `canUngroup={false}`; group/ungroup stays on the context menu, which already computes enablement correctly.

---

## Review

All seven tasks are implemented on this branch. `pnpm verify:self` green (136s). Branch:
15 commits on `board-sp4-editing-parity`. Lessons:
[20260806-board-sp4-editing-parity-lessons.md](20260806-board-sp4-editing-parity-lessons.md).

### What shipped, per task

| Task | Commits | Outcome |
| --- | --- | --- |
| 1 — Peer cursor in the slides overlay | `3acf665` | As planned. Additive `PeerView.cursor` → `PeerOverlays.cursors`, painted as DOM nodes beside the existing rings/labels. |
| 2 — `minAlignSelection` on `ArrangeMenu` | `c4589cc` | As planned. Reviewer mutation-tested the guard. |
| 3 — `Select all` + `Fit to content` | `66f832d`, `19b08a7` | As planned, plus behavioral tests for both entries after review found the click→effect path unguarded. |
| 4 — Board zoom controller | `f42f2b3`, `5a82966` | As planned, plus non-identity coverage after review proved the factor conversion was deletable with the suite still green. |
| 5 — Morphing board toolbar | `ece1395`, `f414328` | Design changed under review: `Fit` was dead in the board's default state, so a `createBoardZoomBinding` now applies on the intent rather than on the value-change notification. |
| 6 — Cursor presence publish | `5108d2b` | As planned, plus an extracted, unit-tested `board-cursor-publish.ts` (the plan had no test step). |
| 7 — Verification | `9b8be62`, `6bef139`, `30c4e13`, `e080907` | Whole-branch review found one Critical and three Important; all fixed and re-reviewed. |

### Deviations from the plan

- **`createBoardZoomBinding` was not in the plan.** The plan routed `Fit`
  through the controller's value channel; that made `Fit` a no-op in the
  board's default state, because the controller starts at `FIT_ZOOM` and
  `set()` early-returns on an unchanged value. The binding applies on the
  intent instead. `docs/design/board/board-editing-parity.md` was
  corrected to match.
- **`canUngroup` is wired after all.** The plan deliberately left it at
  `false` ("group/ungroup stays on the context menu"), but the spec listed
  ungroup as a toolbar Goal, so the final review flagged the
  contradiction. `canUngroupSelection` is now shared between
  `ObjectSection` and the board toolbar.
- **A peer-diff and a dedicated cursor layer were added to the slides
  editor.** Not planned; required to fix the Critical below.
- **`board-cursor-publish.ts` was extracted.** The plan inlined the
  rAF coalescing in `board-view.tsx`; it was pulled into a pure,
  dependency-injected module so the coalescing could be unit-tested,
  since the two-tab smoke could not be run.

### The Critical the whole-branch review caught

A peer's cursor tick ran `setPeers` → `repaintOverlay` →
`overlay.innerHTML = ''`, detaching the docs IME textarea that lives
inside the text-box container. `reattachEditingTextBox` re-appended it but
never restored focus, so with two tabs open, typing in a sticky lost focus
~60×/s while the other user moved their mouse — and keystrokes fell
through to the global key rules (`Delete` deleted the selected element).

Fixed with a peer-diff that skips the repaint when only cursor
coordinates changed, plus a dedicated cursor layer `renderOverlay` does
not clear. Focus restoration was rejected: `text-box-editor.ts` wires
blur → `cancelComposition()` → `onCommit`, so re-focusing would paper over
an already-committed session and cannot restore IME composition state.
Pinned by a regression test that mounts the **production** text-box mount.

### Known limitations

- **The manual two-tab smoke was never run** — no dev server was
  available for any task. Everything is verified by automated tests and
  static analysis. This is what let the Critical above ship into review.
- Any **non-cursor** peer activity — a peer changing selection, or any
  remote document edit via `markDirty` → `repaintOverlay` — still rebuilds
  the overlay and blurs a local in-place text edit. Pre-existing and
  edit-rate rather than pointer-rate; the proper fix is the deferred
  gesture-lifecycle signal.
- A **peer's** cursor at ~60 Hz still re-renders the whole local React
  tree (`useDocument()` selects whole state with `Object.is`). Only the
  self-write amplification was removed.
- After picking `Fit`, a window resize does not re-fit while the label
  still reads "Fit".
- `ImageControls` mounts without an `upload`, so its Replace button is
  inert on a board.
- `resend()` schedules via rAF, so a peer joining while the local tab is
  hidden sees the cursor only on refocus.
- `canUngroupSelection` adds a `store.read()` per toolbar render at single
  selection (a `cachedDoc` hit in the steady state).
