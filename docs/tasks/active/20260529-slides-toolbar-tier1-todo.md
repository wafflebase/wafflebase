# Slides Toolbar Tier 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five universal slides toolbar controls (Layout split-button, Font size A↑/A↓ steppers, Clear formatting, Zoom dropdown, Format painter) without changing the existing morphing-toolbar state machine.

**Architecture:** Five independent, additively-mounted controls. Three new files in `packages/frontend/src/app/slides/toolbar/` (`layout-button.tsx`, `zoom-control.tsx`, `format-painter.tsx`), one new shared component in `components/text-formatting/text-size-stepper.tsx`, and surgical edits to `text-format-group.tsx`, `text-edit-section.tsx`, `text-element-controls.tsx`, `global-controls.tsx`, `index.tsx`, `slides-view.tsx`, plus thin extensions on `SlidesEditor`, the docs `EditorAPI`, and the slides text-box editor for `clearInlineFormatting` + format-paint state.

**Tech Stack:** React 18, TypeScript, Vitest + jsdom, `@wafflebase/slides`, `@wafflebase/docs`.

Design doc: `docs/design/slides/slides-toolbar-tier1.md`.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/frontend/src/app/slides/toolbar/layout-button.tsx` | "Layout ▾" trigger that opens `showLayoutPicker` for the **current** slide and applies via `store.applyLayout` | Create |
| `packages/frontend/src/components/text-formatting/text-size-stepper.tsx` | Shared A↑ / A↓ buttons that step `fontSize` through `SIZE_STOPS` via `editor.applyStyle({ fontSize })` | Create |
| `packages/frontend/src/components/text-formatting/text-format-group.tsx` | Add "Clear formatting" button calling `editor.clearInlineFormatting()` | Modify |
| `packages/frontend/src/components/text-formatting/types.ts` | Add `clearInlineFormatting(): void` to `TextFormattingEditor` | Modify |
| `packages/frontend/src/components/text-formatting/index.ts` | Re-export `TextSizeStepper` | Modify |
| `packages/frontend/src/app/slides/toolbar/text-edit-section.tsx` | Mount `<TextSizeStepper />` after `<TextStyleGroup />` | Modify |
| `packages/frontend/src/app/slides/toolbar/text-element-controls.tsx` | Mount `<TextSizeStepper />` adapter using `setBoxFontSize` helper | Modify |
| `packages/frontend/src/app/slides/toolbar/zoom-control.tsx` | Fit / 50 / 75 / 100 / 150 / 200 dropdown bound to `ZoomController` | Create |
| `packages/frontend/src/app/slides/toolbar/global-controls.tsx` | `RightGlobals` accepts and mounts `ZoomControl` before Theme | Modify |
| `packages/frontend/src/app/slides/slides-view.tsx` | Introduce `ZoomController`; wire into `refitCanvas`; emit ready callback | Modify |
| `packages/frontend/src/app/slides/slides-detail.tsx` | Create controller, thread to view + toolbar | Modify |
| `packages/frontend/src/app/slides/toolbar/format-painter.tsx` | Toggle button that calls `editor.beginFormatPaint(source)` / `cancelFormatPaint()` | Create |
| `packages/frontend/src/app/slides/toolbar/index.tsx` | Mount `FormatPainterButton` after Undo/Redo and `LayoutButton` after `SlideGroup`; thread `zoomController` | Modify |
| `packages/slides/src/view/editor/editor.ts` | `beginFormatPaint` / `cancelFormatPaint` / `isPaintingFormat` / `onPaintFormatChange`; paint-mode pointer-down handling; Esc cancel; cursor swap | Modify |
| `packages/slides/src/view/editor/text-box-editor.ts` | `clearInlineFormatting` that writes empty style across the active selection | Modify |
| `packages/slides/src/view/editor/interactions/keyboard.ts` | `Cmd+=` / `Cmd+-` route to `controller.set(next/prev preset)` via a new `onZoomStep` editor callback | Modify |
| `packages/slides/src/view/editor/shortcuts-catalog.ts` | Add zoom + format-painter entries | Modify |
| `packages/slides/src/index.ts` | Re-export `beginFormatPaint`-related types if needed | Modify |
| `packages/docs/src/view/editor-api.ts` | Add / alias `clearInlineFormatting` on `EditorAPI` | Modify |
| `packages/frontend/src/app/harness/visual/slides-scenarios.tsx` | Add 3 scenarios: idle-with-layout-button, text-edit-with-stepper-and-clear, idle-with-zoom-dropdown | Modify |
| `packages/frontend/src/components/text-formatting/text-size-stepper.test.tsx` | Stepper unit tests | Create |
| `packages/frontend/src/app/slides/toolbar/layout-button.test.tsx` | Layout button unit tests | Create |
| `packages/frontend/src/app/slides/toolbar/zoom-control.test.tsx` | Zoom control unit tests | Create |
| `packages/frontend/src/app/slides/toolbar/format-painter.test.tsx` | Format painter button tests | Create |
| `packages/slides/test/view/editor/format-paint.test.ts` | Editor-level format-paint behavior tests | Create |
| `packages/slides/test/view/editor/text-box-clear-formatting.test.ts` | Slides text-box clear-formatting unit test | Create |

**Conventions discovered:**

- Slides toolbar files follow `kebab-case.tsx`, components are `PascalCase` named exports.
- Slides editor public API methods are camelCase on the `SlidesEditor` class declared in `packages/slides/src/view/editor/editor.ts` and re-exported via `packages/slides/src/index.ts`.
- Slides editor event-listener pattern: methods returning `() => void` unsubscribe, e.g. `onSelectionChange`, `onCurrentSlideChange` (see `editor.ts:455`).
- Vitest tests for slides live under `packages/slides/test/...`, mirroring source paths.
- Frontend component tests live next to the source as `<name>.test.tsx`.
- IconBrush is `IconBrush` from `@tabler/icons-react`. Clear formatting → `IconClearFormatting`.

---

## Phase A: Layout split-button (smallest, demonstrates pattern)

### Task A1: Create `LayoutButton` component

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/layout-button.tsx`
- Test: `packages/frontend/src/app/slides/toolbar/layout-button.test.tsx`

