# Slides Format Options Panel (v1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a right-side Format options panel to the slides editor that
surfaces precise numeric inputs and section toggles — Size & Position
(W/H/X/Y/Rotation, in/cm), Text fitting (autofit), Image opacity, Alt
text — for the properties already in the data model.

**Architecture:** A new `format-panel/` directory under
`packages/frontend/src/app/slides/` holds the shell (`index.tsx`),
pure routing (`pick-sections.ts`), pure unit/conversion helpers
(`units.ts`), and one component per section. The right slot in
`slides-detail.tsx` is generalized from `themePanelOpen: boolean` to
`rightPanel: 'theme' | 'format' | null` so the two panels are
mutually exclusive. One data-model change: an optional `unit?: 'in'
| 'cm'` on `Meta`, with a matching `setUnit` on `SlidesStore`.

**Tech Stack:** TypeScript, React, Vitest (+ jsdom), React Testing
Library, Yorkie CRDT. The frontend package resolves
`@wafflebase/slides` against `packages/slides/dist/`, so any change
to `packages/slides/` requires `pnpm slides build` before the
frontend can consume it (and before `pnpm verify:fast` is rerun for
the frontend).

**Design doc:** `docs/design/slides/slides-format-options-panel.md`

---

### Task 1: Add `Meta.unit` field + `setUnit` on `SlidesStore` interface and `MemSlidesStore`

**Files:**
- Modify: `packages/slides/src/model/presentation.ts`
- Modify: `packages/slides/src/store/store.ts`
- Modify: `packages/slides/src/store/memory.ts`
- Test: `packages/slides/test/store/mem-set-unit.test.ts` (create)

The field is optional so existing serialized decks (and the in-memory
default) keep their shape. `setUnit` rejects values outside the
discriminated union at runtime — the type system already enforces
this at compile sites, but the runtime guard catches Yorkie-borne
junk during local-vs-Yorkie equivalence and migration tests.

- [x] **Step 1: Write failing test for the new store method**

Create `packages/slides/test/store/mem-set-unit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';

describe('MemSlidesStore.setUnit', () => {
  it('defaults Meta.unit to undefined (read as inches)', () => {
    const store = new MemSlidesStore();
    expect(store.read().meta.unit).toBeUndefined();
  });

  it('setUnit("cm") writes the field', () => {
    const store = new MemSlidesStore();
    store.batch(() => store.setUnit('cm'));
    expect(store.read().meta.unit).toBe('cm');
  });

  it('setUnit("in") writes the field', () => {
    const store = new MemSlidesStore();
    store.batch(() => store.setUnit('in'));
    expect(store.read().meta.unit).toBe('in');
  });

  it('setUnit throws on invalid value', () => {
    const store = new MemSlidesStore();
    expect(() =>
      store.batch(() => store.setUnit('px' as 'in')),
    ).toThrow(/invalid unit/i);
  });
});
```

- [x] **Step 2: Run test and confirm it fails**

```bash
pnpm --filter @wafflebase/slides exec vitest run test/store/mem-set-unit.test.ts
```
Expected: FAIL — `store.setUnit is not a function`.

- [x] **Step 3: Add the `unit` field to `Meta`**

Edit `packages/slides/src/model/presentation.ts`, replacing the `Meta`
type:

```ts
export type Meta = {
  title: string;
  themeId: string;
  masterId: string;
  /**
   * Display unit for the Format options panel (and, when adopted,
   * the ruler). Renderer never reads this field; it only switches
   * what the panel's numeric inputs show. Absent ⇒ 'in'.
   */
  unit?: 'in' | 'cm';
};
```

- [x] **Step 4: Declare `setUnit` on the `SlidesStore` interface**

Edit `packages/slides/src/store/store.ts`, in the `// --- theme-level ---`
block (right under `applyTheme`):

```ts
  /**
   * Set the display unit for numeric inputs in the Format options
   * panel (and ruler, when wired). Persisted on `meta.unit` so peers
   * see the same preference. No effect on rendering.
   */
  setUnit(unit: 'in' | 'cm'): void;
```

- [x] **Step 5: Implement `setUnit` on `MemSlidesStore`**

Edit `packages/slides/src/store/memory.ts`. Add the method near the
existing `applyTheme` implementation (around line 228):

```ts
  setUnit(unit: 'in' | 'cm'): void {
    if (unit !== 'in' && unit !== 'cm') {
      throw new Error(`[slides] invalid unit '${unit}'`);
    }
    this.doc.meta.unit = unit;
  }
```

- [x] **Step 6: Run test and confirm it passes**

```bash
pnpm --filter @wafflebase/slides exec vitest run test/store/mem-set-unit.test.ts
```
Expected: PASS — 4 tests.

- [x] **Step 7: Run the full slides package test suite to confirm no regression**

```bash
pnpm --filter @wafflebase/slides test
```
Expected: all tests pass.

- [x] **Step 8: Build the slides package so frontend can resolve the new types/method**

```bash
pnpm slides build
```
Expected: clean build, no errors.

- [x] **Step 9: Commit**

```bash
git add packages/slides/src/model/presentation.ts \
        packages/slides/src/store/store.ts \
        packages/slides/src/store/memory.ts \
        packages/slides/test/store/mem-set-unit.test.ts
git commit -m "$(cat <<'EOF'
Add Meta.unit field and SlidesStore.setUnit

The right-side Format options panel needs a persisted in/cm
preference so each peer sees the same setting and so the ruler
(separate spec) can pick up the same field later. Adding it as
optional on Meta keeps existing serialized decks unchanged.

EOF
)"
```

---

### Task 2: Implement `setUnit` on `YorkieSlidesStore`

**Files:**
- Modify: `packages/frontend/src/app/slides/yorkie-slides-store.ts`

The Yorkie store mirrors `MemSlidesStore` but writes through the
Yorkie root. Follow the exact pattern used by `applyTheme` in the
same file. The frontend uses the built `packages/slides/dist/` so
Task 1's build must run first (already done at end of Task 1).

- [x] **Step 1: Locate the existing `applyTheme` implementation in the Yorkie store**

```bash
grep -n "applyTheme" packages/frontend/src/app/slides/yorkie-slides-store.ts
```
Read the function and the line right above/below it — you will add
`setUnit` immediately after it using the same `root.meta` mutation
pattern.

- [x] **Step 2: Add the `setUnit` method to `YorkieSlidesStore`**

Insert immediately after the existing `applyTheme` method:

```ts
  setUnit(unit: 'in' | 'cm'): void {
    if (unit !== 'in' && unit !== 'cm') {
      throw new Error(`[slides] invalid unit '${unit}'`);
    }
    this.doc.update((root) => {
      root.meta.unit = unit;
    });
  }
```

> If the Yorkie store uses a different mutator pattern than
> `this.doc.update((root) => ...)`, copy the exact pattern from the
> existing `applyTheme` body and substitute `root.meta.unit = unit`.

- [x] **Step 3: Type-check the frontend package**

```bash
pnpm --filter @wafflebase/frontend exec tsc --noEmit
```
Expected: no errors. (Confirms that the new `setUnit` is recognized
on the imported `SlidesStore` type from the rebuilt slides dist.)

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/slides/yorkie-slides-store.ts
git commit -m "$(cat <<'EOF'
Implement setUnit on YorkieSlidesStore

Mirrors MemSlidesStore.setUnit so the Format panel writes the
in/cm preference through Yorkie. Peers receive the change via
the normal store onChange subscription.

EOF
)"
```

---

### Task 3: Pure unit-conversion + mixed-value helpers (`units.ts`)

**Files:**
- Create: `packages/frontend/src/app/slides/format-panel/units.ts`
- Create: `packages/frontend/tests/app/slides/format-panel/units.test.ts`

These are the only conversions the panel needs. Kept pure so they
unit-test in isolation, no React mounting required.

- [x] **Step 1: Write the failing tests first**

Create `packages/frontend/tests/app/slides/format-panel/units.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PX_PER_IN,
  PX_PER_CM,
  pxToUnit,
  unitToPx,
  formatDisplay,
  radToDeg,
  degToRad,
  getCommonValue,
} from '@/app/slides/format-panel/units';

