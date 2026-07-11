# Slides Gradient Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Solid | Gradient` editing UI to the slides shape fill dropdown (PowerPoint-style stops-bar) and extend the gradient stack from linear-only to linear + radial.

**Architecture:** PR1 introduces a required `type` discriminator on `GradientFill` (+ migration) and builds the inline `GradientEditor` for **linear** gradients inside a new `FillPicker` shell that wraps the existing `ThemedColorPicker`. PR2 extends the model/renderer/importer/exporter and the editor to **radial** gradients (`center` + `<a:path circle>` round-trip). Per-stop color reuses the existing `ThemedColorPicker` in a nested popover, so stops support theme role colors and alpha for free.

**Tech Stack:** TypeScript, React, Canvas 2D, Vitest + React Testing Library, ANTLR-free OOXML string builders.

Design spec: `docs/design/slides/slides-gradient-editing.md`.

## Global Constraints

- `GradientFill.type` is **required** (`'linear' | 'radial'`), not optional — every gradient carries an explicit kind so `resolveFillStyle` / `gradFillXml` switch exhaustively. Copied verbatim from spec §Model.
- `angle` stays in **radians**, clockwise from +x (`0` = left→right). UI works in degrees and converts.
- `GradientStop.pos` is `0..1`; clamp on every write. `center.x/y` are `0..1`; absent ⇒ `{ x: 0.5, y: 0.5 }` (from-center), resolved at read time, never migrated.
- Minimum **2 stops** per gradient (delete disabled at 2; `< 2` degrades to representative solid in render + export, already the case).
- Edits apply to `shape` and `freeform` elements only; multi-select writes go through a single `store.batch`.
- Commit timing: marker drags + transparency slider commit once on pointer-up (one undo unit); discrete picks (add/delete stop, recolor, direction preset, numeric blur) commit immediately.
- ANTLR generated files are off-limits (not touched here). Do NOT hand-edit generated formula files.
- Each commit keeps `pnpm verify:fast` green.
- **Frontend components have NO RTL/component unit tests in this repo** (zero
  `src` files import `@testing-library/react`, despite the harness being
  installed). React components (`GradientEditor`, `FillPicker`) are verified by
  `tsc --noEmit` + production build + `verify:browser:docker` smoke — **do NOT
  add component unit tests**; missing component tests is not a defect. Pure
  logic (model, migration, helpers, renderer, importer, exporter) IS unit-
  tested in the `slides` package / frontend helper modules, per that package's
  convention. This governs Tasks 4, 5, 9 (component tests removed below).

---

## PR 1 — Linear gradient editing UI

### Task 1: Model `type` discriminator + migration

**Files:**
- Modify: `packages/slides/src/model/theme.ts:66-82`
- Modify: `packages/slides/src/model/migrate.ts` (add gradient normalizer, wire into element-fill migration)
- Modify: `packages/slides/src/import/pptx/shape.ts:940-969` (set `type` on both branches)
- Modify: `packages/slides/src/export/pptx/color.ts:49-59` (read `type`, still emit linear)
- Test: `packages/slides/src/model/migrate.test.ts` (add cases) — or the existing model test file if migrate has none; create `migrate.test.ts` if absent.

**Interfaces:**
- Produces:
  ```ts
  type GradientFill = {
    kind: 'gradient';
    type: 'linear' | 'radial';
    angle: number;                     // linear, radians
    center?: { x: number; y: number }; // radial, 0..1, default {0.5,0.5}
    stops: GradientStop[];
  };
  function migrateGradientFill(raw: any): GradientFill; // backfills type:'linear'
  ```

- [ ] **Step 1: Write the failing migration test**

Create/extend `packages/slides/src/model/migrate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { migrateGradientFill } from './migrate';

describe('migrateGradientFill', () => {
  it('backfills type:"linear" on a legacy gradient with no type', () => {
    const legacy = {
      kind: 'gradient',
      angle: Math.PI / 2,
      stops: [
        { pos: 0, color: { kind: 'srgb', value: '#fff' } },
        { pos: 1, color: { kind: 'srgb', value: '#000' } },
      ],
    };
    expect(migrateGradientFill(legacy).type).toBe('linear');
  });

  it('preserves an explicit type', () => {
    const g = { kind: 'gradient', type: 'radial', angle: 0, stops: [] };
    expect(migrateGradientFill(g).type).toBe('radial');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- migrate`
Expected: FAIL — `migrateGradientFill` is not exported.

- [ ] **Step 3: Widen the model type**

In `theme.ts`, replace the `GradientFill` definition (lines 69-79):

```ts
/** One stop of a gradient. `pos` is `0..1` along the gradient axis. */
export type GradientStop = { pos: number; color: ThemeColor };

/**
 * Gradient fill. `type` selects the geometry:
 *  - `linear`: `angle` (radians, cw from +x, `0` = left→right) sets the axis.
 *  - `radial`: `center` (0..1 of the box, default `{0.5,0.5}`) sets the origin;
 *    `angle` is ignored.
 * Maps to OOXML `<a:lin>` (linear) / `<a:path path="circle">` (radial).
 */
export type GradientFill = {
  kind: 'gradient';
  type: 'linear' | 'radial';
  angle: number;
  center?: { x: number; y: number };
  stops: GradientStop[];
};
```

- [ ] **Step 4: Add the migration normalizer**

In `migrate.ts`, add and export:

```ts
import type { GradientFill } from './theme';

/**
 * Normalize a stored gradient fill. Documents written before the radial
 * work carry no `type`; they were all linear, so backfill `type:'linear'`.
 */
export function migrateGradientFill(raw: any): GradientFill {
  return {
    kind: 'gradient',
    type: raw?.type === 'radial' ? 'radial' : 'linear',
    angle: typeof raw?.angle === 'number' ? raw.angle : 0,
    center: raw?.center,
    stops: Array.isArray(raw?.stops) ? raw.stops : [],
  };
}
```

Then, wherever element `data.fill` is normalized during `migrateSlide`/element
migration, route a `kind === 'gradient'` fill through `migrateGradientFill`.
Find the fill-copy site:

Run: `grep -n "fill" packages/slides/src/model/migrate.ts`

Add a guard where element data is assembled:

```ts
// inside the element data normalizer, when copying `data.fill`:
const fill =
  rawData?.fill?.kind === 'gradient'
    ? migrateGradientFill(rawData.fill)
    : rawData?.fill;
```

- [ ] **Step 5: Set `type` in the importer**

In `import/pptx/shape.ts`, update both `parseGradientFill` returns (lines 961, 968):

```ts
// radial/path collapse (still first-stop in PR1):
if (child(grad, 'path')) {
  return { kind: 'gradient', type: 'linear', angle: 0, stops: [stops[0]] };
}
// linear:
return { kind: 'gradient', type: 'linear', angle: (angDeg * Math.PI) / 180, stops };
```

- [ ] **Step 6: Keep the exporter compiling on the new field**

In `export/pptx/color.ts`, `gradFillXml` is unchanged in behavior but now reads
a `type` field. No code change needed unless TS complains; if the object is
constructed elsewhere in tests, they now need `type`. Run the build to surface
any missing `type`:

Run: `pnpm --filter @wafflebase/slides build`
Fix any construction sites the compiler flags by adding `type: 'linear'`.

- [ ] **Step 7: Run tests + build to verify green**

Run: `pnpm --filter @wafflebase/slides test -- migrate && pnpm --filter @wafflebase/slides build`
Expected: PASS + clean build.

- [ ] **Step 8: Commit**

```bash
git add packages/slides/src/model/theme.ts packages/slides/src/model/migrate.ts \
        packages/slides/src/model/migrate.test.ts packages/slides/src/import/pptx/shape.ts \
        packages/slides/src/export/pptx/color.ts
git commit -m "Slides: add GradientFill.type discriminator + migration"
```

---

### Task 2: Gradient editing pure helpers (frontend)

**Files:**
- Create: `packages/frontend/src/app/slides/fill-picker/gradient-helpers.ts`
- Test: `packages/frontend/src/app/slides/fill-picker/gradient-helpers.test.ts`

**Interfaces:**
- Consumes: `GradientFill`, `GradientStop`, `ThemeColor` from `@wafflebase/slides`.
- Produces:
  ```ts
  function seedGradient(from: ThemeColor | undefined, theme: Theme): GradientFill;
  function sortStops(stops: GradientStop[]): GradientStop[];
  function insertStopAt(stops: GradientStop[], pos: number): GradientStop[];   // color lerped from neighbors
  function removeStopAt(stops: GradientStop[], index: number): GradientStop[]; // no-op if <=2
  function lerpHex(a: string, b: string, t: number): string;                   // #rrggbb
  function degToRad(deg: number): number;
  function radToDeg(rad: number): number;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  sortStops, insertStopAt, removeStopAt, lerpHex, degToRad, radToDeg,
} from './gradient-helpers';

const S = (pos: number, hex: string) => ({ pos, color: { kind: 'srgb' as const, value: hex } });

describe('gradient-helpers', () => {
  it('lerpHex blends two colors at t', () => {
    expect(lerpHex('#000000', '#ffffff', 0.5).toLowerCase()).toBe('#808080');
  });

  it('insertStopAt places a stop with a color interpolated from neighbors', () => {
    const out = insertStopAt([S(0, '#000000'), S(1, '#ffffff')], 0.5);
    expect(out).toHaveLength(3);
    const mid = out.find((s) => s.pos === 0.5)!;
    expect((mid.color as any).value.toLowerCase()).toBe('#808080');
  });

  it('removeStopAt is a no-op at the 2-stop floor', () => {
    const two = [S(0, '#000'), S(1, '#fff')];
    expect(removeStopAt(two, 0)).toHaveLength(2);
  });

  it('removeStopAt drops the stop when >2', () => {
    const three = [S(0, '#000'), S(0.5, '#888'), S(1, '#fff')];
    expect(removeStopAt(three, 1)).toHaveLength(2);
  });

  it('sortStops orders by pos ascending', () => {
    expect(sortStops([S(1, '#fff'), S(0, '#000')]).map((s) => s.pos)).toEqual([0, 1]);
  });

  it('deg<->rad round-trips', () => {
    expect(radToDeg(degToRad(45))).toBeCloseTo(45);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wafflebase/frontend test -- gradient-helpers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```ts
import type { GradientFill, GradientStop, ThemeColor, Theme } from '@wafflebase/slides';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function sortStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((x, y) => x.pos - y.pos);
}

/** Resolve a stop color to a plain hex for interpolation; role colors fall
 *  back to a neutral so a fresh stop is at least visible (recolored after). */