- [ ] **Step 1: Write failing unit test**

Create `layout-button.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayoutButton } from './layout-button';

vi.mock('@wafflebase/slides', async (orig) => {
  const real = (await orig()) as object;
  return {
    ...real,
    showLayoutPicker: vi.fn((_doc, opts) => {
      // Immediately invoke onPick with a layout id to simulate user pick.
      opts.onPick('title-body');
      opts.onClose?.();
      return () => {};
    }),
  };
});

describe('LayoutButton', () => {
  it('opens the layout picker for the current slide and applies via store.applyLayout', () => {
    const applyLayout = vi.fn();
    const store = {
      read: () => ({ slides: [{ id: 's1', layoutId: 'blank', elements: [] }] }),
      applyLayout,
      batch: (fn: () => void) => fn(),
    } as any;
    const editor = { getCurrentSlideId: () => 's1' } as any;

    render(<LayoutButton store={store} editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: /layout/i }));

    expect(applyLayout).toHaveBeenCalledWith('s1', 'title-body');
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @wafflebase/frontend test layout-button`
Expected: FAIL (file missing).

- [ ] **Step 3: Implement `LayoutButton`**

Create `layout-button.tsx`:

```tsx
import { useCallback, useEffect, useRef } from 'react';
import { IconLayoutGrid, IconChevronDown } from '@tabler/icons-react';
import { showLayoutPicker } from '@wafflebase/slides';
import type { SlidesEditor, SlidesStore } from '@wafflebase/slides';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export interface LayoutButtonProps {
  store: SlidesStore | null;
  editor: SlidesEditor | null;
}

/**
 * "Layout ▾" — opens the layout picker preselected to the current slide's
 * layout and applies the pick via `store.applyLayout`. Separate from the
 * `+ Slide ▾` button which adds a NEW slide with the chosen layout.
 */
export function LayoutButton({ store, editor }: LayoutButtonProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  const onClick = useCallback(() => {
    const slideId = editor?.getCurrentSlideId();
    if (!store || !slideId) return;
    if (closeRef.current) { closeRef.current(); return; }
    const slide = store.read().slides.find((s) => s.id === slideId);
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    closeRef.current = showLayoutPicker(document.body, {
      store,
      trigger: el,
      anchor: { x: rect.left, y: rect.bottom + 4 },
      selectedLayoutId: slide?.layoutId,
      onPick: (layoutId) => {
        store.batch(() => store.applyLayout(slideId, layoutId));
      },
      onClose: () => { closeRef.current = null; },
    });
  }, [store, editor]);

  useEffect(() => () => closeRef.current?.(), []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          onClick={onClick}
          disabled={!store || !editor}
          aria-label="Layout"
          className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <IconLayoutGrid size={16} />
          <IconChevronDown size={12} className="ml-0.5 opacity-50" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Change layout of current slide</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 4: Verify test passes**

Run: `pnpm --filter @wafflebase/frontend test layout-button`
Expected: PASS.

- [ ] **Step 5: Mount in toolbar shell**

In `packages/frontend/src/app/slides/toolbar/index.tsx`, after the existing `<SlideGroup>` line:

```tsx
import { LayoutButton } from './layout-button';
// ...
<SlideGroup store={store} editor={editor} />
<LayoutButton store={store} editor={editor} />
```

- [ ] **Step 6: Verify the toolbar still renders**

Run: `pnpm verify:fast`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/layout-button.tsx \
        packages/frontend/src/app/slides/toolbar/layout-button.test.tsx \
        packages/frontend/src/app/slides/toolbar/index.tsx
git commit -m "Add slides Layout split-button for current slide"
```

