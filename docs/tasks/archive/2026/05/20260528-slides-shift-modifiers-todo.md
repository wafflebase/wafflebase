# Slides Shift Modifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Slides / PowerPoint parity Shift modifiers to four slides editor drag interactions — shape draw (1:1 aspect), line / connector draw (15° angle snap), connector endpoint drag (15° angle snap), and element move (axis lock) — while preserving existing Shift behaviors on resize and rotate.

**Architecture:** One new pure-function module (`view/editor/interactions/constraints.ts`) with three helpers — `constrainToSquare`, `snapEndpointAngle`, `lockAxis` — wired into four existing drag handlers via a single-line `ev.shiftKey ? transform(...) : raw` branch each. Mirrors the existing `resize.ts` / `rotate.ts` / `adjustment.ts` pattern (pure helpers next to consumers, no DOM, no shared state).

**Tech Stack:** TypeScript, Vitest, `@wafflebase/slides`.

Design doc: `docs/design/slides/slides-shift-modifiers.md`.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/slides/src/view/editor/interactions/constraints.ts` | Pure constraint helpers (`constrainToSquare`, `snapEndpointAngle`, `lockAxis`) | Create |
| `packages/slides/test/view/editor/interactions/constraints.test.ts` | Unit tests for the three helpers | Create |
| `packages/slides/src/view/editor/editor.ts` | Wire `constrainToSquare` into shape insert `onMove`, `snapEndpointAngle` into connector insert + endpoint drag `onMove`, `lockAxis` into move-drag `onMove` | Modify |
| `packages/slides/test/view/editor/interactions/insert.test.ts` | Shape insert Shift integration test | Modify |
| `packages/slides/test/view/editor/interactions/insert-connector.test.ts` | Connector insert Shift integration test | Modify |
| `packages/slides/test/view/editor/interactions/connector-endpoint-drag.test.ts` | Endpoint drag Shift integration test | Modify |
| `packages/slides/test/view/editor/interactions/drag.test.ts` | Move-drag axis-lock integration test | Modify |
| `docs/design/slides/slides-keyboard-shortcuts.md` | "Shift modifiers during drag" subsection | Modify |
| `packages/slides/src/view/editor/shortcuts-catalog.ts` | Drag-modifier entries for in-app help modal | Modify |

**Conventions discovered:**

- Tests live at `packages/slides/test/view/editor/interactions/*.test.ts`, mirror sources, and use Vitest `describe`/`it`/`expect`. Reference style: `rotate.test.ts` (lines 1–30) uses `toBeCloseTo` for trig results.
- Existing Shift implementations to mirror:
  - `interactions/resize.ts:35` — `preserveAspect` (aspect-ratio resize).
  - `interactions/rotate.ts:14` — `STEP = Math.PI / 12` and `snapAngle`.
- The shape-insert `onMove` at `editor.ts:1934` builds the ghost element via `buildInsertElement(kind, start, endPoint)`. The connector-insert `onMove` at `editor.ts:2009` calls `buildConnectorInit(variant, start, endPoint, ...)`. Both already pipe `endPoint` through a single transform point — Shift slots in trivially.
- Connector endpoint drag lives at `editor.ts:2492` (`onMove`) and `editor.ts:2530` (commit via `dragEndpoint`). Live preview goes through `recompute(cur)` which stores the result in `liveCursor`; the commit reads `liveCursor`, so transforming `cur` once in `onMove` propagates correctly to commit.
- Move drag lives in `editor.ts` around line 2180 — uses `liveDx`/`liveDy` computed from `(cur.x - start.x, cur.y - start.y)`. Snap-guide adjustment happens later in the same handler; `lockAxis` applies first so guides only nudge along the locked axis.
- The endpoint drag handler `dragEndpoint` in `interactions/connector-endpoint-drag.ts` is **not** modified — Shift transform happens at the call site in `editor.ts`, keeping the helper Shift-unaware.
- ANTLR-style generated files do not apply here; no codegen step.

---

## Task 1: Constraint module foundation + `constrainToSquare`

**Files:**
- Create: `packages/slides/src/view/editor/interactions/constraints.ts`
- Test: `packages/slides/test/view/editor/interactions/constraints.test.ts`

- [x] **Step 1: Write failing tests for `constrainToSquare`**

Create `packages/slides/test/view/editor/interactions/constraints.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { constrainToSquare } from '../../../../src/view/editor/interactions/constraints';

describe('constrainToSquare', () => {
  const ORIGIN = { x: 0, y: 0 };

  it('forces 1:1 in NE quadrant when |dx| > |dy|', () => {
    // start (0,0), end (100, 30) — dx wins, dy snaps to +100.
    expect(constrainToSquare(ORIGIN, { x: 100, y: 30 })).toEqual({ x: 100, y: 100 });
  });

  it('forces 1:1 in NE quadrant when |dy| > |dx|', () => {
    expect(constrainToSquare(ORIGIN, { x: 30, y: 100 })).toEqual({ x: 100, y: 100 });
  });

  it('preserves sign in SE quadrant (dx +, dy +) when dx wins', () => {
    expect(constrainToSquare(ORIGIN, { x: 80, y: 20 })).toEqual({ x: 80, y: 80 });
  });

  it('preserves sign in SW quadrant (dx -, dy +)', () => {
    expect(constrainToSquare(ORIGIN, { x: -80, y: 20 })).toEqual({ x: -80, y: 80 });
  });

  it('preserves sign in NW quadrant (dx -, dy -) when |dy| wins', () => {
    expect(constrainToSquare(ORIGIN, { x: -30, y: -90 })).toEqual({ x: -90, y: -90 });
  });

  it('preserves sign in NE quadrant (dx +, dy -)', () => {
    expect(constrainToSquare(ORIGIN, { x: 50, y: -120 })).toEqual({ x: 120, y: -120 });
  });

  it('returns end unchanged when start === end', () => {
    expect(constrainToSquare({ x: 7, y: 9 }, { x: 7, y: 9 })).toEqual({ x: 7, y: 9 });
  });

  it('handles exact |dx| === |dy| tie deterministically (no NaN, valid square)', () => {
    const out = constrainToSquare(ORIGIN, { x: 50, y: 50 });
    expect(out).toEqual({ x: 50, y: 50 });
  });

  it('works with a non-origin start', () => {
    // start (10, 20), end (60, 25) — dx=+50, dy=+5, |dx| wins → dy snaps to +50.
    expect(constrainToSquare({ x: 10, y: 20 }, { x: 60, y: 25 })).toEqual({ x: 60, y: 70 });
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @wafflebase/slides test constraints.test`
Expected: FAIL with "Cannot find module .../constraints".

- [x] **Step 3: Implement `constrainToSquare`**

Create `packages/slides/src/view/editor/interactions/constraints.ts`:

```typescript
/**
 * Pure constraint helpers used by drag interactions when the user
 * holds Shift. Each function is DOM-free, deterministic, and sized
 * for unit testing. Call sites: see editor.ts.
 *
 * Mirrors the structure of sibling modules (resize.ts, rotate.ts,
 * adjustment.ts): pure functions next to their consumers.
 */