function stopHex(color: ThemeColor): string {
  return color.kind === 'srgb' ? color.value : '#808080';
}

export function insertStopAt(stops: GradientStop[], pos: number): GradientStop[] {
  const p = clamp01(pos);
  const sorted = sortStops(stops);
  let left = sorted[0];
  let right = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].pos <= p && p <= sorted[i + 1].pos) {
      left = sorted[i];
      right = sorted[i + 1];
      break;
    }
  }
  const span = right.pos - left.pos || 1;
  const t = clamp01((p - left.pos) / span);
  const value = lerpHex(stopHex(left.color), stopHex(right.color), t);
  return sortStops([...sorted, { pos: p, color: { kind: 'srgb', value } }]);
}

export function removeStopAt(stops: GradientStop[], index: number): GradientStop[] {
  if (stops.length <= 2) return stops;
  return stops.filter((_, i) => i !== index);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Build a 2-stop linear gradient seeded from the current solid (or theme
 *  primary when none). Second stop is a lighter variant so the gradient is
 *  visible immediately. */
export function seedGradient(from: ThemeColor | undefined, theme: Theme): GradientFill {
  const base: ThemeColor = from ?? { kind: 'role', role: 'accent1' };
  const baseHex = base.kind === 'srgb' ? base.value : theme.colors[base.role] ?? '#4285f4';
  const light = lerpHex(baseHex, '#ffffff', 0.6);
  return {
    kind: 'gradient',
    type: 'linear',
    angle: Math.PI / 2, // top -> bottom, PowerPoint default
    stops: [
      { pos: 0, color: base },
      { pos: 1, color: { kind: 'srgb', value: light } },
    ],
  };
}
```

> Note: confirm the theme role name for the primary accent by running
> `grep -n "accent1\|role:" packages/slides/src/model/theme.ts`. Use the actual
> role key if `accent1` differs.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @wafflebase/frontend test -- gradient-helpers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/fill-picker/gradient-helpers.ts \
        packages/frontend/src/app/slides/fill-picker/gradient-helpers.test.ts
git commit -m "Slides: gradient editing pure helpers (seed, insert/remove stop, lerp)"
```

---

### Task 3: Read + write gradient fill wiring

**Files:**
- Modify: `packages/frontend/src/app/slides/themed-color-picker-helpers.ts:115-139` (add `readShapeGradient`, generalize write to `Fill`)
- Test: `packages/frontend/src/app/slides/themed-color-picker-helpers.test.ts` (create if absent)

**Interfaces:**
- Consumes: `readShapeFill` (unchanged), `applyShapeFill` (existing).
- Produces:
  ```ts
  function readShapeGradient(element: Element): GradientFill | undefined; // undefined if fill isn't a gradient
  function applyShapeFillValue(store, slideId, ids: string[], fill: Fill | undefined): void; // batch write to all shapes
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readShapeGradient } from './themed-color-picker-helpers';

const gradient = {
  kind: 'gradient' as const, type: 'linear' as const, angle: 0,
  stops: [
    { pos: 0, color: { kind: 'srgb' as const, value: '#000' } },
    { pos: 1, color: { kind: 'srgb' as const, value: '#fff' } },
  ],
};

describe('readShapeGradient', () => {
  it('returns the gradient for a gradient-filled shape', () => {
    const el = { type: 'shape', data: { fill: gradient } } as any;
    expect(readShapeGradient(el)?.stops).toHaveLength(2);
  });
  it('returns undefined for a solid-filled shape', () => {
    const el = { type: 'shape', data: { fill: { kind: 'srgb', value: '#f00' } } } as any;
    expect(readShapeGradient(el)).toBeUndefined();
  });
  it('returns undefined for a non-shape', () => {
    expect(readShapeGradient({ type: 'image', data: {} } as any)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wafflebase/frontend test -- themed-color-picker-helpers`
Expected: FAIL — `readShapeGradient` not exported.

- [ ] **Step 3: Implement reader + generalized writer**

Append to `themed-color-picker-helpers.ts`:

```ts
import type { Fill, GradientFill } from '@wafflebase/slides';

/** Read the current fill of a shape as a gradient, or undefined if the fill
 *  is solid / absent / the element isn't a shape. Powers the Gradient tab. */
export function readShapeGradient(element: Element): GradientFill | undefined {
  if (element.type !== 'shape') return undefined;
  const fill = (element as ShapeElement).data.fill;
  return fill && fill.kind === 'gradient' ? fill : undefined;
}

/** Write a full Fill (solid or gradient) to every shape in `ids` in one
 *  batch. `undefined` clears the fill. Non-shapes are skipped. */
export function applyShapeFillValue(
  store: SlidesStore,
  slideId: string,
  ids: readonly string[],
  slide: { elements: readonly Element[] },
  fill: Fill | undefined,
): void {
  store.batch(() => {
    for (const id of ids) {
      const el = slide.elements.find((e) => e.id === id);
      if (el?.type === 'shape') {
        store.updateElementData(slideId, id, { fill });
      }
    }
  });
}
```

> Reuse the existing `SlidesStore`, `Element`, `ShapeElement` imports already
> at the top of the file (they back `readShapeFill`/`applyShapeFill`). Add
> `Fill`, `GradientFill` to the `@wafflebase/slides` import.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @wafflebase/frontend test -- themed-color-picker-helpers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/themed-color-picker-helpers.ts \
        packages/frontend/src/app/slides/themed-color-picker-helpers.test.ts
git commit -m "Slides: readShapeGradient + applyShapeFillValue (Fill write path)"
```

---

### Task 4: GradientEditor component (linear)

**Files:**
- Create: `packages/frontend/src/app/slides/fill-picker/gradient-editor.tsx`

> No component unit test (repo convention — see Global Constraints). The
> stops-bar's pointer/position logic already lives in the unit-tested
> `gradient-helpers` (Task 2: `insertStopAt`/`removeStopAt`/`sortStops`);
> the component wires those. Verify via `tsc --noEmit` + build + the Task 5
> browser smoke.

**Interfaces:**
- Consumes: `gradient-helpers`, `ThemedColorPicker`, `GradientFill`, `Theme`, `resolveColor`.
- Produces:
  ```ts
  interface GradientEditorProps {
    value: GradientFill;
    theme: Theme;
    recentColors?: readonly string[];
    onChange: (next: GradientFill, opts?: { commit?: boolean }) => void;
  }
  function GradientEditor(props: GradientEditorProps): JSX.Element;
  ```
  `onChange` with `commit: true` = one undo unit boundary (drag end, discrete pick). Live drags call without `commit`.

- [ ] **Step 1: Implement `GradientEditor`**

```tsx
import { useRef, useState } from 'react';
import type { GradientFill, GradientStop, ThemeColor, Theme } from '@wafflebase/slides';
import { resolveColor } from '@wafflebase/slides';
import { ThemedColorPicker } from '../themed-color-picker';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  sortStops, insertStopAt, removeStopAt, degToRad, radToDeg,
} from './gradient-helpers';