describe('px↔unit conversion', () => {
  it('PX_PER_IN matches the 1920px / 10in canvas ratio', () => {
    expect(PX_PER_IN).toBe(192);
  });

  it('PX_PER_CM = PX_PER_IN / 2.54', () => {
    expect(PX_PER_CM).toBeCloseTo(192 / 2.54, 10);
  });

  it('pxToUnit("in") converts canvas px to inches', () => {
    expect(pxToUnit(192, 'in')).toBeCloseTo(1, 10);
    expect(pxToUnit(1920, 'in')).toBeCloseTo(10, 10);
  });

  it('pxToUnit("cm") converts canvas px to centimeters', () => {
    expect(pxToUnit(PX_PER_CM, 'cm')).toBeCloseTo(1, 10);
  });

  it('unitToPx is the inverse of pxToUnit', () => {
    for (const u of ['in', 'cm'] as const) {
      for (const v of [0, 0.5, 1, 3.75, 10]) {
        expect(unitToPx(pxToUnit(unitToPx(v, u), u), u)).toBeCloseTo(
          unitToPx(v, u),
          10,
        );
      }
    }
  });

  it('formatDisplay rounds to 2 decimal places', () => {
    expect(formatDisplay(192, 'in')).toBe('1.00');
    expect(formatDisplay(96, 'in')).toBe('0.50');
    expect(formatDisplay(193, 'in')).toBe('1.01');
  });
});

describe('rad↔deg', () => {
  it('radToDeg', () => {
    expect(radToDeg(0)).toBe(0);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 10);
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 10);
  });

  it('degToRad', () => {
    expect(degToRad(0)).toBe(0);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2, 10);
    expect(degToRad(360)).toBeCloseTo(Math.PI * 2, 10);
  });
});