---

## Phase B: Font size A↑ / A↓ steppers

### Task B1: Shared `TextSizeStepper` component + unit tests

**Files:**
- Create: `packages/frontend/src/components/text-formatting/text-size-stepper.tsx`
- Create: `packages/frontend/src/components/text-formatting/text-size-stepper.test.tsx`
- Modify: `packages/frontend/src/components/text-formatting/index.ts`

- [ ] **Step 1: Write failing tests**

Create `text-size-stepper.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextSizeStepper, SIZE_STOPS, bumpSize } from './text-size-stepper';

describe('bumpSize', () => {
  it('bumps to the next stop in SIZE_STOPS', () => {
    expect(bumpSize(11, +1)).toBe(SIZE_STOPS[SIZE_STOPS.indexOf(11) + 1]);
  });
  it('does nothing past the max', () => {
    expect(bumpSize(SIZE_STOPS[SIZE_STOPS.length - 1], +1)).toBe(SIZE_STOPS[SIZE_STOPS.length - 1]);
  });
  it('drops to the previous stop', () => {
    expect(bumpSize(12, -1)).toBe(SIZE_STOPS[SIZE_STOPS.indexOf(12) - 1]);
  });
  it('does nothing below the min', () => {
    expect(bumpSize(SIZE_STOPS[0], -1)).toBe(SIZE_STOPS[0]);
  });
  it('handles undefined by treating as the docs default 11', () => {
    expect(bumpSize(undefined, +1)).toBe(SIZE_STOPS[SIZE_STOPS.indexOf(11) + 1]);
  });
  it('jumps to the nearest higher stop for an off-grid value', () => {
    expect(bumpSize(13, +1)).toBe(14);
  });
});

describe('TextSizeStepper', () => {
  it('calls applyStyle({ fontSize }) on A↑ / A↓ clicks', () => {
    const applyStyle = vi.fn();
    const editor = {
      getSelectionStyle: () => ({ fontSize: 12 }),
      applyStyle,
      focus: vi.fn(),
    } as any;
    render(<TextSizeStepper editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: /increase font size/i }));
    expect(applyStyle).toHaveBeenLastCalledWith({ fontSize: 14 });
    fireEvent.click(screen.getByRole('button', { name: /decrease font size/i }));
    expect(applyStyle).toHaveBeenLastCalledWith({ fontSize: 11 });
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @wafflebase/frontend test text-size-stepper`
Expected: FAIL (file missing).

- [ ] **Step 3: Implement the stepper**

Create `text-size-stepper.tsx`:

```tsx
import { useCallback } from 'react';
import { IconLetterAUp, IconLetterADown } from '@tabler/icons-react';
import type { TextFormattingEditor } from './types';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export const SIZE_STOPS = [6, 7, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96] as const;

export function bumpSize(current: number | undefined, dir: 1 | -1): number {
  const cur = current ?? 11;
  if (dir === 1) {
    const next = SIZE_STOPS.find((s) => s > cur);
    return next ?? cur;
  }
  const prev = [...SIZE_STOPS].reverse().find((s) => s < cur);
  return prev ?? cur;
}

interface TextSizeStepperProps {
  editor: TextFormattingEditor | null;
  disabled?: boolean;
}

const buttonClass =
  'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50';

export function TextSizeStepper({ editor, disabled = false }: TextSizeStepperProps) {
  const onDown = useCallback(() => {
    if (!editor) return;
    const cur = editor.getSelectionStyle().fontSize;
    editor.applyStyle({ fontSize: bumpSize(cur, -1) });
    editor.focus();
  }, [editor]);

  const onUp = useCallback(() => {
    if (!editor) return;
    const cur = editor.getSelectionStyle().fontSize;
    editor.applyStyle({ fontSize: bumpSize(cur, +1) });
    editor.focus();
  }, [editor]);

  const isDisabled = disabled || !editor;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onDown}
            disabled={isDisabled}
            aria-label="Decrease font size"
            className={buttonClass}
          >
            <IconLetterADown size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Decrease font size</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onUp}
            disabled={isDisabled}
            aria-label="Increase font size"
            className={buttonClass}
          >
            <IconLetterAUp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Increase font size</TooltipContent>
      </Tooltip>
    </>
  );
}
```

- [ ] **Step 4: Re-export from `components/text-formatting/index.ts`**

Append:

```ts
export { TextSizeStepper, SIZE_STOPS } from './text-size-stepper';
```

- [ ] **Step 5: Verify tests pass**

Run: `pnpm --filter @wafflebase/frontend test text-size-stepper`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/text-formatting/text-size-stepper.tsx \
        packages/frontend/src/components/text-formatting/text-size-stepper.test.tsx \
        packages/frontend/src/components/text-formatting/index.ts
git commit -m "Add shared TextSizeStepper for A↑/A↓ font size buttons"
```

### Task B2: Mount stepper in slides text-edit + text-element sections

**Files:**
- Modify: `packages/frontend/src/app/slides/toolbar/text-edit-section.tsx`
- Modify: `packages/frontend/src/app/slides/toolbar/text-element-controls.tsx`

- [ ] **Step 1: Edit `text-edit-section.tsx`**

After `<TextStyleGroup ... />` and the following `<ToolbarSeparator />`, add:

```tsx
import { TextSizeStepper } from '@/components/text-formatting';
// ...
<TextStyleGroup editor={editor} allowedBlockTypes={['paragraph', 'heading']} />
<TextSizeStepper editor={editor} />
<ToolbarSeparator className="mx-1" />
```

- [ ] **Step 2: Extract `setBoxFontSize` helper inside `text-element-controls.tsx`**

Replace the existing `onFontSize` body with a call to a top-level helper that the stepper can also reuse:

```ts
export function setBoxFontSize(
  store: SlidesStore,
  slideId: string,
  ids: readonly string[],
  size: number,
): void {
  store.batch(() => {
    for (const id of ids) {
      store.withTextElement(slideId, id, (blocks) =>
        blocks.map((b) => ({
          ...b,
          inlines: b.inlines.map((run) => ({
            ...run,
            style: { ...run.style, fontSize: size },
          })),
        })),
      );
    }
  });
}
```

…and mount a `TextSizeStepper` adapter in the same file that calls `setBoxFontSize`:

```tsx
const firstRunSize = firstElement?.data.blocks?.[0]?.inlines?.[0]?.style?.fontSize;
const boxStepperEditor: TextFormattingEditor | null = store && slideId
  ? {
      focus: () => {},
      getSelectionStyle: () => ({ fontSize: firstRunSize }),
      applyStyle: ({ fontSize }) => {
        if (fontSize != null) setBoxFontSize(store, slideId, ids, fontSize);
      },
      applyBlockStyle: () => {},
      getBlockType: () => ({ type: 'paragraph' }),
      setBlockType: () => {},
      toggleList: () => {},
      indent: () => {},
      outdent: () => {},
      requestLink: () => {},
      clearInlineFormatting: () => {},
    }
  : null;
// ...next to Size ▾:
<TextSizeStepper editor={boxStepperEditor} />
```

- [ ] **Step 3: Verify**

Run: `pnpm verify:fast`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/text-edit-section.tsx \
        packages/frontend/src/app/slides/toolbar/text-element-controls.tsx
git commit -m "Mount A↑/A↓ font size stepper in slides text states"
```

---

## Phase C: Clear formatting

### Task C1: Extend `TextFormattingEditor` interface

**Files:**
- Modify: `packages/frontend/src/components/text-formatting/types.ts`

- [ ] **Step 1: Add the method**

Append inside the interface:

```ts
/**
 * Strip all inline styles (bold, italic, underline, strikethrough,
 * color, backgroundColor, fontSize, fontFamily, sub/superscript)
 * from the current selection. Block-level style is preserved.
 */
clearInlineFormatting(): void;
```