const ANGLE_STEP = Math.PI / 12; // 15°, matches rotate.ts STEP.

/**
 * Force a 1:1 aspect on a drag rect. The longer of |dx| / |dy|
 * defines the side length; the shorter axis's sign is preserved so
 * the result stays in the user's drag quadrant.
 *
 * start === end returns end unchanged.
 */
export function constrainToSquare(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === 0 && ady === 0) return end;
  const side = Math.max(adx, ady);
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  return { x: start.x + side * sx, y: start.y + side * sy };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides test constraints.test`
Expected: PASS (9 tests).

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/interactions/constraints.ts \
        packages/slides/test/view/editor/interactions/constraints.test.ts
git commit -m "$(cat <<'EOF'
Add slides constraints module with constrainToSquare

First of three pure helpers for Shift-modified drags. The Shape-draw
call site (next commit) holds Shift to force 1:1 — squares, circles,
regular triangles, etc. — matching Google Slides / PowerPoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `snapEndpointAngle` to constraints module

**Files:**
- Modify: `packages/slides/src/view/editor/interactions/constraints.ts`
- Modify: `packages/slides/test/view/editor/interactions/constraints.test.ts`

- [x] **Step 1: Add failing tests for `snapEndpointAngle`**

Append to `constraints.test.ts`:

```typescript
import { snapEndpointAngle } from '../../../../src/view/editor/interactions/constraints';