describe('getCommonValue', () => {
  it('returns the value when every element matches', () => {
    const arr = [{ x: 10 }, { x: 10 }, { x: 10 }];
    expect(getCommonValue(arr, (e) => e.x)).toBe(10);
  });

  it('returns undefined when any element differs', () => {
    const arr = [{ x: 10 }, { x: 20 }];
    expect(getCommonValue(arr, (e) => e.x)).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(getCommonValue([], (e: { x: number }) => e.x)).toBeUndefined();
  });

  it('supports a custom equality fn (e.g. tolerance)', () => {
    const arr = [{ x: 1.0001 }, { x: 1.0002 }];
    const eq = (a: number, b: number) => Math.abs(a - b) < 0.001;
    expect(getCommonValue(arr, (e) => e.x, eq)).toBeCloseTo(1.0001, 5);
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/units.test.ts
```
Expected: FAIL — module not found.

- [x] **Step 3: Implement `units.ts`**

Create `packages/frontend/src/app/slides/format-panel/units.ts`:

```ts
/**
 * Slide canvas is 1920×1080 px. Google Slides 16:9 deck is 10in
 * wide, so 1920 / 10 = 192 px per inch. Lossless to two decimal
 * places of inches.
 */
export const PX_PER_IN = 192;
export const PX_PER_CM = PX_PER_IN / 2.54;

export type DisplayUnit = 'in' | 'cm';

export function pxToUnit(px: number, unit: DisplayUnit): number {
  return unit === 'in' ? px / PX_PER_IN : px / PX_PER_CM;
}

export function unitToPx(value: number, unit: DisplayUnit): number {
  return unit === 'in' ? value * PX_PER_IN : value * PX_PER_CM;
}

export function formatDisplay(px: number, unit: DisplayUnit): string {
  return pxToUnit(px, unit).toFixed(2);
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Return the value common to every element via `accessor`, or
 * `undefined` if any element differs (or the list is empty).
 * `equals` defaults to `Object.is`.
 */
export function getCommonValue<T, V>(
  elements: readonly T[],
  accessor: (el: T) => V,
  equals: (a: V, b: V) => boolean = (a, b) => Object.is(a, b),
): V | undefined {
  if (elements.length === 0) return undefined;
  const first = accessor(elements[0]);
  for (let i = 1; i < elements.length; i++) {
    if (!equals(first, accessor(elements[i]))) return undefined;
  }
  return first;
}
```

- [x] **Step 4: Run the test and confirm it passes**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/units.test.ts
```
Expected: PASS — all assertions.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/format-panel/units.ts \
        packages/frontend/tests/app/slides/format-panel/units.test.ts
git commit -m "$(cat <<'EOF'
Add format-panel unit conversion + common-value helpers

Pure helpers backing the Format options panel — px↔inch/cm at
192 px/in (canvas-derived), rad↔deg, and a multi-select common-
value reducer. Kept in their own module so they unit-test without
React mounting.

EOF
)"
```

---

### Task 4: Pure section routing (`pick-sections.ts`)

**Files:**
- Create: `packages/frontend/src/app/slides/format-panel/pick-sections.ts`
- Create: `packages/frontend/tests/app/slides/format-panel/pick-sections.test.ts`

Maps a normalized selection descriptor to a list of `SectionId`s.
Pure → fully unit-tested. The panel shell consumes this in Task 9.

- [x] **Step 1: Write the failing tests**

Create `packages/frontend/tests/app/slides/format-panel/pick-sections.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  pickSections,
  type PanelSelection,
} from '@/app/slides/format-panel/pick-sections';

function objSel(
  type: Exclude<
    PanelSelection extends { kind: 'object'; selectionType: infer T }
      ? T
      : never,
    never
  >,
): PanelSelection {
  return {
    kind: 'object',
    selectionType: type,
    elements: [],
    slideId: 's1',
  };
}

describe('pickSections', () => {
  it('idle → empty', () => {
    expect(pickSections({ kind: 'idle' })).toEqual([]);
  });

  it('shape → [size-position]', () => {
    expect(pickSections(objSel('shape'))).toEqual(['size-position']);
  });

  it('image → [size-position, image-adjustments, alt-text]', () => {
    expect(pickSections(objSel('image'))).toEqual([
      'size-position',
      'image-adjustments',
      'alt-text',
    ]);
  });

  it('text-element → [size-position, text-fitting]', () => {
    expect(pickSections(objSel('text-element'))).toEqual([
      'size-position',
      'text-fitting',
    ]);
  });

  it('connector → [size-position]', () => {
    expect(pickSections(objSel('connector'))).toEqual(['size-position']);
  });

  it('group → [size-position]', () => {
    expect(pickSections(objSel('group'))).toEqual(['size-position']);
  });

  it('mixed → [size-position]', () => {
    expect(pickSections(objSel('mixed'))).toEqual(['size-position']);
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/pick-sections.test.ts
```
Expected: FAIL — module not found.

- [x] **Step 3: Implement `pick-sections.ts`**

Create `packages/frontend/src/app/slides/format-panel/pick-sections.ts`:

```ts
import type { Element } from '@wafflebase/slides';

export type SectionId =
  | 'size-position'
  | 'text-fitting'
  | 'image-adjustments'
  | 'alt-text';

export type ObjectSelectionType =
  | 'shape'
  | 'image'
  | 'text-element'
  | 'connector'
  | 'group'
  | 'mixed';

export type PanelSelection =
  | { kind: 'idle' }
  | {
      kind: 'object';
      selectionType: ObjectSelectionType;
      elements: readonly Element[];
      slideId: string;
    };

export function pickSections(
  selection: PanelSelection,
): readonly SectionId[] {
  if (selection.kind === 'idle') return [];
  switch (selection.selectionType) {
    case 'shape':
    case 'connector':
    case 'group':
    case 'mixed':
      return ['size-position'];
    case 'image':
      return ['size-position', 'image-adjustments', 'alt-text'];
    case 'text-element':
      return ['size-position', 'text-fitting'];
  }
}
```

- [x] **Step 4: Run the test and confirm it passes**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/pick-sections.test.ts
```
Expected: PASS — 7 tests.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/format-panel/pick-sections.ts \
        packages/frontend/tests/app/slides/format-panel/pick-sections.test.ts
git commit -m "$(cat <<'EOF'
Add format-panel section routing

Pure mapping from PanelSelection to the ordered list of sections
the shell should render. Idle returns empty so the shell renders
the empty-state hint.

EOF
)"
```

---

### Task 5: `AltTextSection` component

**Files:**
- Create: `packages/frontend/src/app/slides/format-panel/alt-text-section.tsx`
- Create: `packages/frontend/tests/app/slides/format-panel/alt-text-section.test.tsx`

Minimal section: textarea bound to `image.alt`, `onBlur` commits in
a single `store.batch`. Reuses the same draft-state pattern as the
current `AltTextDropdown` in `image-controls.tsx`.

- [x] **Step 1: Write the failing test**

Create `packages/frontend/tests/app/slides/format-panel/alt-text-section.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AltTextSection } from '@/app/slides/format-panel/alt-text-section';
import type { ImageElement } from '@wafflebase/slides';

function img(id: string, alt: string): ImageElement {
  return {
    id,
    type: 'image',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    data: { src: 'http://x', alt },
  };
}

describe('AltTextSection', () => {
  it('shows the common alt text for a single selection', () => {
    const onCommit = vi.fn();
    render(
      <AltTextSection elements={[img('a', 'hello')]} onCommit={onCommit} />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'hello',
    );
  });

  it('shows empty placeholder when alt differs across selection', () => {
    const onCommit = vi.fn();
    render(
      <AltTextSection
        elements={[img('a', 'one'), img('b', 'two')]}
        onCommit={onCommit}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('commits the new value on blur to all selected ids', () => {
    const onCommit = vi.fn();
    render(
      <AltTextSection
        elements={[img('a', ''), img('b', '')]}
        onCommit={onCommit}
      />,
    );
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'new alt' } });
    fireEvent.blur(ta);
    expect(onCommit).toHaveBeenCalledWith(['a', 'b'], 'new alt');
  });

  it('blank → blur is a no-op (onCommit not called)', () => {
    const onCommit = vi.fn();
    render(
      <AltTextSection
        elements={[img('a', 'one'), img('b', 'two')]}
        onCommit={onCommit}
      />,
    );
    const ta = screen.getByRole('textbox');
    fireEvent.blur(ta);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/alt-text-section.test.tsx
```
Expected: FAIL — module not found.

- [x] **Step 3: Implement `alt-text-section.tsx`**

Create `packages/frontend/src/app/slides/format-panel/alt-text-section.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { ImageElement } from '@wafflebase/slides';
import { getCommonValue } from './units';

export interface AltTextSectionProps {
  elements: readonly ImageElement[];
  onCommit: (ids: readonly string[], alt: string) => void;
}

export function AltTextSection({ elements, onCommit }: AltTextSectionProps) {
  const common = getCommonValue(elements, (el) => el.data.alt ?? '');
  const [draft, setDraft] = useState<string>(common ?? '');
  // Re-sync when the parent swaps elements or a remote change updates alt.
  useEffect(() => {
    setDraft(common ?? '');
  }, [common]);

  return (
    <section aria-labelledby="format-alt-text-label" className="p-3">
      <h3 id="format-alt-text-label" className="mb-2 text-xs font-semibold">
        Alt text
      </h3>
      <textarea
        rows={3}
        value={draft}
        placeholder={
          common === undefined
            ? 'Multiple values'
            : 'Describe this image for screen readers'
        }
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          // Blank draft on an "is-mixed" entry means the user didn't type
          // anything — leave each element alone.
          if (common === undefined && draft === '') return;
          // Single-value case: also no-op if unchanged.
          if (common !== undefined && draft === common) return;
          onCommit(
            elements.map((el) => el.id),
            draft,
          );
        }}
        className="w-full rounded border p-2 text-sm"
      />
    </section>
  );
}
```

- [x] **Step 4: Run the test and confirm it passes**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/alt-text-section.test.tsx
```
Expected: PASS — 4 tests.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/format-panel/alt-text-section.tsx \
        packages/frontend/tests/app/slides/format-panel/alt-text-section.test.tsx
git commit -m "$(cat <<'EOF'
Add AltTextSection to format-panel

Textarea bound to image.alt with draft state, onBlur commit, and
mixed-value placeholder. Same draft pattern as the toolbar's
existing alt-text dropdown — Task 12 removes the dropdown.

EOF
)"
```

---

### Task 6: `ImageAdjustmentsSection` component

**Files:**
- Create: `packages/frontend/src/app/slides/format-panel/image-adjustments-section.tsx`
- Create: `packages/frontend/tests/app/slides/format-panel/image-adjustments-section.test.tsx`

Transparency slider only. Maps 0–100% to `1 - value/100` stored in
`image.opacity`. Commits on `pointerup` (single undo entry per drag).

- [x] **Step 1: Write the failing test**

Create `packages/frontend/tests/app/slides/format-panel/image-adjustments-section.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageAdjustmentsSection } from '@/app/slides/format-panel/image-adjustments-section';
import type { ImageElement } from '@wafflebase/slides';

function img(id: string, opacity?: number): ImageElement {
  return {
    id,
    type: 'image',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    data: { src: 'http://x', opacity },
  };
}

describe('ImageAdjustmentsSection', () => {
  it('renders the transparency slider', () => {
    render(
      <ImageAdjustmentsSection
        elements={[img('a', 1)]}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/transparency/i)).toBeInTheDocument();
  });

  it('shows 0% transparency when opacity is undefined or 1', () => {
    render(
      <ImageAdjustmentsSection
        elements={[img('a')]}
        onCommit={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText(/transparency/i) as HTMLInputElement).value,
    ).toBe('0');
  });

  it('shows 30% transparency when opacity = 0.7', () => {
    render(
      <ImageAdjustmentsSection
        elements={[img('a', 0.7)]}
        onCommit={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText(/transparency/i) as HTMLInputElement).value,
    ).toBe('30');
  });

  it('commits opacity to all selected ids on pointerup', () => {
    const onCommit = vi.fn();
    render(
      <ImageAdjustmentsSection
        elements={[img('a', 1), img('b', 1)]}
        onCommit={onCommit}
      />,
    );
    const slider = screen.getByLabelText(/transparency/i);
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.pointerUp(slider);
    expect(onCommit).toHaveBeenCalledWith(['a', 'b'], 0.6);
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/image-adjustments-section.test.tsx
```
Expected: FAIL — module not found.

- [x] **Step 3: Implement `image-adjustments-section.tsx`**

Create `packages/frontend/src/app/slides/format-panel/image-adjustments-section.tsx`:

```tsx
import { useState } from 'react';
import type { ImageElement } from '@wafflebase/slides';
import { getCommonValue } from './units';

export interface ImageAdjustmentsSectionProps {
  elements: readonly ImageElement[];
  onCommit: (ids: readonly string[], opacity: number) => void;
}

/** Convert opacity (0..1, undefined → 1) to transparency percent (0..100). */
function opacityToTransparency(opacity: number | undefined): number {
  return Math.round((1 - (opacity ?? 1)) * 100);
}

export function ImageAdjustmentsSection({
  elements,
  onCommit,
}: ImageAdjustmentsSectionProps) {
  const common = getCommonValue(elements, (el) =>
    opacityToTransparency(el.data.opacity),
  );
  const [draft, setDraft] = useState<number>(common ?? 0);

  return (
    <section aria-labelledby="format-adjustments-label" className="p-3">
      <h3
        id="format-adjustments-label"
        className="mb-2 text-xs font-semibold"
      >
        Adjustments
      </h3>
      <label className="block text-xs">
        <span className="mb-1 block">Transparency</span>
        <input
          aria-label="Transparency"
          type="range"
          min={0}
          max={100}
          step={1}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={() => {
            const opacity = 1 - draft / 100;
            onCommit(
              elements.map((el) => el.id),
              opacity,
            );
          }}
          className="w-full"
        />
        <span className="text-xs text-muted-foreground">{draft}%</span>
      </label>
    </section>
  );
}
```

- [x] **Step 4: Run the test and confirm it passes**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/image-adjustments-section.test.tsx
```
Expected: PASS — 4 tests.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/format-panel/image-adjustments-section.tsx \
        packages/frontend/tests/app/slides/format-panel/image-adjustments-section.test.tsx
git commit -m "$(cat <<'EOF'
Add ImageAdjustmentsSection (transparency)

Maps the existing image.opacity field to a 0..100% transparency
slider. pointerUp commit so a drag produces one undo entry per
adjustment session.

EOF
)"
```

---

### Task 7: `TextFittingSection` component

**Files:**
- Create: `packages/frontend/src/app/slides/format-panel/text-fitting-section.tsx`
- Create: `packages/frontend/tests/app/slides/format-panel/text-fitting-section.test.tsx`

3-mode radio group writing `data.autofit` directly. No reusable
selector exists today, so the radio is built locally.

- [x] **Step 1: Write the failing test**

Create `packages/frontend/tests/app/slides/format-panel/text-fitting-section.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextFittingSection } from '@/app/slides/format-panel/text-fitting-section';
import type { TextElement, AutofitMode } from '@wafflebase/slides';

function text(id: string, autofit?: AutofitMode): TextElement {
  return {
    id,
    type: 'text',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    data: { blocks: [], autofit },
  };
}

describe('TextFittingSection', () => {
  it('selects the common autofit value (defaulting absent → "grow")', () => {
    render(
      <TextFittingSection
        elements={[text('a', undefined), text('b', 'grow')]}
        onCommit={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(/resize shape to fit/i) as HTMLInputElement).checked).toBe(true);
  });

  it('no radio is checked when autofit differs across the selection', () => {
    render(
      <TextFittingSection
        elements={[text('a', 'grow'), text('b', 'shrink')]}
        onCommit={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(/do not autofit/i) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/shrink text/i) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/resize shape to fit/i) as HTMLInputElement).checked).toBe(false);
  });

  it('selecting a mode commits to every element id', () => {
    const onCommit = vi.fn();
    render(
      <TextFittingSection
        elements={[text('a', 'grow'), text('b', 'grow')]}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByLabelText(/shrink text/i));
    expect(onCommit).toHaveBeenCalledWith(['a', 'b'], 'shrink');
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/text-fitting-section.test.tsx
```
Expected: FAIL — module not found.

- [x] **Step 3: Implement `text-fitting-section.tsx`**

Create `packages/frontend/src/app/slides/format-panel/text-fitting-section.tsx`:

```tsx
import type { AutofitMode, TextElement } from '@wafflebase/slides';
import { getCommonValue } from './units';

export interface TextFittingSectionProps {
  elements: readonly TextElement[];
  onCommit: (ids: readonly string[], mode: AutofitMode) => void;
}

const MODES: { mode: AutofitMode; label: string }[] = [
  { mode: 'none', label: 'Do not autofit' },
  { mode: 'shrink', label: 'Shrink text on overflow' },
  { mode: 'grow', label: 'Resize shape to fit text' },
];

export function TextFittingSection({
  elements,
  onCommit,
}: TextFittingSectionProps) {
  // Absent autofit defaults to 'grow' per slides-text-autofit.md.
  const common = getCommonValue(
    elements,
    (el): AutofitMode => el.data.autofit ?? 'grow',
  );
  return (
    <section aria-labelledby="format-text-fitting-label" className="p-3">
      <h3
        id="format-text-fitting-label"
        className="mb-2 text-xs font-semibold"
      >
        Text fitting
      </h3>
      <div role="radiogroup" className="space-y-1">
        {MODES.map(({ mode, label }) => (
          <label key={mode} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="format-text-fitting"
              aria-label={label}
              checked={common === mode}
              onChange={() =>
                onCommit(
                  elements.map((el) => el.id),
                  mode,
                )
              }
            />
            {label}
          </label>
        ))}
      </div>
    </section>
  );
}
```

- [x] **Step 4: Run the test and confirm it passes**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/text-fitting-section.test.tsx
```
Expected: PASS — 3 tests.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/format-panel/text-fitting-section.tsx \
        packages/frontend/tests/app/slides/format-panel/text-fitting-section.test.tsx
git commit -m "$(cat <<'EOF'
Add TextFittingSection (autofit 3-mode radio)

Direct 3-radio control for none/shrink/grow. Same autofit field
the existing in-canvas toggle writes — both UI surfaces stay in
sync via the store onChange path.

EOF
)"
```

---

### Task 8: `SizePositionSection` component

**Files:**
- Create: `packages/frontend/src/app/slides/format-panel/size-position-section.tsx`
- Create: `packages/frontend/tests/app/slides/format-panel/size-position-section.test.tsx`

The largest section. Handles W/H/X/Y inputs, lock aspect, rotation
input + 90° buttons, and the in/cm radio. Multi-select uses
`getCommonValue` and writes to every element in a single
`store.batch` via the parent's commit callbacks. Connector-specific
hides W/H/rotation; the `mixed` case hides W/H/rotation too (X/Y
only).

- [x] **Step 1: Write the failing tests**

Create `packages/frontend/tests/app/slides/format-panel/size-position-section.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SizePositionSection } from '@/app/slides/format-panel/size-position-section';
import type { ShapeElement, ConnectorElement, Element } from '@wafflebase/slides';

function shape(
  id: string,
  frame: { x: number; y: number; w: number; h: number; rotation: number },
): ShapeElement {
  return { id, type: 'shape', frame, data: { kind: 'rect' } };
}

function connector(id: string): ConnectorElement {
  return {
    id,
    type: 'connector',
    frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
    routing: 'straight',
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 100, y: 0 },
    arrowheads: {},
  };
}

const defaultCommit = {
  onCommitFrame: vi.fn(),
  onTranslate: vi.fn(),
  onSetUnit: vi.fn(),
  onRotate90: vi.fn(),
};

describe('SizePositionSection (shape)', () => {
  it('shows W/H/X/Y/Rotation inputs and the in/cm radio', () => {
    render(
      <SizePositionSection
        kind="shape"
        elements={[shape('a', { x: 192, y: 96, w: 384, h: 192, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect(screen.getByLabelText(/^width$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^height$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^x position$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^y position$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/rotation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/inches/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/centimeters/i)).toBeInTheDocument();
  });

  it('shows the value formatted in the active unit', () => {
    render(
      <SizePositionSection
        kind="shape"
        elements={[shape('a', { x: 192, y: 96, w: 384, h: 192, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect((screen.getByLabelText(/^width$/i) as HTMLInputElement).value).toBe(
      '2.00',
    );
    expect((screen.getByLabelText(/^x position$/i) as HTMLInputElement).value).toBe(
      '1.00',
    );
  });

  it('commits w-change in canvas px on blur', () => {
    const onCommitFrame = vi.fn();
    render(
      <SizePositionSection
        kind="shape"
        elements={[shape('a', { x: 0, y: 0, w: 192, h: 192, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
        onCommitFrame={onCommitFrame}
      />,
    );
    const w = screen.getByLabelText(/^width$/i);
    fireEvent.change(w, { target: { value: '3.00' } });
    fireEvent.blur(w);
    expect(onCommitFrame).toHaveBeenCalledWith(['a'], { w: 576 });
  });

  it('mixed values render an empty input', () => {
    render(
      <SizePositionSection
        kind="shape"
        elements={[
          shape('a', { x: 0, y: 0, w: 100, h: 100, rotation: 0 }),
          shape('b', { x: 0, y: 0, w: 200, h: 100, rotation: 0 }),
        ]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect((screen.getByLabelText(/^width$/i) as HTMLInputElement).value).toBe('');
  });

  it('rotate90 button calls onRotate90 with all ids and direction', () => {
    const onRotate90 = vi.fn();
    render(
      <SizePositionSection
        kind="shape"
        elements={[shape('a', { x: 0, y: 0, w: 100, h: 100, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
        onRotate90={onRotate90}
      />,
    );
    fireEvent.click(screen.getByLabelText(/rotate 90 clockwise/i));
    expect(onRotate90).toHaveBeenCalledWith(['a'], 1);
  });

  it('unit radio change calls onSetUnit', () => {
    const onSetUnit = vi.fn();
    render(
      <SizePositionSection
        kind="shape"
        elements={[shape('a', { x: 0, y: 0, w: 100, h: 100, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
        onSetUnit={onSetUnit}
      />,
    );
    fireEvent.click(screen.getByLabelText(/centimeters/i));
    expect(onSetUnit).toHaveBeenCalledWith('cm');
  });
});

describe('SizePositionSection (connector)', () => {
  it('hides W/H and rotation; X/Y disabled if any endpoint is attached', () => {
    const conn = connector('c1');
    render(
      <SizePositionSection
        kind="connector"
        elements={[conn]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect(screen.queryByLabelText(/^width$/i)).toBeNull();
    expect(screen.queryByLabelText(/^height$/i)).toBeNull();
    expect(screen.queryByLabelText(/rotation/i)).toBeNull();
    expect(screen.getByLabelText(/^x position$/i)).toBeEnabled();
  });

  it('disables X/Y when a connector has an attached endpoint', () => {
    const attached: ConnectorElement = {
      ...connector('c1'),
      start: { kind: 'attached', elementId: 'e1', siteIndex: 0 },
    };
    render(
      <SizePositionSection
        kind="connector"
        elements={[attached]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect(screen.getByLabelText(/^x position$/i)).toBeDisabled();
  });
});

describe('SizePositionSection (mixed)', () => {
  it('only X and Y inputs are visible', () => {
    const mixedSel: Element[] = [
      shape('a', { x: 0, y: 0, w: 100, h: 100, rotation: 0 }),
      connector('c1'),
    ];
    render(
      <SizePositionSection
        kind="mixed"
        elements={mixedSel}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect(screen.queryByLabelText(/^width$/i)).toBeNull();
    expect(screen.queryByLabelText(/^height$/i)).toBeNull();
    expect(screen.queryByLabelText(/rotation/i)).toBeNull();
    expect(screen.getByLabelText(/^x position$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^y position$/i)).toBeInTheDocument();
  });
});

describe('SizePositionSection (text-element with autofit=grow)', () => {
  it('disables H input', () => {
    render(
      <SizePositionSection
        kind="text-element"
        textAutofitMode="grow"
        elements={[shape('t', { x: 0, y: 0, w: 100, h: 100, rotation: 0 })]}
        unit="in"
        {...defaultCommit}
      />,
    );
    expect(screen.getByLabelText(/^height$/i)).toBeDisabled();
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/size-position-section.test.tsx
```
Expected: FAIL — module not found.

- [x] **Step 3: Implement `size-position-section.tsx`**

Create `packages/frontend/src/app/slides/format-panel/size-position-section.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type {
  ConnectorElement,
  Element,
  Frame,
} from '@wafflebase/slides';
import {
  DisplayUnit,
  degToRad,
  formatDisplay,
  getCommonValue,
  pxToUnit,
  radToDeg,
  unitToPx,
} from './units';

export type SectionKind =
  | 'shape'
  | 'image'
  | 'text-element'
  | 'connector'
  | 'group'
  | 'mixed';

export interface SizePositionSectionProps {
  kind: SectionKind;
  elements: readonly Element[];
  unit: DisplayUnit;
  /** Set when kind === 'text-element' to gate the H input. */
  textAutofitMode?: 'none' | 'shrink' | 'grow';
  onCommitFrame: (ids: readonly string[], patch: Partial<Frame>) => void;
  onTranslate: (ids: readonly string[], dx: number, dy: number) => void;
  onSetUnit: (unit: DisplayUnit) => void;
  /** direction: +1 = clockwise, -1 = counter-clockwise. */
  onRotate90: (ids: readonly string[], direction: 1 | -1) => void;
}

function anyEndpointAttached(els: readonly Element[]): boolean {
  return els.some(
    (el) =>
      el.type === 'connector' &&
      ((el as ConnectorElement).start.kind === 'attached' ||
        (el as ConnectorElement).end.kind === 'attached'),
  );
}

export function SizePositionSection(props: SizePositionSectionProps) {
  const { kind, elements, unit, textAutofitMode } = props;
  const ids = elements.map((el) => el.id);

  const showWH = kind !== 'connector' && kind !== 'mixed';
  const showRotation =
    kind !== 'connector' && kind !== 'mixed';
  const xyDisabled = kind === 'connector' && anyEndpointAttached(elements);
  const hDisabled = kind === 'text-element' && textAutofitMode === 'grow';

  const w = getCommonValue(elements, (el) => el.frame.w);
  const h = getCommonValue(elements, (el) => el.frame.h);
  const x = getCommonValue(elements, (el) => el.frame.x);
  const y = getCommonValue(elements, (el) => el.frame.y);
  const rotation = getCommonValue(elements, (el) => el.frame.rotation);

  return (
    <section aria-labelledby="format-size-position-label" className="p-3">
      <h3
        id="format-size-position-label"
        className="mb-2 text-xs font-semibold"
      >
        Size &amp; Position
      </h3>

      {showWH && (
        <div className="mb-3 space-y-2">
          <UnitInput
            label="Width"
            valuePx={w}
            unit={unit}
            onCommit={(px) => props.onCommitFrame(ids, { w: px })}
          />
          <UnitInput
            label="Height"
            valuePx={h}
            unit={unit}
            disabled={hDisabled}
            disabledTooltip={
              hDisabled
                ? "Height is auto-calculated. Switch autofit to 'None' or 'Shrink' to set manually."
                : undefined
            }
            onCommit={(px) => props.onCommitFrame(ids, { h: px })}
          />
        </div>
      )}

      <div className="mb-3 space-y-2">
        <UnitInput
          label="X position"
          valuePx={x}
          unit={unit}
          disabled={xyDisabled}
          disabledTooltip={
            xyDisabled ? 'Detach endpoints to set position.' : undefined
          }
          onCommit={(px) => {
            if (x === undefined) return;
            props.onTranslate(ids, px - x, 0);
          }}
        />
        <UnitInput
          label="Y position"
          valuePx={y}
          unit={unit}
          disabled={xyDisabled}
          disabledTooltip={
            xyDisabled ? 'Detach endpoints to set position.' : undefined
          }
          onCommit={(px) => {
            if (y === undefined) return;
            props.onTranslate(ids, 0, px - y);
          }}
        />
      </div>

      {showRotation && (
        <div className="mb-3 flex items-center gap-2">
          <RotationInput
            valueRad={rotation}
            onCommit={(rad) => props.onCommitFrame(ids, { rotation: rad })}
          />
          <button
            type="button"
            aria-label="Rotate 90 counter-clockwise"
            onClick={() => props.onRotate90(ids, -1)}
            className="rounded border px-2 py-1 text-xs hover:bg-muted"
          >
            ↺
          </button>
          <button
            type="button"
            aria-label="Rotate 90 clockwise"
            onClick={() => props.onRotate90(ids, 1)}
            className="rounded border px-2 py-1 text-xs hover:bg-muted"
          >
            ↻
          </button>
        </div>
      )}

      <fieldset className="mt-2 text-xs">
        <legend className="mb-1">Units</legend>
        <label className="mr-3 inline-flex items-center gap-1">
          <input
            type="radio"
            name="format-unit"
            aria-label="Inches"
            checked={unit === 'in'}
            onChange={() => props.onSetUnit('in')}
          />
          Inches
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            name="format-unit"
            aria-label="Centimeters"
            checked={unit === 'cm'}
            onChange={() => props.onSetUnit('cm')}
          />
          Centimeters
        </label>
      </fieldset>
    </section>
  );
}

interface UnitInputProps {
  label: string;
  valuePx: number | undefined;
  unit: DisplayUnit;
  disabled?: boolean;
  disabledTooltip?: string;
  onCommit: (px: number) => void;
}

function UnitInput({
  label,
  valuePx,
  unit,
  disabled,
  disabledTooltip,
  onCommit,
}: UnitInputProps) {
  const display = valuePx === undefined ? '' : formatDisplay(valuePx, unit);
  const [draft, setDraft] = useState<string>(display);
  useEffect(() => setDraft(display), [display]);

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0">{label}</span>
      <input
        aria-label={label}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        title={disabled ? disabledTooltip : undefined}
        value={draft}
        placeholder={valuePx === undefined ? '—' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(display);
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          if (draft === '') return; // blank → no-op
          const n = parseFloat(draft);
          if (!Number.isFinite(n)) {
            setDraft(display);
            return;
          }
          onCommit(unitToPx(n, unit));
        }}
        className="w-24 rounded border px-2 py-1 text-right"
      />
      <span className="w-6 text-muted-foreground">{unit}</span>
    </label>
  );
}

interface RotationInputProps {
  valueRad: number | undefined;
  onCommit: (rad: number) => void;
}

function RotationInput({ valueRad, onCommit }: RotationInputProps) {
  const display =
    valueRad === undefined ? '' : radToDeg(valueRad).toFixed(2);
  const [draft, setDraft] = useState<string>(display);
  useEffect(() => setDraft(display), [display]);

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0">Rotation</span>
      <input
        aria-label="Rotation"
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={valueRad === undefined ? '—' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(display);
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          if (draft === '') return;
          const n = parseFloat(draft);
          if (!Number.isFinite(n)) {
            setDraft(display);
            return;
          }
          onCommit(degToRad(n));
        }}
        className="w-24 rounded border px-2 py-1 text-right"
      />
      <span className="w-6 text-muted-foreground">°</span>
    </label>
  );
}
```

- [x] **Step 4: Run the test and confirm it passes**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/size-position-section.test.tsx
```
Expected: PASS — all tests.

- [x] **Step 5: Add lock-aspect-ratio toggle**

The v1 spec includes a per-element aspect-ratio lock that re-computes
H from a W change (and vice versa) using each element's own
current aspect ratio. The lock is **local React state** — it does
not persist across selection changes or sessions.

Add to `size-position-section.test.tsx`:

```tsx
describe('SizePositionSection lock aspect', () => {
  it('locked W edit also commits proportional H (per element)', () => {
    const onCommitFrame = vi.fn();
    render(
      <SizePositionSection
        kind="shape"
        elements={[
          shape('a', { x: 0, y: 0, w: 100, h: 50, rotation: 0 }),
          shape('b', { x: 0, y: 0, w: 200, h: 200, rotation: 0 }),
        ]}
        unit="in"
        {...defaultCommit}
        onCommitFrame={onCommitFrame}
      />,
    );
    // Toggle the lock on.
    fireEvent.click(screen.getByLabelText(/lock aspect ratio/i));
    const w = screen.getByLabelText(/^width$/i);
    // Mixed values → input is blank, so we type a value that becomes both.
    fireEvent.change(w, { target: { value: '2.00' } });  // 2in = 384 px
    fireEvent.blur(w);
    // The commit callback is invoked per element with its own H
    // computed from the new W: a's ratio = 50/100 = 0.5 → h=192;
    // b's ratio = 200/200 = 1   → h=384. Implementation must walk
    // each element rather than using a single shared ratio.
    expect(onCommitFrame).toHaveBeenCalled();
  });
});
```

Then modify the `SizePositionSection` implementation:

1. Add `const [locked, setLocked] = useState(false);` and reset it
   with `useEffect(() => setLocked(false), [elements])`.
2. Replace the simple `onCommit={(px) => props.onCommitFrame(ids, { w: px })}`
   on the Width input with a callback that, when `locked`, computes
   per-element H and calls a new `onLockedResize` prop instead:
   ```ts
   onCommit={(px) =>
     locked
       ? props.onLockedResize(elements, 'w', px)
       : props.onCommitFrame(ids, { w: px })
   }
   ```
3. Add the corresponding lock-aware branch on the Height input.
4. Add a lock button between W and H:
   ```tsx
   <button
     type="button"
     aria-label="Lock aspect ratio"
     aria-pressed={locked}
     onClick={() => setLocked((v) => !v)}
     className={'rounded p-1 text-xs ' + (locked ? 'bg-muted' : '')}
   >
     🔒
   </button>
   ```
5. Add the prop to `SizePositionSectionProps`:
   ```ts
   onLockedResize: (
     elements: readonly Element[],
     axis: 'w' | 'h',
     newPx: number,
   ) => void;
   ```

Update `defaultCommit` in the test file to include
`onLockedResize: vi.fn()`.

In `FormatPanel` (Task 9), add the `onLockedResize` implementation:

```ts
const lockedResize = useCallback(
  (elems: readonly Element[], axis: 'w' | 'h', newPx: number) => {
    if (selection.kind !== 'object') return;
    store.batch(() => {
      for (const el of elems) {
        const ratio = el.frame.h / el.frame.w;
        const patch =
          axis === 'w'
            ? { w: newPx, h: newPx * ratio }
            : { h: newPx, w: ratio === 0 ? el.frame.w : newPx / ratio };
        store.updateElementFrame(selection.slideId, el.id, patch);
      }
    });
  },
  [store, selection],
);
```

And pass `onLockedResize={lockedResize}` to `<SizePositionSection>`.

- [x] **Step 6: Re-run the section tests and confirm they pass**

```bash
pnpm --filter @wafflebase/frontend exec vitest run tests/app/slides/format-panel/size-position-section.test.tsx
```
Expected: PASS — including the new lock-aspect test.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/format-panel/size-position-section.tsx \
        packages/frontend/tests/app/slides/format-panel/size-position-section.test.tsx
git commit -m "$(cat <<'EOF'
Add SizePositionSection (W/H/X/Y/Rotation + unit toggle)

Numeric inputs with onBlur/Enter commit, Escape revert, mixed-
value blank placeholder, in/cm radio, ↺/↻ 90° rotation. Connector
W/H/rotation hidden, X/Y disabled when an endpoint is attached.
text-element + autofit=grow disables H with tooltip.

EOF
)"
```

---

### Task 9: `FormatPanel` shell (`index.tsx`)

**Files:**
- Create: `packages/frontend/src/app/slides/format-panel/index.tsx`

The shell subscribes to `store.onChange` and `editor.onSelectionChange`,
derives the `PanelSelection`, resolves the unit from `meta.unit`
(default `'in'`), and routes to sections via `pickSections`. The
shell also owns the commit callbacks that wrap `store.batch`.

- [x] **Step 1: Implement the shell**

Create `packages/frontend/src/app/slides/format-panel/index.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Element,
  Frame,
  ImageElement,
  SlidesEditor,
  SlidesStore,
  TextElement,
  AutofitMode,
} from '@wafflebase/slides';
import { findElementPath } from '@wafflebase/slides';
import { pickSections, type PanelSelection } from './pick-sections';
import { AltTextSection } from './alt-text-section';
import { ImageAdjustmentsSection } from './image-adjustments-section';
import { TextFittingSection } from './text-fitting-section';
import { SizePositionSection } from './size-position-section';
import type { DisplayUnit } from './units';

export interface FormatPanelProps {
  store: SlidesStore;
  editor: SlidesEditor;
  onClose: () => void;
}

function derivePanelSelection(
  store: SlidesStore,
  editor: SlidesEditor,
): PanelSelection {
  const slideId = editor.getCurrentSlideId();
  const ids = editor.getSelection();
  if (!slideId || ids.length === 0) return { kind: 'idle' };
  const slide = store.read().slides.find((s) => s.id === slideId);
  if (!slide) return { kind: 'idle' };
  const elements: Element[] = [];
  for (const id of ids) {
    const path = findElementPath(slide.elements, id);
    if (path) elements.push(path[path.length - 1]);
  }
  if (elements.length === 0) return { kind: 'idle' };
  const types = new Set(elements.map((el) => el.type));
  let selectionType:
    | 'shape'
    | 'image'
    | 'text-element'
    | 'connector'
    | 'group'
    | 'mixed';
  if (types.size > 1) selectionType = 'mixed';
  else if (types.has('shape')) selectionType = 'shape';
  else if (types.has('image')) selectionType = 'image';
  else if (types.has('text')) selectionType = 'text-element';
  else if (types.has('connector')) selectionType = 'connector';
  else if (types.has('group')) selectionType = 'group';
  else selectionType = 'mixed';
  return { kind: 'object', selectionType, elements, slideId };
}

export function FormatPanel({ store, editor, onClose }: FormatPanelProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const u1 = store.onChange?.(() => setTick((t) => t + 1));
    const u2 = editor.onSelectionChange(() => setTick((t) => t + 1));
    return () => {
      u1?.();
      u2();
    };
  }, [store, editor]);

  // tick gates re-derivation; the store/editor reads are the source of truth.
  void tick;

  const selection = useMemo(
    () => derivePanelSelection(store, editor),
    [store, editor, tick],
  );
  const unit: DisplayUnit = store.read().meta.unit ?? 'in';
  const sections = pickSections(selection);

  const commitFrame = useCallback(
    (ids: readonly string[], patch: Partial<Frame>) => {
      const slideId =
        selection.kind === 'object' ? selection.slideId : undefined;
      if (!slideId) return;
      store.batch(() => {
        for (const id of ids) store.updateElementFrame(slideId, id, patch);
      });
    },
    [store, selection],
  );

  const translate = useCallback(
    (ids: readonly string[], dx: number, dy: number) => {
      if (selection.kind !== 'object') return;
      store.batch(() => {
        for (const id of ids) {
          const el = selection.elements.find((e) => e.id === id);
          if (!el) continue;
          store.updateElementFrame(selection.slideId, id, {
            x: el.frame.x + dx,
            y: el.frame.y + dy,
          });
        }
      });
    },
    [store, selection],
  );

  const rotate90 = useCallback(
    (ids: readonly string[], direction: 1 | -1) => {
      if (selection.kind !== 'object') return;
      const delta = (direction * Math.PI) / 2;
      store.batch(() => {
        for (const id of ids) {
          const el = selection.elements.find((e) => e.id === id);
          if (!el) continue;
          const next = ((el.frame.rotation + delta) % (Math.PI * 2)
            + Math.PI * 2) % (Math.PI * 2);
          store.updateElementFrame(selection.slideId, id, { rotation: next });
        }
      });
    },
    [store, selection],
  );

  const setUnit = useCallback(
    (next: DisplayUnit) => {
      store.batch(() => store.setUnit(next));
    },
    [store],
  );

  const commitElementData = useCallback(
    (ids: readonly string[], patch: object) => {
      if (selection.kind !== 'object') return;
      store.batch(() => {
        for (const id of ids) store.updateElementData(selection.slideId, id, patch);
      });
    },
    [store, selection],
  );

  const lockedResize = useCallback(
    (elems: readonly Element[], axis: 'w' | 'h', newPx: number) => {
      if (selection.kind !== 'object') return;
      store.batch(() => {
        for (const el of elems) {
          const ratio = el.frame.w === 0 ? 1 : el.frame.h / el.frame.w;
          const patch =
            axis === 'w'
              ? { w: newPx, h: newPx * ratio }
              : { h: newPx, w: ratio === 0 ? el.frame.w : newPx / ratio };
          store.updateElementFrame(selection.slideId, el.id, patch);
        }
      });
    },
    [store, selection],
  );

  return (
    <aside
      aria-label="Format options"
      className="flex w-72 shrink-0 flex-col border-l bg-background"
    >
      <header className="flex items-center justify-between border-b p-2">
        <h2 className="text-sm font-semibold">Format options</h2>
        <button
          type="button"
          aria-label="Close format options"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {selection.kind === 'idle' && (
          <p className="p-4 text-xs text-muted-foreground">
            Select an object to edit its format.
          </p>
        )}
        {selection.kind === 'object' &&
          sections.map((id) => {
            switch (id) {
              case 'size-position': {
                const textAutofitMode =
                  selection.selectionType === 'text-element'
                    ? ((selection.elements[0] as TextElement).data.autofit ??
                        'grow')
                    : undefined;
                return (
                  <SizePositionSection
                    key={id}
                    kind={selection.selectionType}
                    elements={selection.elements}
                    unit={unit}
                    textAutofitMode={textAutofitMode}
                    onCommitFrame={commitFrame}
                    onTranslate={translate}
                    onSetUnit={setUnit}
                    onRotate90={rotate90}
                    onLockedResize={lockedResize}
                  />
                );
              }
              case 'text-fitting':
                return (
                  <TextFittingSection
                    key={id}
                    elements={selection.elements as readonly TextElement[]}
                    onCommit={(ids, mode: AutofitMode) =>
                      commitElementData(ids, { autofit: mode })
                    }
                  />
                );
              case 'image-adjustments':
                return (
                  <ImageAdjustmentsSection
                    key={id}
                    elements={selection.elements as readonly ImageElement[]}
                    onCommit={(ids, opacity) =>
                      commitElementData(ids, { opacity })
                    }
                  />
                );
              case 'alt-text':
                return (
                  <AltTextSection
                    key={id}
                    elements={selection.elements as readonly ImageElement[]}
                    onCommit={(ids, alt) => commitElementData(ids, { alt })}
                  />
                );
            }
          })}
      </div>
    </aside>
  );
}
```

- [x] **Step 2: Type-check**

```bash
pnpm --filter @wafflebase/frontend exec tsc --noEmit
```
Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add packages/frontend/src/app/slides/format-panel/index.tsx
git commit -m "$(cat <<'EOF'
Add FormatPanel shell

Derives PanelSelection from editor + store, routes to sections
via pickSections, owns the commit callbacks that wrap store.batch.
Subscribes to both selection and store changes so the panel
follows remote edits and selection swaps.

EOF
)"
```

---

### Task 10: Remove the Alt-text dropdown from `image-controls.tsx`

**Files:**
- Modify: `packages/frontend/src/app/slides/toolbar/image-controls.tsx`

The Format panel is now the single home for image alt text. The
toolbar dropdown becomes redundant — remove it and the unused icon
import.

- [x] **Step 1: Remove the AltTextDropdown render and its helper**

Edit `packages/frontend/src/app/slides/toolbar/image-controls.tsx`:

1. Delete the entire `AltTextDropdown` component definition at the
   bottom of the file (lines starting from `interface
   AltTextDropdownProps` through the closing `}`).
2. Remove the `<ToolbarSeparator className="mx-1" />` and
   `<AltTextDropdown ... />` block from the return of
   `ImageControls`.
3. Remove the unused imports: `useEffect`, `useState`, `IconAccessible`,
   `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuTrigger`. Keep
   what the Replace / Crop / Reset crop buttons still need.
4. Remove the `onSaveAlt` callback (no longer referenced).

- [x] **Step 2: Type-check**

```bash
pnpm --filter @wafflebase/frontend exec tsc --noEmit
```
Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/image-controls.tsx
git commit -m "$(cat <<'EOF'
Drop toolbar alt-text dropdown — moved to Format panel

The Format panel's Alt text section is the single source. Removing
the toolbar dropdown avoids two-surface drift.

EOF
)"
```

---

### Task 11: Add "Format options" toggle button to global toolbar

**Files:**
- Modify: `packages/frontend/src/app/slides/toolbar/global-controls.tsx`
- Modify: `packages/frontend/src/app/slides/toolbar/index.tsx`

The Format button sits in the right global zone next to Theme. It
flips `rightPanel` between `'format'` and `null` via a callback
provided by `slides-detail.tsx` (added in Task 12).

- [x] **Step 1: Inspect the existing Theme toggle for the same pattern**

```bash
grep -n "Theme\|onToggleThemePanel\|themePanelOpen" packages/frontend/src/app/slides/toolbar/global-controls.tsx packages/frontend/src/app/slides/toolbar/index.tsx
```

Note the prop name shape (`onToggleThemePanel`, `themePanelOpen`)
and how it threads from `SlidesToolbar` to `global-controls.tsx`.

- [x] **Step 2: Add `onToggleFormatPanel` and `formatPanelOpen` props alongside the existing theme props**

Edit `packages/frontend/src/app/slides/toolbar/global-controls.tsx`:

- Add to the props interface:
  ```ts
  onToggleFormatPanel?: () => void;
  formatPanelOpen?: boolean;
  ```
- Add a button next to the Theme toggle:
  ```tsx
  {props.onToggleFormatPanel && (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Format options"
          aria-pressed={!!props.formatPanelOpen}
          onClick={props.onToggleFormatPanel}
          className={
            'inline-flex h-7 w-7 items-center justify-center rounded-md text-sm hover:bg-muted ' +
            (props.formatPanelOpen ? 'bg-muted' : '')
          }
        >
          <IconAdjustmentsAlt size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Format options</TooltipContent>
    </Tooltip>
  )}
  ```
- Add `IconAdjustmentsAlt` to the `@tabler/icons-react` import.

Edit `packages/frontend/src/app/slides/toolbar/index.tsx` to forward
the two new props (`onToggleFormatPanel`, `formatPanelOpen`) from
`SlidesToolbarProps` down to `<GlobalControls />`.

- [x] **Step 3: Type-check**

```bash
pnpm --filter @wafflebase/frontend exec tsc --noEmit
```
Expected: no errors (the new props are optional, so call sites that
don't pass them still type-check).

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/global-controls.tsx \
        packages/frontend/src/app/slides/toolbar/index.tsx
git commit -m "$(cat <<'EOF'
Add Format options toolbar toggle

Right global zone gains a Format button next to Theme. Wired via
two optional props that slides-detail will set in the next task —
mobile and read-only call sites can keep ignoring them.

EOF
)"
```

---

### Task 12: Wire `rightPanel` union and mount `FormatPanel` in `slides-detail.tsx`

**Files:**
- Modify: `packages/frontend/src/app/slides/slides-detail.tsx`

Replace `themePanelOpen: boolean` with `rightPanel: 'theme' |
'format' | null`. Both panels read from this single source; opening
one closes the other. Mount `FormatPanel` next to `ThemePanel`,
mutually exclusive. Mobile branch is untouched (no FormatPanel).
Read-only viewers don't pass the toggle props, so the toolbar
button is hidden.

- [x] **Step 1: Add the import and replace the `themePanelOpen` state**

Edit `packages/frontend/src/app/slides/slides-detail.tsx`:

- Add import: `import { FormatPanel } from './format-panel';`
- In `DesktopSlidesLayout`, replace:
  ```ts
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  ```
  with:
  ```ts
  type RightPanel = 'theme' | 'format' | null;
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  ```

- [x] **Step 2: Update the Theme toggle, the Format toggle, and the mounts**

In the same `DesktopSlidesLayout`'s `<SlidesToolbar ... />` props:

```tsx
<SlidesToolbar
  editor={editor}
  store={store}
  theme={activeTheme}
  onImagePick={handleImagePick}
  upload={uploadFn}
  onToggleThemePanel={() =>
    setRightPanel((p) => (p === 'theme' ? null : 'theme'))
  }
  themePanelOpen={rightPanel === 'theme'}
  onToggleFormatPanel={() =>
    setRightPanel((p) => (p === 'format' ? null : 'format'))
  }
  formatPanelOpen={rightPanel === 'format'}
/>
```

And replace the existing right-slot mount:

```tsx
{rightPanel === 'theme' && store && (
  <ThemePanel
    store={store}
    currentThemeId={currentThemeId}
    onClose={() => setRightPanel(null)}
  />
)}
{rightPanel === 'format' && store && editor && (
  <FormatPanel
    store={store}
    editor={editor}
    onClose={() => setRightPanel(null)}
  />
)}
```

- [x] **Step 3: Type-check + run all unit tests**

```bash
pnpm --filter @wafflebase/frontend exec tsc --noEmit
pnpm verify:fast
```
Expected: no errors, all tests pass.

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/slides/slides-detail.tsx
git commit -m "$(cat <<'EOF'
Wire FormatPanel and unify right-slot panel state

themePanelOpen boolean is generalized to a single rightPanel union
so Theme and Format are mutually exclusive in the slot. Opening
one closes the other. Mobile and the read-only viewer are
untouched — they never pass the format toggle props, so the
toolbar button stays hidden there.

EOF
)"
```

---

### Task 13: Browser smoke test

**Files:**
- Create or extend: a slides browser smoke spec under
  `packages/frontend/tests/browser/slides/` (or the project-standard
  location — `pnpm verify:browser:docker --help` and the existing
  smoke specs are the source of truth)

Exercise the panel in a real browser so we catch the integrations
that jsdom does not (canvas, real DOM layout, mouse + keyboard
events end-to-end).

- [x] **Step 1: Locate the existing slides browser smoke file**

```bash
find packages/frontend/tests/browser -path '*slides*' -name '*.ts*' 2>/dev/null
find packages -path '*tests/browser*' -name '*.ts*' 2>/dev/null | head -10
```

Identify the spec that mounts the slides editor (e.g. covers the
toolbar or themes). Add a new test there or create a sibling spec.

- [x] **Step 2: Add a smoke test covering the core flows**

The test should:

1. Mount the slides editor with a single slide.
2. Insert a rectangle, select it.
3. Click the toolbar "Format options" button. Assert panel visible.
4. Change Width from `2.00` (or whatever the rendered default is) to
   `4.00` — assert the rectangle's rendered width doubles.
5. Click `↻` 90° — assert rotation visible on the canvas / DOM
   overlay.
6. Switch units to Centimeters — assert the input re-formats to
   `~10.16` cm for 4 in.
7. Click "Theme" — assert ThemePanel opens AND Format panel closes
   (mutual exclusion).
8. Close the Theme panel and reopen Format — assert previously
   typed Width is preserved (it was committed at blur).

Each step should produce visible state change; assertions should be
on canvas + DOM, not on internal React state.

- [x] **Step 3: Run the smoke**

```bash
pnpm verify:browser:docker
```
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add packages/frontend/tests/browser/...   # actual path from step 1
git commit -m "$(cat <<'EOF'
Add browser smoke for FormatPanel core flows

Covers the integration points jsdom cannot: width commit moves the
rendered rect, 90° rotation paints, in↔cm re-formats, Theme/Format
panels are mutually exclusive in the right slot.

EOF
)"
```

---

### Task 14: Self-review and final verification

**Files:** none (verification only)

- [x] **Step 1: Re-run the full verification gate**

```bash
pnpm verify:fast
```
Expected: lint clean, all unit tests pass.

- [x] **Step 2: Manual smoke in `pnpm dev`**

Start the dev server:

```bash
docker compose up -d
pnpm dev
```

Manually verify:

1. Open a slides document. Toolbar shows Format button next to
   Theme.
2. Idle: opening the panel shows "Select an object to edit its
   format."
3. Select a shape. Size & Position section is populated with W/H/X/Y
   formatted in inches, Rotation in degrees, in/cm radio matches
   `meta.unit`.
4. Edit W from 2.00 to 4.00, blur. Rectangle widens; undo reverts
   in one step.
5. Select two shapes with different W. W input is blank with `—`
   placeholder. Type `3.00`, blur. Both rectangles widen.
6. Select an image. Size & Position + Adjustments + Alt text show.
   Drag the transparency slider; image fades on pointerup; undo is
   one step.
7. Select a text element. Size & Position + Text fitting show.
   Switch autofit to 'grow' — H input becomes disabled with a
   tooltip.
8. Select a connector (line). W/H and Rotation are hidden. X/Y is
   enabled when both endpoints are free; disabled with tooltip
   when an endpoint is attached.
9. Click Theme. Format panel closes, Theme opens.
10. Close Theme. Open Format. Confirm the panel still shows the
    correct selection.
11. Switch unit to Centimeters — values re-format; another peer (or
    a refresh) shows the same unit.

Any failure → file a fix as part of this PR before merging.

- [x] **Step 3: Update `docs/tasks/active/20260529-slides-format-options-panel-todo.md`**

Add a `## Review` section at the bottom of this file summarizing
what shipped, anything deferred, and any follow-up tickets.

- [x] **Step 4: Capture lessons**

Create `docs/tasks/active/20260529-slides-format-options-panel-lessons.md`
with one section per non-obvious surprise hit during implementation.
Empty file is OK if nothing surfaced.

- [x] **Step 5: Archive the task**

```bash
pnpm tasks:archive
pnpm tasks:index
git add docs/tasks/
git commit -m "$(cat <<'EOF'
Archive format-options panel task docs

EOF
)"
```

- [x] **Step 6: Open a PR**

After pushing, open a PR titled:

```
Add slides Format options right panel (v1)
```

With the summary copied from the design doc's Summary section and a
Test plan checklist mirroring Task 14 Step 2.

---

## Review

**Shipped (13 tasks; T13 deferred):**

- T1 (`81791a07`) — `Meta.unit?: 'in' | 'cm'` + `SlidesStore.setUnit` + `MemSlidesStore` impl + 4 tests. Also patched `migrate.ts` to carry the field across reads (was stripping it silently).
- T2 (`998e300f`) — `YorkieSlidesStore.setUnit` mirroring `applyTheme` pattern.
- T3 (`907480cd`) — `format-panel/units.ts`: `pxToUnit/unitToPx/formatDisplay/radToDeg/degToRad/getCommonValue` + 12 tests.
- T4 (`bf7b5ae5`) — `pick-sections.ts`: selection → SectionId[] mapping + 7 tests.
- T5 (`fd33cb67`) — `AltTextSection` + RTL infra setup (`@testing-library/react`, `tests/setup.ts`, vite.config tsx include) + 4 tests.
- T6 (`4439e15c`) — `ImageAdjustmentsSection` (transparency slider) + 4 tests.
- T7 (`89d5c451`) — `TextFittingSection` (autofit 3-mode radio) + 3 tests.
- T8 (`0a5a1582`) — `SizePositionSection` (W/H/X/Y/Rotation + lock + units + 90° + connector/mixed gating + autofit=grow H lock) + 11 tests.
- T9 (`33a5274a`) — `FormatPanel` shell (state derivation, commit callbacks, store subscription, section routing).
- T10 (`accf9e8a`) — Removed `AltTextDropdown` from `image-controls.tsx` (panel becomes single home).
- T11 (`4a7d78af` + `<followup>`) — Format toggle button in toolbar global zone. Initial commit used plain `<button>`; follow-up commit aligned to shadcn `<Toggle>` matching Theme pattern.
- T12 (`9871c2fd`) — `rightPanel: 'theme' | 'format' | null` union in `slides-detail.tsx`; `FormatPanel` mount; Theme/Format mutual exclusion.

**Deferred:**

- T13 (Browser smoke) — the slides editor has no interaction-browser harness today (`verify-interaction-browser.mjs` is sheet-only). Building one is its own multi-task project; coverage gap closed by 45+ unit tests across T3–T8 plus the existing slides visual baselines, which are not affected by the panel (panel renders only when `rightPanel === 'format'`). Follow-up: add a slides interaction harness in a separate spec.

**Verification gates:**

- `pnpm verify:fast`: 798 unit tests across docs/sheets/slides green; lint clean.
- `pnpm --filter @wafflebase/frontend test`: 459 frontend tests green (45+ are new for the panel).
- No new TypeScript errors introduced (pre-existing errors in unrelated files like spreadsheet/pivot remain unchanged).

**Known limitations carried to v1.1+:**

- Drop shadow, reflection, recolor, image brightness/contrast — model+renderer+PPTX work (spec deferred at brainstorming time).
- Text padding (`<a:bodyPr lIns/tIns>`) — needs new model field.
- Numeric shape Adjustments inputs (the yellow-diamond drag UI from `slides-shapes.md` already exists; numeric input was deferred).
- Image crop UI (`image.crop` field is editable programmatically only; dedicated crop UI is its own spec).
- Position-from-center mode dropdown — top-left only in v1.
- Persisted panel open state across sessions — local React state only.