- [ ] **Step 2: Verify the build typechecks against existing callers (no implementations yet — they'll fail)**

Run: `pnpm --filter @wafflebase/frontend tsc -p . --noEmit`
Expected: fails in slides text-box-editor.ts and docs editor-api.ts (next tasks fix).

### Task C2: Implement in slides text-box editor

**Files:**
- Modify: `packages/slides/src/view/editor/text-box-editor.ts`
- Create: `packages/slides/test/view/editor/text-box-clear-formatting.test.ts`

- [ ] **Step 1: Write failing test**

Create `text-box-clear-formatting.test.ts` that builds a text element with `{ bold: true, color: '#f00', fontSize: 24 }` styled runs, calls `editor.clearInlineFormatting()`, and asserts the resulting blocks have empty `style` objects (`Object.keys(style).length === 0`) on every run touched by the selection.

```ts
import { describe, it, expect } from 'vitest';
// imports omitted — match existing tests in the same dir
describe('text-box-editor clearInlineFormatting', () => {
  it('strips all inline styles on the selection', () => {
    // arrange: create text element with bold+color+size on a single run
    // select all
    // act: editor.clearInlineFormatting()
    // assert: every run.style in the selection range is {}
  });
  it('preserves runs outside the selection', () => {
    // run A (selected) → cleared; run B (not selected) → unchanged
  });
});
```

- [ ] **Step 2: Implement `clearInlineFormatting`**

In `text-box-editor.ts`, add a method that uses the same path as the existing `applyStyle` but writes an empty style:

```ts
clearInlineFormatting(): void {
  // Walk the active selection; for each run that intersects, write style = {}.
  // Mirrors applyStyle's range-walking helper — reuse the existing helper
  // (likely `splitAndStyle` or `applyInlineStyleAtRange`) with an empty
  // style override.
  this.applyStyle({} as InlineStyle);
}
```

(The exact wiring depends on `applyStyle`'s implementation — verify whether passing `{}` yields a no-op or a clear. If no-op, switch to a low-level `replaceStyleAtRange` call that overwrites instead of merging.)

- [ ] **Step 3: Verify test passes**

Run: `pnpm --filter @wafflebase/slides test text-box-clear-formatting`
Expected: PASS.

### Task C3: Implement in docs `EditorAPI`

**Files:**
- Modify: `packages/docs/src/view/editor-api.ts`

- [ ] **Step 1: Check if docs already has a clear-formatting action**

Grep for `clearFormatting`, `Cmd+\\`, or `IconClearFormatting`. If a method like `clearFormatting` exists, add a thin `clearInlineFormatting` alias. If not, implement parallel to the slides version above.

- [ ] **Step 2: Run docs tests**

Run: `pnpm --filter @wafflebase/docs test`
Expected: PASS.

### Task C4: Add the UI button

**Files:**
- Modify: `packages/frontend/src/components/text-formatting/text-format-group.tsx`

- [ ] **Step 1: Append button after the Link button**

Inside `TextFormatGroup`:

```tsx
import { IconClearFormatting } from '@tabler/icons-react';
// ...
const styleKeys = selectionStyle ? Object.keys(selectionStyle).length : 0;
const hasStyle = styleKeys > 0;
// ...after Link button:
<Tooltip>
  <TooltipTrigger asChild>
    <button
      type="button"
      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Clear formatting"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { editor?.clearInlineFormatting(); editor?.focus(); }}
      disabled={isDisabled || !hasStyle}
    >
      <IconClearFormatting size={16} />
    </button>
  </TooltipTrigger>
  <TooltipContent>Clear formatting</TooltipContent>
</Tooltip>
```

- [ ] **Step 2: Verify**

Run: `pnpm verify:fast`
Expected: PASS.

- [ ] **Step 3: Commit (C1–C4 together)**

```bash
git add packages/frontend/src/components/text-formatting/types.ts \
        packages/frontend/src/components/text-formatting/text-format-group.tsx \
        packages/slides/src/view/editor/text-box-editor.ts \
        packages/slides/test/view/editor/text-box-clear-formatting.test.ts \
        packages/docs/src/view/editor-api.ts
git commit -m "Add Clear formatting button to docs+slides text toolbar"
```

---

## Phase D: Zoom dropdown

### Task D1: Introduce `ZoomController` and wire into `refitCanvas`

**Files:**
- Modify: `packages/frontend/src/app/slides/slides-view.tsx`
- Modify: `packages/frontend/src/app/slides/slides-detail.tsx`

- [ ] **Step 1: Define the controller next to the view**

At the top of `slides-view.tsx` (before the component):

```ts
export interface ZoomController {
  get(): number;
  set(value: number): void;
  subscribe(cb: () => void): () => void;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4.0;

export function createZoomController(initial = 1.0): ZoomController {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));
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
```

- [ ] **Step 2: Accept `zoomController` as a `SlidesView` prop and apply in `refitCanvas`**

In the props interface, add `zoomController?: ZoomController | null`. Inside `refitCanvas` (around `slides-view.tsx:540`), after `const fit = computeFitSize(...)`, multiply by `userZoom`:

```ts
const userZoom = zoomController?.get() ?? 1.0;
const nextW = Math.min(MAX_HOST_W, Math.round(fit.width * userZoom));
const nextH = Math.round(fit.height * userZoom);
```

Subscribe to `zoomController?.subscribe(refitCanvas)` in the same effect that owns the `ResizeObserver`, and unsubscribe in cleanup.

- [ ] **Step 3: Create the controller in `slides-detail.tsx` and thread it**

```tsx
const zoomControllerRef = useRef<ZoomController>(createZoomController(1.0));
// ...
<SlidesView ... zoomController={zoomControllerRef.current} />
<SlidesToolbar ... zoomController={zoomControllerRef.current} />
```

- [ ] **Step 4: Verify the view still renders at Fit (1.0)**

Run: `pnpm verify:fast`
Expected: PASS.

### Task D2: `ZoomControl` dropdown

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/zoom-control.tsx`
- Create: `packages/frontend/src/app/slides/toolbar/zoom-control.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomControl } from './zoom-control';
import { createZoomController } from '../slides-view';

describe('ZoomControl', () => {
  it('shows "Fit" when value is 1.0', () => {
    const ctrl = createZoomController(1.0);
    render(<ZoomControl controller={ctrl} />);
    expect(screen.getByRole('button', { name: /zoom/i })).toHaveTextContent('Fit');
  });

  it('updates the controller when a preset is picked', () => {
    const ctrl = createZoomController(1.0);
    render(<ZoomControl controller={ctrl} />);
    fireEvent.click(screen.getByRole('button', { name: /zoom/i }));
    fireEvent.click(screen.getByText('150%'));
    expect(ctrl.get()).toBe(1.5);
  });

  it('shows percent for non-Fit values', () => {
    const ctrl = createZoomController(2.0);
    render(<ZoomControl controller={ctrl} />);
    expect(screen.getByRole('button', { name: /zoom/i })).toHaveTextContent('200%');
  });
});
```

- [ ] **Step 2: Implement**

Create `zoom-control.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import type { ZoomController } from '../slides-view';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const PRESETS = [0.5, 0.75, 1.0, 1.5, 2.0] as const;

export interface ZoomControlProps {
  controller: ZoomController | null;
}

export function ZoomControl({ controller }: ZoomControlProps) {
  const [value, setValue] = useState(controller?.get() ?? 1.0);
  useEffect(() => {
    if (!controller) return;
    setValue(controller.get());
    return controller.subscribe(() => setValue(controller.get()));
  }, [controller]);

  const label = value === 1.0 ? 'Fit' : `${Math.round(value * 100)}%`;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Zoom"
              disabled={!controller}
              className="inline-flex h-7 min-w-[64px] items-center justify-between rounded-md px-2 text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <span>{label}</span>
              <IconChevronDown size={12} className="ml-1 opacity-50" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Zoom</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {PRESETS.map((p) => (
          <DropdownMenuItem key={p} onClick={() => controller?.set(p)}>
            {p === 1.0 ? 'Fit' : `${p * 100}%`}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Mount in `RightGlobals`**

Modify `global-controls.tsx`: accept `zoomController?: ZoomController | null` on `RightGlobalsProps`; render `<ZoomControl controller={zoomController ?? null} />` just before the `Slide background` dropdown.

- [ ] **Step 4: Pass `zoomController` through `toolbar/index.tsx`**

`SlidesToolbarProps` gains `zoomController?: ZoomController | null`; threaded into `<RightGlobals ... zoomController={zoomController}/>`.

- [ ] **Step 5: Verify**

Run: `pnpm verify:fast`
Expected: PASS.

### Task D3: Cmd+= / Cmd+- keyboard shortcuts

**Files:**
- Modify: `packages/slides/src/view/editor/interactions/keyboard.ts`
- Modify: `packages/slides/src/view/editor/editor.ts` (add `onZoomStep` editor option)
- Modify: `packages/slides/src/view/editor/shortcuts-catalog.ts`

- [ ] **Step 1: Add the option**

Extend `SlidesEditorOptions` with:

```ts
/** Called when the user presses Cmd/Ctrl + = or Cmd/Ctrl + -. dir = +1 zoom in, -1 zoom out. */
onZoomStep?: (dir: 1 | -1) => void;
```

- [ ] **Step 2: Hook into keyboard handler**

In `interactions/keyboard.ts`, add cases for `Cmd+=` and `Cmd+-` that call `ctx.options.onZoomStep?.(+1 / -1)` and `event.preventDefault()`.

- [ ] **Step 3: Wire on the frontend**

In `slides-view.tsx`, pass `onZoomStep` when constructing the editor:

```ts
onZoomStep: (dir) => {
  const cur = zoomController.get();
  const next = pickPreset(cur, dir); // returns next/prev value in PRESETS
  zoomController.set(next);
},
```

`pickPreset` is a small helper colocated in `zoom-control.tsx` and exported.

- [ ] **Step 4: Catalog entry**

Add to `shortcuts-catalog.ts`:

```ts
{ id: 'zoom-in', label: 'Zoom in', shortcut: 'Cmd/Ctrl + =' },
{ id: 'zoom-out', label: 'Zoom out', shortcut: 'Cmd/Ctrl + -' },
```

- [ ] **Step 5: Verify**

Run: `pnpm verify:fast`
Expected: PASS.

- [ ] **Step 6: Commit Phase D**

```bash
git add packages/frontend/src/app/slides/slides-view.tsx \
        packages/frontend/src/app/slides/slides-detail.tsx \
        packages/frontend/src/app/slides/toolbar/zoom-control.tsx \
        packages/frontend/src/app/slides/toolbar/zoom-control.test.tsx \
        packages/frontend/src/app/slides/toolbar/global-controls.tsx \
        packages/frontend/src/app/slides/toolbar/index.tsx \
        packages/slides/src/view/editor/editor.ts \
        packages/slides/src/view/editor/interactions/keyboard.ts \
        packages/slides/src/view/editor/shortcuts-catalog.ts
git commit -m "Add zoom dropdown with Fit/50–200% and Cmd+/- shortcuts"
```

---

## Phase E: Format painter

### Task E1: Editor-level paint state and pointer handling

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`
- Create: `packages/slides/test/view/editor/format-paint.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/slides/test/view/editor/format-paint.test.ts
describe('format-paint editor API', () => {
  it('captures snapshot on beginFormatPaint and applies on next pointer-down', () => {
    // arrange: editor on doc with two shapes A (red fill) and B (blue fill); select A
    // act: editor.beginFormatPaint('shape-all'); simulate pointer-down on B's frame
    // assert: B's data.fill matches A's; paint mode auto-cleared
  });
  it('Esc cancels paint mode without applying', () => {
    // arrange + act: begin paint, press Esc, click B
    // assert: B unchanged; isPaintingFormat() === false after Esc
  });
  it('cross-type paint emits no-op + onIncompatiblePaint callback', () => {
    // arrange: capture shape style; click on an image element
    // assert: image unchanged; onIncompatiblePaint called once with target type 'image'
  });
});
```

- [ ] **Step 2: Implement public methods**

Add a private `paintMode: PaintSnapshot | null` field and:

```ts
beginFormatPaint(source: PaintSource): void {
  this.paintMode = this.capturePaintSnapshot(source);
  this.notifyPaintFormatChange();
  this.setCursor('crosshair');
}
cancelFormatPaint(): void {
  this.paintMode = null;
  this.notifyPaintFormatChange();
  this.restoreCursor();
}
isPaintingFormat(): boolean { return this.paintMode !== null; }
onPaintFormatChange(cb: () => void): () => void { /* observer pattern */ }
```

In `onPointerDown` for the slide canvas, branch first on `this.paintMode`:

```ts
if (this.paintMode) {
  this.applyPaintToHitElement(hit);
  this.cancelFormatPaint();
  return;
}
```

Hook Esc into `cancelFormatPaint` in the existing keyboard handler.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @wafflebase/slides test format-paint`
Expected: PASS.

### Task E2: Toolbar button + capture-then-paint UX

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/format-painter.tsx`
- Create: `packages/frontend/src/app/slides/toolbar/format-painter.test.tsx`
- Modify: `packages/frontend/src/app/slides/toolbar/index.tsx`

- [ ] **Step 1: Write failing component test**

```tsx
describe('FormatPainterButton', () => {
  it('calls beginFormatPaint on press', () => { /* mock editor; click; assert begin called once with derived source */ });
  it('calls cancelFormatPaint when toggled off', () => { /* press, press again, assert cancel */ });
  it('reflects isPaintingFormat via onPaintFormatChange', () => { /* listener wiring */ });
});
```

- [ ] **Step 2: Implement the button**

```tsx
function deriveSource(editor: SlidesEditor): PaintSource {
  if (editor.isTextEditing()) return 'text-run';
  const ids = editor.getSelection();
  if (ids.length !== 1) return 'shape-all'; // editor will no-op if capture is impossible
  const el = editor.getElement(ids[0]);
  if (el?.type === 'text') return 'shape-all'; // text-box frame styles, not run
  if (el?.type === 'connector') return 'shape-stroke';
  return 'shape-all';
}

export function FormatPainterButton({ editor }: { editor: SlidesEditor | null }) {
  const [active, setActive] = useState(false);
  useEffect(() => editor?.onPaintFormatChange(() => setActive(editor.isPaintingFormat())), [editor]);
  return (
    <Toggle pressed={active} aria-label="Format painter"
      onPressedChange={(p) => {
        if (!editor) return;
        p ? editor.beginFormatPaint(deriveSource(editor)) : editor.cancelFormatPaint();
      }}>
      <IconBrush size={16} />
    </Toggle>
  );
}
```

- [ ] **Step 3: Mount after `<UndoRedoGroup />` in `toolbar/index.tsx`**

```tsx
<UndoRedoGroup store={store} />
<FormatPainterButton editor={editor} />
```

- [ ] **Step 4: Verify**

Run: `pnpm verify:fast`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/test/view/editor/format-paint.test.ts \
        packages/frontend/src/app/slides/toolbar/format-painter.tsx \
        packages/frontend/src/app/slides/toolbar/format-painter.test.tsx \
        packages/frontend/src/app/slides/toolbar/index.tsx \
        packages/slides/src/view/editor/shortcuts-catalog.ts
git commit -m "Add slides format painter single-shot copy/paste of element style"
```

---

## Phase F: Visual harness scenarios + final verify

### Task F1: Add harness scenarios

**Files:**
- Modify: `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`

- [ ] **Step 1: Add three new scenarios**

- `slides-toolbar-tier1-idle-with-layout-and-zoom` — idle state, layout button + zoom dropdown both visible.
- `slides-toolbar-tier1-text-edit-with-stepper-and-clear` — text-edit state showing A↑/A↓ and Clear formatting.
- `slides-toolbar-tier1-format-painter-active` — paint mode active (toggle pressed, crosshair cursor on canvas).

- [ ] **Step 2: Refresh visual baselines locally and inspect**

Run: `pnpm verify:browser:docker`
Expected: PASS after the new baselines are accepted.

### Task F2: Final verify + branch self-review

- [ ] **Step 1: Full verify**

Run: `pnpm verify:fast` then `pnpm verify:self`.
Expected: both PASS.

- [ ] **Step 2: Self code review**

Dispatch `/code-review` over the full branch diff. Apply blocking findings; note non-blocking ones in the lessons file.

- [ ] **Step 3: Lessons + archive**

Write `docs/tasks/active/20260529-slides-toolbar-tier1-lessons.md` capturing any surprises (e.g. test-id collisions, applyStyle({}) semantics, zoom interaction with rulers).

Run: `pnpm tasks:archive && pnpm tasks:index`.

- [ ] **Step 4: Open PR**

Title: `Add slides toolbar tier-1 universal controls`
Body: Summary + Test plan; reference design doc.

---

## Out-of-scope (reminder)

- Paint cursor preview while hovering — v1 uses default crosshair.
- Sticky paintbrush via double-click — v1.1.
- Per-slide zoom persistence — session-only by design.
- Pinch/trackpad zoom — out of scope.
- Cross-type format paint (shape → text-box border) — v1.1.