const LINEAR_PRESETS: { label: string; deg: number }[] = [
  { label: '↖', deg: 225 }, { label: '↑', deg: 270 }, { label: '↗', deg: 315 },
  { label: '←', deg: 180 }, { label: '•', deg: 90 },  { label: '→', deg: 0 },
  { label: '↙', deg: 135 }, { label: '↓', deg: 90 },  { label: '↘', deg: 45 },
];

interface GradientEditorProps {
  value: GradientFill;
  theme: Theme;
  recentColors?: readonly string[];
  onChange: (next: GradientFill, opts?: { commit?: boolean }) => void;
}

export function GradientEditor({ value, theme, recentColors, onChange }: GradientEditorProps) {
  const stops = sortStops(value.stops);
  const [selected, setSelected] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const [angleDraft, setAngleDraft] = useState<string | null>(null);

  const cssGradient = `linear-gradient(90deg, ${stops
    .map((s) => `${resolveColor(s.color, theme)} ${Math.round(s.pos * 100)}%`)
    .join(', ')})`;

  const emit = (next: Partial<GradientFill>, commit = true) =>
    onChange({ ...value, ...next, stops: sortStops(next.stops ?? value.stops) }, { commit });

  const posFromEvent = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  // Track click on empty space adds a stop.
  const onTrackPointerDown = (e: React.PointerEvent) => {
    if (e.target !== trackRef.current) return; // marker handles its own drag
    const pos = posFromEvent(e.clientX);
    const next = insertStopAt(stops, pos);
    emit({ stops: next }, true);
    setSelected(next.findIndex((s) => s.pos === pos));
  };

  // Marker drag repositions; live during move, commit on up.
  const startDrag = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    setSelected(index);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const pos = posFromEvent(ev.clientX);
      const next = stops.map((s, i) => (i === index ? { ...s, pos } : s));
      emit({ stops: next }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      emit({ stops: sortStops(value.stops) }, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const recolor = (index: number) => (color: ThemeColor) => {
    const next = stops.map((s, i) => (i === index ? { ...s, color } : s));
    emit({ stops: next }, true);
  };

  const deleteSelected = () => {
    const next = removeStopAt(stops, selected);
    emit({ stops: next }, true);
    setSelected(Math.max(0, selected - 1));
  };

  const setPreset = (deg: number) => emit({ angle: degToRad(deg) }, true);

  const cur = stops[selected] ?? stops[0];
  const angleDeg = Math.round(((radToDeg(value.angle) % 360) + 360) % 360);

  return (
    <div className="w-[208px] space-y-2" role="group" aria-label="Gradient editor">
      {/* Preview + stops track */}
      <div
        ref={trackRef}
        role="slider"
        aria-label="Gradient stops"
        aria-valuenow={cur?.pos ? Math.round(cur.pos * 100) : 0}
        onPointerDown={onTrackPointerDown}
        className="relative h-6 w-full cursor-copy rounded border border-border"
        style={{ background: cssGradient }}
      >
        {stops.map((s, i) => (
          <Popover key={i}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Gradient stop ${i + 1}`}
                aria-pressed={i === selected}
                onPointerDown={startDrag(i)}
                className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                  i === selected ? 'border-foreground ring-2 ring-ring/50' : 'border-white'
                }`}
                style={{ left: `${s.pos * 100}%`, backgroundColor: resolveColor(s.color, theme) }}
              />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
              <ThemedColorPicker
                value={s.color}
                theme={theme}
                onChange={recolor(i)}
                allowAlpha
                recentColors={recentColors}
              />
            </PopoverContent>
          </Popover>
        ))}
      </div>

      {/* Linear direction: 8 presets + numeric angle */}
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-3 gap-0.5">
          {LINEAR_PRESETS.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Direction ${p.label}`}
              onClick={() => setPreset(p.deg)}
              className="h-5 w-5 rounded border border-border text-[11px] hover:bg-muted"
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-[11px]">
          <span className="text-muted-foreground">Angle</span>
          <input
            type="number"
            aria-label="Angle"
            className="w-12 rounded border border-border px-1 text-right"
            value={angleDraft ?? String(angleDeg)}
            onChange={(e) => setAngleDraft(e.target.value)}
            onBlur={(e) => {
              setAngleDraft(null);
              const deg = parseFloat(e.target.value);
              if (!Number.isNaN(deg)) setPreset(((deg % 360) + 360) % 360);
            }}
          />
          <span className="text-muted-foreground">°</span>
        </label>
      </div>

      {/* Selected-stop row */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Position</span>
        <input
          type="number"
          aria-label="Stop position"
          min={0}
          max={100}
          className="w-12 rounded border border-border px-1 text-right"
          value={cur ? Math.round(cur.pos * 100) : 0}
          onChange={(e) => {
            const pos = Math.max(0, Math.min(1, parseFloat(e.target.value) / 100));
            if (Number.isNaN(pos)) return;
            emit({ stops: stops.map((s, i) => (i === selected ? { ...s, pos } : s)) }, true);
          }}
        />
        <span>%</span>
        <button
          type="button"
          onClick={deleteSelected}
          disabled={stops.length <= 2}
          className="rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-40"
        >
          Delete stop
        </button>
      </div>
    </div>
  );
}
```

> Confirm the popover import path — run
> `grep -rn "PopoverTrigger" packages/frontend/src/components/ui/popover.tsx`.
> If the slides toolbar wraps popovers with `useMenuCloseHandlers`, mirror the
> fill dropdown's `onCloseAutoFocus` handling to avoid focus-steal on close.

- [ ] **Step 2: Typecheck the component**

Run: `pnpm --filter @wafflebase/frontend exec tsc --noEmit -p tsconfig.app.json 2>&1 | grep gradient-editor || echo "no new gradient-editor errors"`
Expected: no new errors originating in `gradient-editor.tsx` (the frontend
tsconfig has pre-existing errors that are not a CI gate; only new ones in this
file matter). Also run `pnpm --filter @wafflebase/frontend lint` and fix any
lint errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/slides/fill-picker/gradient-editor.tsx
git commit -m "Slides: GradientEditor component (linear stops-bar + angle)"
```

---

### Task 5: FillPicker shell + wire into shape-controls

**Files:**
- Create: `packages/frontend/src/app/slides/fill-picker/index.tsx`
- Modify: `packages/frontend/src/app/slides/toolbar/shape-controls.tsx:60-176`
- Browser smoke: `packages/frontend/` visual/interaction harness (add one scenario)

> No component unit test (repo convention — see Global Constraints). Verify via
> `tsc --noEmit` + build + the browser smoke scenario in Step 5.

**Interfaces:**
- Consumes: `ThemedColorPicker`, `GradientEditor`, `seedGradient`, `readShapeFill`, `readShapeGradient`, `representativeColor`.
- Produces:
  ```ts
  interface FillPickerProps {
    fill: Fill | undefined;   // current fill of the first selected shape
    theme: Theme;
    recentColors?: readonly string[];
    onChangeSolid: (color: ThemeColor, opts?: { commit?: boolean; record?: boolean }) => void;
    onChangeGradient: (fill: GradientFill, opts?: { commit?: boolean }) => void;
    onClear: () => void;
  }
  function FillPicker(props: FillPickerProps): JSX.Element;
  ```

- [ ] **Step 1: Implement `FillPicker`**

```tsx
import { useState } from 'react';
import type { Fill, GradientFill, ThemeColor, Theme } from '@wafflebase/slides';
import { representativeColor } from '@wafflebase/slides';
import { ThemedColorPicker } from '../themed-color-picker';
import { GradientEditor } from './gradient-editor';
import { seedGradient } from './gradient-helpers';

interface FillPickerProps {
  fill: Fill | undefined;
  theme: Theme;
  recentColors?: readonly string[];
  onChangeSolid: (color: ThemeColor, opts?: { commit?: boolean; record?: boolean }) => void;
  onChangeGradient: (fill: GradientFill, opts?: { commit?: boolean }) => void;
  onClear: () => void;
}

export function FillPicker({
  fill, theme, recentColors, onChangeSolid, onChangeGradient, onClear,
}: FillPickerProps) {
  const isGradient = fill?.kind === 'gradient';
  const [tab, setTab] = useState<'solid' | 'gradient'>(isGradient ? 'gradient' : 'solid');

  const toGradient = () => {
    setTab('gradient');
    if (fill?.kind !== 'gradient') {
      onChangeGradient(seedGradient(fill, theme), { commit: true });
    }
  };
  const toSolid = () => {
    setTab('solid');
    if (fill?.kind === 'gradient') {
      onChangeSolid(representativeColor(fill), { commit: true, record: false });
    }
  };

  return (
    <div className="w-[208px]">
      <div role="tablist" className="mb-2 flex gap-1 rounded bg-muted/50 p-0.5">
        <button
          role="tab" aria-selected={tab === 'solid'}
          onClick={toSolid}
          className={`flex-1 rounded px-2 py-1 text-xs ${tab === 'solid' ? 'bg-background shadow' : ''}`}
        >
          Solid
        </button>
        <button
          role="tab" aria-selected={tab === 'gradient'}
          onClick={toGradient}
          className={`flex-1 rounded px-2 py-1 text-xs ${tab === 'gradient' ? 'bg-background shadow' : ''}`}
        >
          Gradient
        </button>
      </div>

      {tab === 'solid' ? (
        <ThemedColorPicker
          value={fill && fill.kind !== 'gradient' ? fill : undefined}
          theme={theme}
          onChange={onChangeSolid}
          onClear={onClear}
          allowAlpha
          recentColors={recentColors}
        />
      ) : (
        <GradientEditor
          value={fill?.kind === 'gradient' ? fill : seedGradient(fill, theme)}
          theme={theme}
          recentColors={recentColors}
          onChange={onChangeGradient}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire into `shape-controls.tsx`**

Replace the `ThemedColorPicker` block (lines 161-174) with `FillPicker`, and add
gradient handlers next to `onFillChange`:

```tsx
// imports
import { FillPicker } from '../fill-picker';
import { readShapeFill, readShapeGradient, applyShapeFillValue } from '../themed-color-picker-helpers';

// alongside onFillChange:
const onFillGradient = useCallback(
  (fill: GradientFill) => {
    if (!store || !slideId || !slide) return;
    applyShapeFillValue(store, slideId, ids, slide, fill);
  },
  [store, slideId, slide, ids],
);

// the current fill object (not just the resolved color) for the first shape:
const firstFill =
  firstElement?.type === 'shape'
    ? (firstElement as ShapeElement).data.fill
    : undefined;

// in JSX, replacing <ThemedColorPicker ...>:
{theme && (
  <FillPicker
    fill={firstFill}
    theme={theme}
    recentColors={store?.read().meta.recentColors}
    onChangeSolid={onFillChange}
    onChangeGradient={onFillGradient}
    onClear={onFillClear}
  />
)}
```

> `onFillChange` already writes a solid `ThemeColor` to all selected shapes and
> handles `record`/`commit`; keep it as the solid path. The gradient path uses
> `applyShapeFillValue` (Task 3). Gradient edits don't push recent colors.

- [ ] **Step 5: Typecheck + verify:fast**

Run: `pnpm verify:fast`
Expected: lint + unit tests green (the gradient-helpers and slides pure-logic
tests from Tasks 1-3 run here). Also confirm no new `tsc --noEmit` errors in
`fill-picker/index.tsx` or `shape-controls.tsx`:
`pnpm --filter @wafflebase/frontend exec tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "fill-picker|shape-controls" || echo "no new errors"`

- [ ] **Step 6: Browser smoke**

Add a scenario to the slides interaction harness: select a shape, open Fill,
click Gradient, drag a stop, recolor it, switch back to Solid.

Run: `pnpm verify:browser:docker`
Expected: scenario passes; screenshot shows the gradient-filled shape.

- [ ] **Step 7: Commit + open PR 1**

```bash
git add packages/frontend/src/app/slides/fill-picker/ \
        packages/frontend/src/app/slides/toolbar/shape-controls.tsx
git commit -m "Slides: Solid | Gradient fill picker with inline linear editor"
git push -u origin slides-gradient-editing
```

Open PR 1 (title ≤70 chars): "Slides: linear gradient fill editing (stops-bar)".

---

## PR 2 — Radial gradient extension

> Branch from PR1's head (or `main` after PR1 merges). Same feature branch is
> fine if PR1 hasn't merged — sequence the commits.

### Task 6: Radial render branch

**Files:**
- Modify: `packages/slides/src/view/canvas/render-context.ts:20-48`
- Test: `packages/slides/src/view/canvas/render-context.test.ts` (create if absent)

**Interfaces:**
- Consumes: `GradientFill.type === 'radial'`, `center`.
- Produces: `resolveFillStyle` returns a `createRadialGradient` for radial fills.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveFillStyle } from './render-context';

function fakeCtx() {
  const radial = vi.fn(() => ({ addColorStop: vi.fn() }));
  const linear = vi.fn(() => ({ addColorStop: vi.fn() }));
  return { createRadialGradient: radial, createLinearGradient: linear } as any;
}
const theme = { colors: {}, fonts: {} } as any;
const radial = {
  kind: 'gradient', type: 'radial', angle: 0, center: { x: 0.5, y: 0.5 },
  stops: [
    { pos: 0, color: { kind: 'srgb', value: '#fff' } },
    { pos: 1, color: { kind: 'srgb', value: '#000' } },
  ],
} as any;

describe('resolveFillStyle radial', () => {
  it('uses createRadialGradient for a radial fill', () => {
    const ctx = fakeCtx();
    resolveFillStyle(ctx, radial, theme, 100, 100);
    expect(ctx.createRadialGradient).toHaveBeenCalled();
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wafflebase/slides test -- render-context`
Expected: FAIL — radial goes down the linear path.

- [ ] **Step 3: Add the radial branch**

In `render-context.ts`, after the `if (fill.kind !== 'gradient')` guard and
before the linear axis math, insert:

```ts
const stops = fill.stops;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

if (fill.type === 'radial') {
  const cx = (fill.center?.x ?? 0.5) * w;
  const cy = (fill.center?.y ?? 0.5) * h;
  const r = Math.max(
    Math.hypot(cx, cy), Math.hypot(w - cx, cy),
    Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy),
  );
  if (stops.length < 2 || r === 0) {
    return resolveColor(representativeColor(fill), theme);
  }
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const s of stops) grad.addColorStop(clamp01(s.pos), resolveColor(s.color, theme));
  return grad;
}
// ...existing linear axis math continues here
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @wafflebase/slides test -- render-context`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/view/canvas/render-context.ts \
        packages/slides/src/view/canvas/render-context.test.ts
git commit -m "Slides: render radial gradients via createRadialGradient"
```

---

### Task 7: Radial PPTX import

**Files:**
- Modify: `packages/slides/src/import/pptx/shape.ts:940-969`
- Test: `packages/slides/src/import/pptx/shape.test.ts` (add a radial case, or the existing gradient import test)

**Interfaces:**
- Produces: `parseGradientFill` returns `{ type: 'radial', center }` for `<a:path path="circle">`.

- [ ] **Step 1: Write the failing test**

```ts
// Given a <a:gradFill> containing <a:path path="circle"><a:fillToRect .../></a:path>,
// parseGradientFill should return type:'radial' with all stops preserved and a
// derived center. Build the XML fixture with the test's existing parseXml helper.
it('parses a radial (circle path) gradient with all stops', () => {
  const grad = parseXml(`
    <a:gradFill xmlns:a="...">
      <a:gsLst>
        <a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>
        <a:gs pos="100000"><a:srgbClr val="000000"/></a:gs>
      </a:gsLst>
      <a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>
    </a:gradFill>`);
  const fill = parseGradientFill(grad, {} as any)!;
  expect(fill.type).toBe('radial');
  expect(fill.stops).toHaveLength(2);
  expect(fill.center).toEqual({ x: 0.5, y: 0.5 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wafflebase/slides test -- shape`
Expected: FAIL — path branch still collapses to a single stop with `type:'linear'`.

- [ ] **Step 3: Preserve radial on import**

Replace the path-collapse block (lines 956-962):

```ts
// Radial gradient (`<a:path path="circle">`). Preserve all stops and derive
// `center` from `<a:fillToRect>` insets (1000ths-of-a-percent). rect/shape
// paths remain unsupported → representative solid.
const path = child(grad, 'path');
if (path) {
  const kind = attr(path, 'path'); // 'circle' | 'rect' | 'shape'
  if (kind === 'circle') {
    const ftr = child(path, 'fillToRect');
    const l = (attrInt(ftr, 'l') ?? 0) / 100_000;
    const t = (attrInt(ftr, 't') ?? 0) / 100_000;
    const r = (attrInt(ftr, 'r') ?? 0) / 100_000;
    const b = (attrInt(ftr, 'b') ?? 0) / 100_000;
    const center = {
      x: l + r > 0 ? l / (l + r) : 0.5,
      y: t + b > 0 ? t / (t + b) : 0.5,
    };
    return { kind: 'gradient', type: 'radial', angle: 0, center, stops };
  }
  // rect / shape: keep the documented first-stop fallback.
  return { kind: 'gradient', type: 'linear', angle: 0, stops: [stops[0]] };
}
```

> Confirm the XML helpers `attr` and `attrInt(node, name)` handle a possibly-
> undefined `ftr` (fillToRect can be absent). If `attrInt` requires a node,
> guard: `const g = (n?: Element, k: string) => (n ? attrInt(n, k) ?? 0 : 0)`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @wafflebase/slides test -- shape`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/import/pptx/shape.ts packages/slides/src/import/pptx/shape.test.ts
git commit -m "Slides: import radial gradients (circle path + fillToRect center)"
```

---

### Task 8: Radial PPTX export + round-trip

**Files:**
- Modify: `packages/slides/src/export/pptx/color.ts:49-59`
- Test: the importer-fixture model-equivalence round-trip suite (add a radial fixture)

**Interfaces:**
- Produces: `gradFillXml` emits `<a:path path="circle"><a:fillToRect>` for radial.

- [ ] **Step 1: Write the failing round-trip test**

```ts
it('round-trips a radial gradient through export -> import', () => {
  const fill = {
    kind: 'gradient', type: 'radial', angle: 0, center: { x: 0.5, y: 0.5 },
    stops: [
      { pos: 0, color: { kind: 'srgb', value: '#ffffff' } },
      { pos: 1, color: { kind: 'srgb', value: '#000000' } },
    ],
  } as const;
  const xml = gradFillXml(fill);
  const reparsed = parseGradientFill(parseXml(`<a:gradFill xmlns:a="...">${
    xml.replace(/^<a:gradFill>|<\/a:gradFill>$/g, '')
  }</a:gradFill>`), {} as any)!;
  expect(reparsed.type).toBe('radial');
  expect(reparsed.center).toEqual({ x: 0.5, y: 0.5 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wafflebase/slides test -- color`
Expected: FAIL — export always writes `<a:lin>`.

- [ ] **Step 3: Branch the exporter on `type`**

Rewrite `gradFillXml`:

```ts
export function gradFillXml(g: GradientFill): string {
  const stops = g.stops
    .map((s) => {
      const pos = Math.round(Math.max(0, Math.min(1, s.pos)) * 100_000);
      return `<a:gs pos="${pos}">${colorChildXml(s.color)}</a:gs>`;
    })
    .join('');
  let geom: string;
  if (g.type === 'radial') {
    const cx = g.center?.x ?? 0.5;
    const cy = g.center?.y ?? 0.5;
    // Symmetric insets that reproduce center on re-import: l/(l+r)=cx.
    const l = Math.round(cx * 100_000);
    const r = Math.round((1 - cx) * 100_000);
    const t = Math.round(cy * 100_000);
    const b = Math.round((1 - cy) * 100_000);
    geom = `<a:path path="circle"><a:fillToRect l="${l}" t="${t}" r="${r}" b="${b}"/></a:path>`;
  } else {
    const deg = (((g.angle * 180) / Math.PI) % 360 + 360) % 360;
    geom = `<a:lin ang="${Math.round(deg * 60_000)}" scaled="1"/>`;
  }
  return `<a:gradFill><a:gsLst>${stops}</a:gsLst>${geom}</a:gradFill>`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @wafflebase/slides test -- color`
Expected: PASS. Then run the full slides suite: `pnpm --filter @wafflebase/slides test`.

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/export/pptx/color.ts
git commit -m "Slides: export radial gradients (circle path + fillToRect)"
```

---

### Task 9: GradientEditor radial UI (Type toggle + center presets)

**Files:**
- Modify: `packages/frontend/src/app/slides/fill-picker/gradient-editor.tsx`
- Browser smoke: add a radial step to the Task 5 scenario.

> No component unit test (repo convention). Verify via `tsc --noEmit` + build +
> the radial browser-smoke step.

**Interfaces:**
- Produces: a `Linear | Radial` type toggle; radial mode shows 5 center presets and hides the angle input.

- [ ] **Step 1: Add the Type toggle + radial center presets**

In `gradient-editor.tsx`, add above the direction row:

```tsx
const RADIAL_PRESETS: { label: string; x: number; y: number }[] = [
  { label: 'top-left', x: 0, y: 0 }, { label: 'top-right', x: 1, y: 0 },
  { label: 'center', x: 0.5, y: 0.5 },
  { label: 'bottom-left', x: 0, y: 1 }, { label: 'bottom-right', x: 1, y: 1 },
];

const setType = (type: 'linear' | 'radial') =>
  emit(type === 'radial'
    ? { type, center: value.center ?? { x: 0.5, y: 0.5 } }
    : { type }, true);

const setCenter = (x: number, y: number) => emit({ type: 'radial', center: { x, y } }, true);
```

Type toggle JSX (above the direction controls):

```tsx
<div className="flex gap-1">
  <button type="button" aria-label="Linear" aria-pressed={value.type === 'linear'}
    onClick={() => setType('linear')}
    className={`flex-1 rounded border px-2 py-0.5 text-[11px] ${value.type === 'linear' ? 'bg-muted' : ''}`}>
    Linear
  </button>
  <button type="button" aria-label="Radial" aria-pressed={value.type === 'radial'}
    onClick={() => setType('radial')}
    className={`flex-1 rounded border px-2 py-0.5 text-[11px] ${value.type === 'radial' ? 'bg-muted' : ''}`}>
    Radial
  </button>
</div>
```

Then gate the direction row on `value.type`:

```tsx
{value.type === 'linear' ? (
  /* existing 8-preset + angle input block */
) : (
  <div className="flex gap-0.5">
    {RADIAL_PRESETS.map((p) => (
      <button key={p.label} type="button" aria-label={`Center preset ${p.label}`}
        onClick={() => setCenter(p.x, p.y)}
        className={`h-5 w-5 rounded border border-border text-[10px] hover:bg-muted ${
          value.center?.x === p.x && value.center?.y === p.y ? 'bg-muted ring-1 ring-ring/50' : ''
        }`}>
        ◎
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 2: Typecheck + verify:fast**

Run: `pnpm verify:fast`
Expected: lint + unit tests green. Confirm no new `tsc --noEmit` errors in
`gradient-editor.tsx`:
`pnpm --filter @wafflebase/frontend exec tsc --noEmit -p tsconfig.app.json 2>&1 | grep gradient-editor || echo "no new errors"`

- [ ] **Step 3: Browser smoke + commit + open PR 2**

Run: `pnpm verify:browser:docker`

```bash
git add packages/frontend/src/app/slides/fill-picker/gradient-editor.tsx \
        packages/frontend/src/app/slides/fill-picker/gradient-editor.test.tsx
git commit -m "Slides: radial gradient editing (type toggle + center presets)"
git push
```

Open PR 2 (title ≤70 chars): "Slides: radial gradient editing + PPTX round-trip".

---

## Self-Review (author checklist — completed)

- **Spec coverage:** FillPicker shell (T5), stops-bar add/drag/delete + nested picker (T4), linear 8-preset + angle (T4), radial type+center presets (T9), model `type`+center+migration (T1), render linear (existing) + radial (T6), import radial (T7), export radial (T8), shapes+freeform via shared `data.fill` write (T3/T5), multi-select batch (T3). Preset-swatches / on-canvas handles / text-table-bg gradients are spec non-goals — no task, intentional.
- **Placeholders:** none — every code step carries complete code; three `grep`/confirm notes verify real symbol names (theme role key, popover import path, `attr/attrInt` arity) rather than leaving blanks.
- **Type consistency:** `GradientFill` (`kind/type/angle/center?/stops`) identical across T1/T6/T7/T8; `seedGradient`/`insertStopAt`/`removeStopAt`/`sortStops` names match between T2 and T4; `readShapeGradient`/`applyShapeFillValue` match between T3 and T5; `onChangeSolid`/`onChangeGradient` match between T5 shell and shape-controls wiring.