describe('snapEndpointAngle', () => {
  const ORIGIN = { x: 0, y: 0 };
  const STEP = Math.PI / 12; // 15°

  it('leaves a 0° endpoint unchanged (along +X)', () => {
    const out = snapEndpointAngle(ORIGIN, { x: 100, y: 0 });
    expect(out.x).toBeCloseTo(100);
    expect(out.y).toBeCloseTo(0);
  });

  it('leaves a 90° endpoint unchanged (along +Y)', () => {
    const out = snapEndpointAngle(ORIGIN, { x: 0, y: 50 });
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(50);
  });

  it('snaps 30° vector (100, ~57.74) down to 30° exactly', () => {
    // tan(30°) = 0.577..., so (100, 57.74) is already 30°.
    const out = snapEndpointAngle(ORIGIN, { x: 100, y: 100 * Math.tan(STEP * 2) });
    const angle = Math.atan2(out.y, out.x);
    expect(angle).toBeCloseTo(STEP * 2);
  });

  it('preserves vector length when snapping', () => {
    // (100, 30) — length sqrt(10900) ≈ 104.40.
    const end = { x: 100, y: 30 };
    const out = snapEndpointAngle(ORIGIN, end);
    const inLen = Math.hypot(end.x, end.y);
    const outLen = Math.hypot(out.x, out.y);
    expect(outLen).toBeCloseTo(inLen);
  });

  it('rounds 7° to 0°', () => {
    const end = { x: Math.cos(7 * Math.PI / 180) * 50, y: Math.sin(7 * Math.PI / 180) * 50 };
    const out = snapEndpointAngle(ORIGIN, end);
    const angle = Math.atan2(out.y, out.x);
    expect(angle).toBeCloseTo(0);
  });

  it('rounds 8° to 15°', () => {
    const end = { x: Math.cos(8 * Math.PI / 180) * 50, y: Math.sin(8 * Math.PI / 180) * 50 };
    const out = snapEndpointAngle(ORIGIN, end);
    const angle = Math.atan2(out.y, out.x);
    expect(angle).toBeCloseTo(STEP);
  });

  it('rounds 22° to 15° (under midpoint)', () => {
    const end = { x: Math.cos(22 * Math.PI / 180) * 50, y: Math.sin(22 * Math.PI / 180) * 50 };
    const out = snapEndpointAngle(ORIGIN, end);
    const angle = Math.atan2(out.y, out.x);
    expect(angle).toBeCloseTo(STEP);
  });

  it('rounds 23° to 30° (over midpoint)', () => {
    const end = { x: Math.cos(23 * Math.PI / 180) * 50, y: Math.sin(23 * Math.PI / 180) * 50 };
    const out = snapEndpointAngle(ORIGIN, end);
    const angle = Math.atan2(out.y, out.x);
    expect(angle).toBeCloseTo(STEP * 2);
  });

  it('works in the negative-X / negative-Y quadrant', () => {
    // 195° input → snaps to 195° (= -165° = 13 * 15°).
    const target = 195 * Math.PI / 180;
    const end = { x: Math.cos(target) * 60, y: Math.sin(target) * 60 };
    const out = snapEndpointAngle(ORIGIN, end);
    const angle = Math.atan2(out.y, out.x);
    // 195° is already a 15° multiple, so unchanged.
    expect(angle).toBeCloseTo(target - 2 * Math.PI); // atan2 returns in (-π, π].
  });

  it('returns end unchanged when start === end (zero-length)', () => {
    expect(snapEndpointAngle({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('works with a non-origin start', () => {
    // Drag from (100, 100) to (200, 130). Vector (100, 30) → snaps to
    // ~0° (since 16.7° rounds to 15° actually). Let's pick a clean one:
    // (100, 100) → (100 + 100, 100 + 100 * tan(45°)) = (200, 200) — 45°.
    const out = snapEndpointAngle({ x: 100, y: 100 }, { x: 200, y: 200 });
    const dx = out.x - 100;
    const dy = out.y - 100;
    expect(Math.atan2(dy, dx)).toBeCloseTo(Math.PI / 4);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @wafflebase/slides test constraints.test`
Expected: FAIL with "snapEndpointAngle is not a function" (or import error).

- [x] **Step 3: Implement `snapEndpointAngle`**

Append to `constraints.ts`:

```typescript
/**
 * Rotate `end` around `start` so the angle from start→end snaps to
 * the nearest 15° increment. Length |end - start| is preserved; only
 * direction changes.
 *
 * start === end returns end unchanged (zero-length vector has no
 * meaningful angle).
 */
export function snapEndpointAngle(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return end;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
  return {
    x: start.x + Math.cos(snapped) * length,
    y: start.y + Math.sin(snapped) * length,
  };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides test constraints.test`
Expected: PASS (all `constrainToSquare` tests still green + new `snapEndpointAngle` block).

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/interactions/constraints.ts \
        packages/slides/test/view/editor/interactions/constraints.test.ts
git commit -m "$(cat <<'EOF'
Add snapEndpointAngle to slides constraints

Snaps a drag endpoint's angle to 15° increments while preserving
length. Used by the line/connector draw and endpoint-drag handlers
(next commits) so Shift produces axis-aligned and 45° lines without
the user fighting sub-pixel pointer drift.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `lockAxis` to constraints module

**Files:**
- Modify: `packages/slides/src/view/editor/interactions/constraints.ts`
- Modify: `packages/slides/test/view/editor/interactions/constraints.test.ts`

- [x] **Step 1: Add failing tests for `lockAxis`**

Append to `constraints.test.ts`:

```typescript
import { lockAxis } from '../../../../src/view/editor/interactions/constraints';

describe('lockAxis', () => {
  it('returns (dx, 0) when |dx| > |dy|', () => {
    expect(lockAxis(50, 10)).toEqual({ dx: 50, dy: 0 });
  });

  it('returns (0, dy) when |dy| > |dx|', () => {
    expect(lockAxis(10, 50)).toEqual({ dx: 0, dy: 50 });
  });

  it('breaks ties toward X (|dx| === |dy|)', () => {
    expect(lockAxis(30, 30)).toEqual({ dx: 30, dy: 0 });
    expect(lockAxis(-30, 30)).toEqual({ dx: -30, dy: 0 });
  });

  it('returns (0, 0) for zero delta', () => {
    expect(lockAxis(0, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it('preserves sign on negative dx', () => {
    expect(lockAxis(-80, 20)).toEqual({ dx: -80, dy: 0 });
  });

  it('preserves sign on negative dy', () => {
    expect(lockAxis(15, -120)).toEqual({ dx: 0, dy: -120 });
  });

  it('compares absolute values, not signed', () => {
    // |dx| = 10, |dy| = 60 — Y wins despite dx being "more positive".
    expect(lockAxis(10, -60)).toEqual({ dx: 0, dy: -60 });
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @wafflebase/slides test constraints.test`
Expected: FAIL with import error for `lockAxis`.

- [x] **Step 3: Implement `lockAxis`**

Append to `constraints.ts`:

```typescript
/**
 * Project a pointer delta onto the dominant axis. When |dx| >= |dy|
 * returns (dx, 0); otherwise (0, dy). Tie-break (|dx| === |dy|): X
 * wins for determinism.
 *
 * Re-evaluated every mousemove — when the user changes drag direction
 * mid-stream, the lock switches axes naturally.
 */
export function lockAxis(
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  return Math.abs(dx) >= Math.abs(dy)
    ? { dx, dy: 0 }
    : { dx: 0, dy };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides test constraints.test`
Expected: PASS (all three function blocks green).

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/interactions/constraints.ts \
        packages/slides/test/view/editor/interactions/constraints.test.ts
git commit -m "$(cat <<'EOF'
Add lockAxis to slides constraints

Final pure helper of the trio: projects a pointer delta onto the
dominant axis. Used by the move-drag handler when Shift is held so
selected elements translate strictly along H or V — matching Google
Slides and PowerPoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire `constrainToSquare` into shape draw

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts:1934-1939` (shape insert `onMove`)
- Modify: `packages/slides/test/view/editor/interactions/insert.test.ts`

- [x] **Step 1: Add failing integration test for shape draw + Shift**

Open `packages/slides/test/view/editor/interactions/insert.test.ts`. Look for an existing test that exercises drag-to-insert a shape (search for `buildInsertElement` or `Rectangle`). Add a sibling test that exercises the editor's `onMove` with `shiftKey: true`. If the file currently only unit-tests `buildInsertElement` (no editor harness), instead add this engine-level test that proves the call-site contract — what the editor passes to `buildInsertElement`:

```typescript
import { describe, it, expect } from 'vitest';
import { constrainToSquare } from '../../../../src/view/editor/interactions/constraints';
import { buildInsertElement } from '../../../../src/view/editor/interactions/insert';

describe('shape insert + Shift produces a 1:1 frame', () => {
  it('forces square frame for Rectangle when |dx| > |dy|', () => {
    const start = { x: 100, y: 100 };
    const rawEnd = { x: 300, y: 150 }; // dx=200, dy=50.
    const end = constrainToSquare(start, rawEnd);
    const el = buildInsertElement('rectangle', start, end);
    expect(el.frame.w).toBe(el.frame.h);
    expect(el.frame.w).toBe(200);
  });

  it('forces square frame for Ellipse when |dy| > |dx|', () => {
    const start = { x: 0, y: 0 };
    const rawEnd = { x: 40, y: 180 };
    const end = constrainToSquare(start, rawEnd);
    const el = buildInsertElement('ellipse', start, end);
    expect(el.frame.w).toBe(el.frame.h);
    expect(el.frame.w).toBe(180);
  });
});
```

If `buildInsertElement` is not the correct shape-kind identifier (e.g. uses `'rect'` instead of `'rectangle'`), match the value used elsewhere in `insert.test.ts`.

- [x] **Step 2: Run test to verify it passes already (helper is pure)**

Run: `pnpm --filter @wafflebase/slides test insert.test`
Expected: PASS. This test proves the contract that the editor's call site (next step) will honor; it doesn't need an editor mock because it tests `constrainToSquare` composed with `buildInsertElement`.

- [x] **Step 3: Modify shape insert `onMove` in editor.ts**

Open `packages/slides/src/view/editor/editor.ts` and find the shape insert `onMove` (around line 1934, inside `startInsert` after the `if (isConnectorInsertKind(kind))` branch). Current code:

```typescript
const onMove = (ev: MouseEvent) => {
  endPoint = this.clientToLogical(ev.clientX, ev.clientY);
  const init = buildInsertElement(kind, start, endPoint);
  const ghost = { ...init, id: '__preview__' } as Element;
  this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
};
```

Change to:

```typescript
const onMove = (ev: MouseEvent) => {
  const raw = this.clientToLogical(ev.clientX, ev.clientY);
  endPoint = ev.shiftKey ? constrainToSquare(start, raw) : raw;
  const init = buildInsertElement(kind, start, endPoint);
  const ghost = { ...init, id: '__preview__' } as Element;
  this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
};
```

Add the import at the top of `editor.ts` (alongside the existing interactions imports near lines 22–28):

```typescript
import { constrainToSquare } from './interactions/constraints';
```

The commit on `onUp` at line ~1952 already reads from the loop-local `endPoint` variable, so the Shift-snapped endpoint is what gets persisted — no further changes needed.

- [x] **Step 4: Run the full slides test suite to confirm no regression**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS. The integration test from Step 1 already passes; this confirms nothing else broke.

- [x] **Step 5: Run typecheck**

Run: `pnpm --filter @wafflebase/slides build`
Expected: SUCCESS (no TS errors).

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/test/view/editor/interactions/insert.test.ts
git commit -m "$(cat <<'EOF'
Force 1:1 shape draw when Shift is held

Wires constrainToSquare into the shape insert drag handler. Holding
Shift while dragging out any shape (rectangle, ellipse, triangle,
star, etc.) forces width === height — squares, circles, regular
triangles. Matches Google Slides and PowerPoint. Text boxes
(separate insert path) intentionally unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `snapEndpointAngle` into connector draw

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts:2009-2018` (connector insert `onMove`)
- Modify: `packages/slides/test/view/editor/interactions/insert-connector.test.ts`

- [x] **Step 1: Add failing integration test for connector draw + Shift**

Open `packages/slides/test/view/editor/interactions/insert-connector.test.ts`. Follow the existing test style. Add:

```typescript
import { describe, it, expect } from 'vitest';
import { snapEndpointAngle } from '../../../../src/view/editor/interactions/constraints';
import { buildConnectorInit } from '../../../../src/view/editor/interactions/insert-connector';

describe('connector insert + Shift snaps endpoint to 15°', () => {
  it('snaps a (0,0) -> (100, 30) drag toward 15°', () => {
    const start = { x: 0, y: 0 };
    const rawEnd = { x: 100, y: 30 };
    const end = snapEndpointAngle(start, rawEnd);
    // 100/30 → atan2 ≈ 16.7° → snaps to 15° = π/12.
    const angle = Math.atan2(end.y, end.x);
    expect(angle).toBeCloseTo(Math.PI / 12);

    // The connector init derives its frame from start/end — make sure
    // the snapped end is what flows through.
    const init = buildConnectorInit('line', start, end, [], 1);
    expect(init).toBeTruthy();
  });

  it('snaps a (0,0) -> (50, 50) drag to exactly 45°', () => {
    const start = { x: 0, y: 0 };
    const end = snapEndpointAngle(start, { x: 50, y: 50 });
    expect(Math.atan2(end.y, end.x)).toBeCloseTo(Math.PI / 4);
  });
});
```

If `buildConnectorInit`'s first argument expects a `ConnectorInsertVariant` other than `'line'`, use whatever literal `insert-connector.test.ts` already uses.

- [x] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test insert-connector.test`
Expected: PASS (pure helper composition).

- [x] **Step 3: Modify connector insert `onMove` in editor.ts**

Find `startConnectorInsert`'s `onMove` (around line 2009). Current:

```typescript
const onMove = (ev: MouseEvent) => {
  endPoint = this.clientToLogical(ev.clientX, ev.clientY);
  this.connectorCursor = endPoint;
  const init = buildConnectorInit(variant, start, endPoint, slide.elements, this.scale());
  const ghost = { ...init, id: '__preview__' } as Element;
  this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
  this.repaintOverlay();
};
```

Change to:

```typescript
const onMove = (ev: MouseEvent) => {
  const raw = this.clientToLogical(ev.clientX, ev.clientY);
  endPoint = ev.shiftKey ? snapEndpointAngle(start, raw) : raw;
  this.connectorCursor = endPoint;
  const init = buildConnectorInit(variant, start, endPoint, slide.elements, this.scale());
  const ghost = { ...init, id: '__preview__' } as Element;
  this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
  this.repaintOverlay();
};
```

Extend the existing constraints import to include the new symbol:

```typescript
import { constrainToSquare, snapEndpointAngle } from './interactions/constraints';
```

`buildConnectorInit` already runs the connection-site test against `endPoint`. With Shift held, the snapped coordinate is what it sees: if it lands inside a site radius the endpoint attaches, otherwise free. No extra branching needed.

- [x] **Step 4: Run the suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS.

- [x] **Step 5: Typecheck**

Run: `pnpm --filter @wafflebase/slides build`
Expected: SUCCESS.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/test/view/editor/interactions/insert-connector.test.ts
git commit -m "$(cat <<'EOF'
Snap line and connector draws to 15° when Shift is held

Wires snapEndpointAngle into the connector insert drag. Holding Shift
forces the endpoint angle to the nearest 15° increment, length
preserved. Snap-to-connection-site is unchanged: the snapped
coordinate is what buildConnectorInit sees, so attachment falls out
naturally — release Shift to attach.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire `snapEndpointAngle` into connector endpoint drag

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` — `startEndpointDrag` (`onMove` at ~2492, recompute / commit unchanged)
- Modify: `packages/slides/test/view/editor/interactions/connector-endpoint-drag.test.ts`

- [x] **Step 1: Add failing integration test for endpoint drag + Shift**

Open `packages/slides/test/view/editor/interactions/connector-endpoint-drag.test.ts`. Follow existing style — if it exercises `dragEndpoint` directly, add a sibling test that proves the editor's Shift transform: snap is applied **at the call site** (editor.ts) before `dragEndpoint` runs, so the test exercises the composition:

```typescript
import { describe, it, expect } from 'vitest';
import { snapEndpointAngle } from '../../../../src/view/editor/interactions/constraints';

describe('endpoint drag + Shift snaps relative to the opposite endpoint', () => {
  it('snaps the dragging endpoint around the fixed end', () => {
    // Other endpoint anchored at (200, 200) in world coords.
    const other = { x: 200, y: 200 };
    // User drags toward (300, 230). Vector (100, 30) → ~16.7° → snaps to 15°.
    const snapped = snapEndpointAngle(other, { x: 300, y: 230 });
    const dx = snapped.x - other.x;
    const dy = snapped.y - other.y;
    expect(Math.atan2(dy, dx)).toBeCloseTo(Math.PI / 12);
    // Length preserved: hypot(100, 30) ≈ 104.4.
    expect(Math.hypot(dx, dy)).toBeCloseTo(Math.hypot(100, 30));
  });

  it('keeps a 45° drag exactly at 45°', () => {
    const other = { x: 0, y: 0 };
    const snapped = snapEndpointAngle(other, { x: 80, y: 80 });
    expect(Math.atan2(snapped.y - other.y, snapped.x - other.x)).toBeCloseTo(Math.PI / 4);
  });
});
```

- [x] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test connector-endpoint-drag.test`
Expected: PASS (pure helper).

- [x] **Step 3: Modify endpoint-drag `onMove` in editor.ts**

In `startEndpointDrag` (find it via `grep -n "startEndpointDrag\|endpointDragging = true" packages/slides/src/view/editor/editor.ts`), at the top of the handler add an "other endpoint world position" capture. Look for the existing variable declarations around line 2438–2446:

```typescript
const startCursor = this.clientToLogical(clientX, clientY);
let liveEndpoint = side === 'start' ? startConnector.start : startConnector.end;
let liveCursor = startCursor;
let moved = false;
this.connectorCursor = startCursor;
```

Immediately below, add a world-space resolution of the opposite endpoint (used for Shift snap):

```typescript
// World-space position of the OTHER (non-dragging) endpoint. Captured
// once at mousedown — the opposite endpoint stays fixed for the
// duration of this drag, so we don't need to re-resolve per move.
const otherEndpoint = side === 'start' ? startConnector.end : startConnector.start;
const otherWorld = resolveEndpoint(
  otherEndpoint,
  new Map(startSlide.elements.map((e) => [e.id, e] as const)),
);
```

`resolveEndpoint` is already imported (`editor.ts:7`).

Then modify the `onMove` at ~2492. Current:

```typescript
const onMove = (ev: MouseEvent) => {
  const cur = this.clientToLogical(ev.clientX, ev.clientY);
  this.connectorCursor = cur;
  if (!moved) {
    const dx = cur.x - startCursor.x;
    const dy = cur.y - startCursor.y;
    const threshold = CONNECTOR_MIN_DRAG_DISTANCE / this.scale();
    if (dx * dx + dy * dy < threshold * threshold) return;
    moved = true;
  }
  recompute(cur);
  paintLiveConnector();
};
```

Change to:

```typescript
const onMove = (ev: MouseEvent) => {
  const raw = this.clientToLogical(ev.clientX, ev.clientY);
  // Shift snap is relative to the fixed opposite endpoint, then the
  // result flows through the normal snap-to-connection-site test
  // inside `recompute(cur)`. If the snapped point lands on a site,
  // it attaches; otherwise it stays free — same precedence as B2.
  const cur = ev.shiftKey ? snapEndpointAngle(otherWorld, raw) : raw;
  this.connectorCursor = cur;
  if (!moved) {
    const dx = cur.x - startCursor.x;
    const dy = cur.y - startCursor.y;
    const threshold = CONNECTOR_MIN_DRAG_DISTANCE / this.scale();
    if (dx * dx + dy * dy < threshold * threshold) return;
    moved = true;
  }
  recompute(cur);
  paintLiveConnector();
};
```

The commit on `onUp` (~line 2530) uses `liveCursor`, which `recompute(cur)` already stores from the snapped `cur` — commit picks up the snap automatically.

- [x] **Step 4: Run the suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS.

- [x] **Step 5: Typecheck**

Run: `pnpm --filter @wafflebase/slides build`
Expected: SUCCESS.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/test/view/editor/interactions/connector-endpoint-drag.test.ts
git commit -m "$(cat <<'EOF'
Snap connector endpoint drag to 15° when Shift is held

Mirrors the connector-draw Shift behavior on the editing side:
dragging a connector's endpoint with Shift snaps the angle relative
to the fixed opposite endpoint, length unconstrained. The snapped
coordinate flows into the existing snap-to-connection-site test, so
attachment behavior is unchanged — Shift wins, release to attach.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire `lockAxis` into element move drag

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` — move-drag `onMove` (around line 2180)
- Modify: `packages/slides/test/view/editor/interactions/drag.test.ts`

- [x] **Step 1: Add failing integration test for move + Shift**

Open `packages/slides/test/view/editor/interactions/drag.test.ts`. Add:

```typescript
import { describe, it, expect } from 'vitest';
import { lockAxis } from '../../../../src/view/editor/interactions/constraints';

describe('move drag + Shift locks to dominant axis', () => {
  it('locks to X when horizontal delta dominates', () => {
    expect(lockAxis(120, 18)).toEqual({ dx: 120, dy: 0 });
  });

  it('locks to Y when vertical delta dominates', () => {
    expect(lockAxis(18, -120)).toEqual({ dx: 0, dy: -120 });
  });

  it('switches axis live when the user changes direction', () => {
    // Simulates two onMove frames: first horizontal-dominant, then
    // vertical-dominant. The lock follows the cumulative pointer.
    const t1 = lockAxis(50, 5);
    expect(t1).toEqual({ dx: 50, dy: 0 });
    const t2 = lockAxis(50, 200);
    expect(t2).toEqual({ dx: 0, dy: 200 });
  });
});
```

- [x] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test drag.test`
Expected: PASS (pure helper).

- [x] **Step 3: Locate the move-drag `onMove`**

Run: `grep -n "liveDx\|liveDy" packages/slides/src/view/editor/editor.ts | head`

Find the `onMove` handler that computes `liveDx` and `liveDy` from `(cur.x - start.x, cur.y - start.y)` — it is the same handler that calls `this.paintMoveGhost(ghosts, handleElements, guides);` at ~line 2218.

- [x] **Step 4: Modify move-drag `onMove`**

Inside that `onMove`, locate the lines that compute the delta from the cursor — they look roughly like:

```typescript
const cur = this.clientToLogical(ev.clientX, ev.clientY);
liveDx = cur.x - start.x;
liveDy = cur.y - start.y;
// ...
```

(Variable names may be slightly different; the test before-modification is `liveDx = cur.x - start.x` and `liveDy = cur.y - start.y`.) Wrap them:

```typescript
const cur = this.clientToLogical(ev.clientX, ev.clientY);
const rawDx = cur.x - start.x;
const rawDy = cur.y - start.y;
const locked = ev.shiftKey ? lockAxis(rawDx, rawDy) : { dx: rawDx, dy: rawDy };
liveDx = locked.dx;
liveDy = locked.dy;
// ... remainder of onMove (snap-guide adjustment, ghost build, paintMoveGhost) unchanged
```

`lockAxis` runs BEFORE the snap-guide pass that follows. Snap guides therefore nudge only along the locked axis — the design's documented behavior.

Extend the constraints import:

```typescript
import {
  constrainToSquare,
  snapEndpointAngle,
  lockAxis,
} from './interactions/constraints';
```

- [x] **Step 5: Run the suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS.

- [x] **Step 6: Typecheck**

Run: `pnpm --filter @wafflebase/slides build`
Expected: SUCCESS.

- [x] **Step 7: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/test/view/editor/interactions/drag.test.ts
git commit -m "$(cat <<'EOF'
Lock object move to one axis when Shift is held

Wires lockAxis into the move-drag handler before the snap-guide pass.
Holding Shift forces the selected elements (single or multi) to
translate strictly along the dominant axis (max |dx| vs |dy|). The
axis is re-decided every frame, so changing direction mid-drag
switches the lock naturally — matches Google Slides.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Documentation and discoverability

**Files:**
- Modify: `docs/design/slides/slides-keyboard-shortcuts.md`
- Modify: `packages/slides/src/view/editor/shortcuts-catalog.ts`

- [x] **Step 1: Add "Shift modifiers during drag" section to slides-keyboard-shortcuts.md**

Open `docs/design/slides/slides-keyboard-shortcuts.md`. After the existing shortcut table (after the Scope section, before Architecture), insert:

```markdown
### Shift modifiers during drag

Holding Shift while dragging applies a context-specific constraint.
Sampled live — pressing or releasing Shift mid-drag updates the
constraint immediately.

| Interaction | Shift behavior |
|---|---|
| Shape draw | Force `w === h` — squares, circles, regular triangles. Applies to every `ShapeKind`; text-box insert is exempt. |
| Line / connector draw | Snap endpoint angle to 15° increments from the drag start. Length preserved. |
| Connector endpoint drag (existing line) | Snap dragging endpoint to 15° relative to the opposite endpoint. |
| Element move | Project pointer delta onto the dominant axis (max-displacement). Re-decided every frame; tie-break is X-wins. |
| Corner resize (existing) | Preserve aspect ratio. |
| Rotate handle (existing) | Snap rotation to 15°. |

For connector draw and endpoint drag, Shift wins over connection-site
snap: the snapped coordinate is what the site test sees, so the
endpoint attaches only when the angle-snapped point lands inside a
site radius. Release Shift to attach.

Full design: [slides-shift-modifiers.md](./slides-shift-modifiers.md).
```

- [x] **Step 2: Add drag-modifier entries to the in-app help catalog**

Open `packages/slides/src/view/editor/shortcuts-catalog.ts`. Inspect the existing categories and entry shape (likely an array of `{ category, keys, description }` objects). Add a new category section, e.g.:

```typescript
// Append to the catalog array. The exact field names must match
// what shortcuts-catalog.ts already uses — read the existing entries
// first.
{
  category: 'Drag modifiers',
  keys: 'Shift + drag (shape)',
  description: 'Force 1:1 aspect (square, circle, regular triangle).',
},
{
  category: 'Drag modifiers',
  keys: 'Shift + drag (line/connector)',
  description: 'Snap endpoint angle to 15° increments.',
},
{
  category: 'Drag modifiers',
  keys: 'Shift + drag (endpoint)',
  description: 'Snap to 15° relative to the opposite endpoint.',
},
{
  category: 'Drag modifiers',
  keys: 'Shift + drag (move)',
  description: 'Lock to dominant axis (horizontal or vertical).',
},
```

If the file has a typed schema, follow the existing field names exactly (open the file, copy the pattern from a current entry).

- [x] **Step 3: Run the suite + typecheck once more**

Run: `pnpm --filter @wafflebase/slides test && pnpm --filter @wafflebase/slides build`
Expected: PASS / SUCCESS.

- [x] **Step 4: Run repo-wide pre-commit gate**

Run: `pnpm verify:fast`
Expected: PASS (lint + unit tests across all packages).

- [x] **Step 5: Manual smoke (browser) — `pnpm dev`**

In one terminal: `docker compose up -d`
In another: `pnpm dev`
Open the slides editor at `http://localhost:5173`.

Verify:
- Rectangle tool + drag with Shift → produces an exact square.
- Ellipse tool + drag with Shift → produces a circle.
- Line tool + drag with Shift → angle snaps at 0°, 15°, 30°, 45°, 90°. Boundary check: ~7° rounds to 0°, ~8° rounds to 15°.
- Draw a free line, then drag its endpoint with Shift → endpoint snaps to 15° around the other end.
- Draw two shapes; select both; drag with Shift → both translate along one axis only; release Shift and the diagonal is restored.
- Regression check: corner resize + Shift still keeps aspect ratio; rotate handle + Shift still snaps 15°.
- Help modal (`Cmd/Ctrl + /`) shows the four new "Drag modifiers" entries.

- [x] **Step 6: Commit**

```bash
git add docs/design/slides/slides-keyboard-shortcuts.md \
        packages/slides/src/view/editor/shortcuts-catalog.ts
git commit -m "$(cat <<'EOF'
Document slides Shift drag modifiers

Adds a "Shift modifiers during drag" section to the slides keyboard
reference and the in-app shortcuts-help modal. Surfaces the new
behaviors (1:1 shape draw, 15° line/endpoint snap, axis-locked move)
alongside the existing resize and rotate Shift modifiers so users can
discover them without reading source.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Branch wrap-up

- [x] **Step 1: Self-review the full branch diff against the design doc**

Run: `git diff main...HEAD --stat` and skim. Confirm each of the four new behaviors has a call site + integration test, the three pure helpers have unit coverage, and the design doc's "Out of Scope" items (Alt center-resize, Ctrl duplicate-drag, rotated-frame local-axis lock) were **not** touched.

- [x] **Step 2: Dispatch code review**

Use the project workflow's review skill (`/code-review` or `superpowers:requesting-code-review`) on the branch diff before opening the PR. Address any blocking findings; record non-blocking ones in `*-lessons.md`.

- [x] **Step 3: Capture lessons**

Create `docs/tasks/active/20260528-slides-shift-modifiers-lessons.md` with any non-obvious gotchas found during implementation (e.g. if `shortcuts-catalog.ts` schema differed from this plan's assumption, if connection-site precedence needed extra branching in practice, if `dragEndpoint`'s flow assumed something subtly different).

- [x] **Step 4: Archive and open PR**

```bash
pnpm tasks:archive && pnpm tasks:index
git add docs/tasks/
git commit -m "Archive slides-shift-modifiers task docs"
```

Then push and open the PR with the project's PR template (Summary + Test plan), referencing the design doc.
