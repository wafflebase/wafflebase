# Slides Background (Color / Image / Gradient) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the slides right-side "Background Color" control to "Background" and give it Google-Slides-style Color (solid **and** gradient), Image, Reset-to-theme, and Apply-to-all-slides options.

**Architecture:** The slide-background model, Canvas renderer, and Yorkie persistence already support an image fill, and every non-UI layer already has a `Fill`-aware (`ThemeColor | GradientFill`) helper that the background path bypasses for a solid-only sibling (`resolveColor` vs `resolveFillStyle`, `wrapColor` vs `migrateGradientFill`, `solidFillXml` vs `fillXml`). This is a reuse-and-wire job: widen `Background.fill: ThemeColor → Fill`, swap each solid-only call for its `Fill`-aware sibling, drop in the existing generic `FillPicker`/`GradientEditor`, and reuse the existing image-upload URL pipeline.

**Tech Stack:** TypeScript, React, `@wafflebase/slides` (model/renderer/store), Yorkie CRDT, Vitest (slides unit), the frontend test runner for hooks/components.

## Global Constraints

- Design doc: `docs/design/slides/slides-background.md` (target-version 0.6.0) — authoritative scope.
- Every commit keeps `pnpm verify:fast` green (lint + unit).
- Do NOT hand-edit ANTLR generated files (not touched here).
- All slide mutations go through the `SlidesStore` interface — never touch Yorkie state directly.
- `Background.fill` widens from `ThemeColor` to `Fill` everywhere; a `ThemeColor` is a subtype of `Fill`, so solid literals stay valid.
- Never synthesize a white default background — an absent/inheritable fill must keep resolving through slide → layout → master → `background` role.
- Background write semantics (Google-Slides parity — one background per slide):
  - Pick a **Color** (solid or gradient) → `updateSlideBackground(slideId, { fill })` (drops any image).
  - Pick an **Image** → `updateSlideBackground(slideId, { image: { src } })` (drops any fill).
  - **Reset to theme** → `updateSlideBackground(slideId, {})` (clears both; inherits).
  - **Apply to all slides** (Phase 2) → `updateMaster(doc.meta.masterId, { background })`.
- Image `src` is a persisted remote URL from the existing upload pipeline — never a blob/data-URI in the CRDT.
- Commit subject ≤70 chars; body explains why; end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## Phase 1 — Core

### Task 1: Widen the background model to `Fill` + gradient migration

**Files:**
- Modify: `packages/slides/src/model/presentation.ts` (`Background.fill` L28, `isInheritableFill` L187-197, `resolveBackgroundFill` L207-219)
- Modify: `packages/slides/src/model/master.ts` (`MasterBackground.fill` L21)
- Modify: `packages/slides/src/model/migrate.ts` (`migrateBackground` L136-146)
- Modify: `packages/frontend/src/types/slides-document.ts` (`YorkieSlide.background.fill` L91-92 type only)
- Test: `packages/slides/src/model/migrate.test.ts` (add cases; create if absent — check `ls packages/slides/src/model/*.test.ts` first and follow the existing pattern)

**Interfaces:**
- Consumes: `Fill = ThemeColor | GradientFill`, `migrateGradientFill(raw): GradientFill` (both already exported — `theme.ts:85`, `migrate.ts:173`).
- Produces: `resolveBackgroundFill(slide, doc): Fill` (widened return); `Background.fill?: Fill`; `MasterBackground.fill: Fill`. Later tasks rely on these widened types.

- [ ] **Step 1: Write the failing test** — `migrateBackground` preserves a gradient fill

```typescript
// in packages/slides/src/model/migrate.test.ts
import { describe, expect, it } from 'vitest';
import { migrateDocument } from './migrate'; // confirm the exported entry that runs migrateBackground

it('migrates a gradient background fill', () => {
  const raw = {
    // minimal doc shape with one slide carrying a gradient background;
    // mirror an existing fixture in this file. Key assertion:
    slides: [{ id: 's1', layoutId: 'l1', elements: [], notes: [],
      background: { fill: { kind: 'gradient', type: 'linear', angle: 0,
        stops: [{ pos: 0, color: { kind: 'srgb', value: '#fff' } },
                { pos: 1, color: { kind: 'srgb', value: '#000' } }] } } }],
    // ...rest of the minimal doc the existing fixtures use
  };
  const out = migrateDocument(raw as any);
  expect(out.slides[0].background.fill).toEqual({
    kind: 'gradient', type: 'linear', angle: 0,
    stops: [{ pos: 0, color: { kind: 'srgb', value: '#fff' } },
            { pos: 1, color: { kind: 'srgb', value: '#000' } }],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- migrate`
Expected: FAIL — `migrateBackground` currently routes `fill` through `wrapColor`, which collapses the gradient to `{ kind: 'role', role: 'background' }`.

- [ ] **Step 3: Widen types + add the gradient branch**

```typescript
// presentation.ts — import Fill alongside ThemeColor from ./theme
import type { Fill, Theme, ThemeColor } from './theme';

// Background.fill (L28)
  fill?: Fill;

// isInheritableFill (L187) — a gradient is never an inherit sentinel
export function isInheritableFill(fill: Fill): boolean {
  if (fill.kind === 'gradient') return false;
  return (
    fill.kind === 'role' &&
    fill.role === 'background' &&
    fill.lumMod === undefined &&
    fill.lumOff === undefined &&
    fill.tint === undefined &&
    fill.shade === undefined &&
    fill.alpha === undefined
  );
}

// resolveBackgroundFill (L207) — return Fill; body unchanged, the
// { kind:'role', role:'background' } fallback is still a valid Fill
export function resolveBackgroundFill(slide: Slide, doc: SlidesDocument): Fill {
```

```typescript
// master.ts (L21) — import Fill; widen MasterBackground.fill
  fill: Fill;
```

```typescript
// migrate.ts — migrateBackground (L136), copy the ternary migrateElement (L148-161) already uses
function migrateBackground(bg: any): { fill?: Fill; image?: any } {
  const out: { fill?: Fill; image?: any } = {};
  if (bg?.fill != null) {
    out.fill =
      bg.fill?.kind === 'gradient'
        ? migrateGradientFill(bg.fill)
        : wrapColor(bg.fill);
  }
  if (bg?.image != null) out.image = bg.image;
  return out;
}
// add `Fill` to migrate.ts's type imports from ./theme
```

```typescript
// slides-document.ts (L91-92) — widen the persisted type; keep the
// legacy-string comment above it. Use the model's Fill type.
    fill?: import('@wafflebase/slides').Fill;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- migrate`
Expected: PASS. Also add/keep a case asserting a plain solid fill and a legacy string fill still migrate through `wrapColor` unchanged.

- [ ] **Step 5: Typecheck the widening didn't break a consumer**

Run: `pnpm --filter @wafflebase/slides build && pnpm --filter @wafflebase/frontend exec tsc --noEmit`
Expected: no type errors. If `resolveBackgroundFill` callers now see `Fill` where they passed to `resolveColor(...: ThemeColor)`, that's Task 2's renderer swap and the Task 5 picker — leave those; if a NON-target caller breaks, collapse it with `representativeColor(fill)` (already exported).

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/model/presentation.ts packages/slides/src/model/master.ts packages/slides/src/model/migrate.ts packages/frontend/src/types/slides-document.ts packages/slides/src/model/migrate.test.ts
git commit -m "Widen slide Background.fill to Fill (solid|gradient)" -m "..." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Render gradient (and solid) backgrounds via `resolveFillStyle`

**Files:**
- Modify: `packages/slides/src/view/canvas/slide-renderer.ts` (background paint sites L184, L204)
- Test: `packages/slides/src/view/canvas/slide-renderer.test.ts` (follow the existing 2D-context-stub pattern; check `ls` for the exact test file)

**Interfaces:**
- Consumes: `resolveFillStyle(ctx, fill, theme, w, h): string | CanvasGradient` (`render-context.ts:20`), `resolveBackgroundFill(): Fill` (Task 1), `SLIDE_WIDTH`, `slideH` (already in scope in `drawSlide`).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test** — a gradient background calls `createLinearGradient`, not a solid fill

```typescript
// Use a fake ctx that records createLinearGradient calls and fillStyle.
it('paints a gradient slide background across the slide box', () => {
  const calls: any = { grad: 0, fillStyle: [] as unknown[] };
  const ctx = makeFakeCtx(calls); // mirror the existing stub in this test file
  const doc = docWithSlideBackground({
    fill: { kind: 'gradient', type: 'linear', angle: 0,
      stops: [{ pos: 0, color: { kind: 'srgb', value: '#fff' } },
              { pos: 1, color: { kind: 'srgb', value: '#000' } }] },
  });
  drawSlide(ctx as any, /* args per existing tests */);
  expect(calls.grad).toBeGreaterThan(0); // gradient path taken
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- slide-renderer`
Expected: FAIL — `resolveColor` returns a string and never calls `createLinearGradient`.

- [ ] **Step 3: Swap both paint sites to `resolveFillStyle`**

```typescript
// import at top of slide-renderer.ts (from ./render-context)
import { resolveFillStyle } from './render-context';

// no-pasteboard path (was L184). Pass the LOGICAL slide size, not the
// DPR-scaled bitmap, so the gradient axis maps to the slide.
if (!hasPasteboard) {
  ctx.fillStyle = resolveFillStyle(
    ctx, resolveBackgroundFill(slide, doc), theme, SLIDE_WIDTH, slideH,
  );
  ctx.fillRect(0, 0, bitmapW, bitmapH);
} else {
  ctx.clearRect(0, 0, bitmapW, bitmapH);
}

// pasteboard path (was L204)
  ctx.fillStyle = resolveFillStyle(
    ctx, resolveBackgroundFill(slide, doc), theme, SLIDE_WIDTH, slideH,
  );
  ctx.fillRect(-1, -1, SLIDE_WIDTH + 2, slideH + 2);
```

Note: the no-pasteboard `fillRect(0,0,bitmapW,bitmapH)` still fills the whole bitmap, but the gradient's coordinate space is the `SLIDE_WIDTH × slideH` box passed to `resolveFillStyle` — the axis spans the slide and extends flat past its edges, which is the desired look (no visible seam because the pasteboard path is the one that matters for large canvases).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- slide-renderer`
Expected: PASS. Keep a solid-fill case green (asserts `fillStyle` is a string).

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/view/canvas/slide-renderer.ts packages/slides/src/view/canvas/slide-renderer.test.ts
git commit -m "Render gradient slide backgrounds via resolveFillStyle" -m "..." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Widen `useSlideBackground` — Fill + gradient draft + image + reset

**Files:**
- Modify: `packages/frontend/src/app/slides/use-slide-background.ts` (whole file)
- Test: `packages/frontend/src/app/slides/use-slide-background.test.ts` (create; use `@testing-library/react`'s `renderHook` — check a sibling `*.test.tsx` for the runner import style)

**Interfaces:**
- Consumes: `SlidesStore.updateSlideBackground(slideId, bg)`, `store.batch`, `store.pushRecentColor`, `resolveBackgroundFill`, `resolveBackgroundImage`, `Fill`, `GradientFill`, `ThemeColor`, `BackgroundImage` (all from `@wafflebase/slides`).
- Produces: the hook's new return shape, consumed by Task 4 (desktop) and Task 5 (mobile):

```typescript
{
  backgroundFill: Fill | undefined;          // resolved, for the picker's active marker
  backgroundImage: BackgroundImage | undefined; // resolved, for the Image section
  gradientDraft: GradientFill | null;        // live drag preview
  onChangeSolid: (color: ThemeColor, opts?: { commit?: boolean; record?: boolean }) => void;
  onChangeGradient: (fill: GradientFill, opts?: { commit?: boolean }) => void;
  onFlushGradientDraft: () => void;          // call on popover/sheet close
  onChooseImage: (src: string) => void;      // sets { image: { src } }
  onRemoveImage: () => void;                 // clears image → {} (reset to theme)
  onResetToTheme: () => void;                // updateSlideBackground(slideId, {})
}
```

- [ ] **Step 1: Write the failing test** — solid, gradient-draft, image, reset

```typescript
import { renderHook, act } from '@testing-library/react';
import { useSlideBackground } from './use-slide-background';
// build a fake SlidesStore recording updateSlideBackground calls + batch()

it('onChangeSolid writes { fill } dropping image', () => {
  const store = makeFakeStore(); // slide currently has an image bg
  const { result } = renderHook(() => useSlideBackground(store, 's1', theme));
  act(() => result.current.onChangeSolid({ kind: 'srgb', value: '#ff0000' }, { commit: true }));
  expect(store.calls).toContainEqual(['updateSlideBackground', 's1', { fill: { kind: 'srgb', value: '#ff0000' } }]);
});

it('onChangeGradient with commit:false only updates draft (no store write)', () => {
  const store = makeFakeStore();
  const { result } = renderHook(() => useSlideBackground(store, 's1', theme));
  act(() => result.current.onChangeGradient(grad, { commit: false }));
  expect(store.calls).toHaveLength(0);
  expect(result.current.gradientDraft).toEqual(grad);
});

it('onChooseImage writes { image:{src} } and onResetToTheme writes {}', () => {
  const store = makeFakeStore();
  const { result } = renderHook(() => useSlideBackground(store, 's1', theme));
  act(() => result.current.onChooseImage('https://x/y.png'));
  expect(store.calls.at(-1)).toEqual(['updateSlideBackground', 's1', { image: { src: 'https://x/y.png' } }]);
  act(() => result.current.onResetToTheme());
  expect(store.calls.at(-1)).toEqual(['updateSlideBackground', 's1', {}]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- use-slide-background`
Expected: FAIL — the current hook only returns `{ backgroundFill, onChange }`.

- [ ] **Step 3: Rewrite the hook**

```typescript
import { useCallback, useEffect, useState } from 'react';
import type {
  BackgroundImage, Fill, GradientFill, SlidesStore, Theme, ThemeColor,
} from '@wafflebase/slides';
import { resolveBackgroundFill, resolveBackgroundImage } from '@wafflebase/slides';

export function useSlideBackground(
  store: SlidesStore | null,
  slideId: string | undefined,
  theme: Theme | null,
  onCommit?: () => void,
) {
  const [gradientDraft, setGradientDraft] = useState<GradientFill | null>(null);
  // stale draft must not leak onto a different slide
  useEffect(() => setGradientDraft(null), [slideId]);

  let backgroundFill: Fill | undefined;
  let backgroundImage: BackgroundImage | undefined;
  if (store && slideId && theme) {
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId);
    if (slide) {
      backgroundFill = resolveBackgroundFill(slide, doc);
      backgroundImage = resolveBackgroundImage(slide, doc);
    }
  }

  const onChangeSolid = useCallback(
    (color: ThemeColor, opts?: { commit?: boolean; record?: boolean }) => {
      if (!store || !slideId) return;
      store.batch(() => {
        store.updateSlideBackground(slideId, { fill: color }); // drops image
        if (opts?.record && color.kind === 'srgb') store.pushRecentColor(color.value);
      });
      setGradientDraft(null);
      if (opts?.commit) onCommit?.();
    },
    [store, slideId, onCommit],
  );

  const persistGradient = useCallback((fill: GradientFill) => {
    if (!store || !slideId) return;
    store.batch(() => store.updateSlideBackground(slideId, { fill }));
  }, [store, slideId]);

  const onChangeGradient = useCallback(
    (fill: GradientFill, opts?: { commit?: boolean }) => {
      if (opts?.commit) { persistGradient(fill); setGradientDraft(null); }
      else setGradientDraft(fill);
    },
    [persistGradient],
  );

  const onFlushGradientDraft = useCallback(() => {
    if (gradientDraft) { persistGradient(gradientDraft); setGradientDraft(null); }
  }, [gradientDraft, persistGradient]);

  const onChooseImage = useCallback((src: string) => {
    if (!store || !slideId) return;
    store.batch(() => store.updateSlideBackground(slideId, { image: { src } })); // drops fill
    setGradientDraft(null);
    onCommit?.();
  }, [store, slideId, onCommit]);

  const onRemoveImage = useCallback(() => {
    if (!store || !slideId) return;
    store.batch(() => store.updateSlideBackground(slideId, {}));
  }, [store, slideId]);

  const onResetToTheme = useCallback(() => {
    if (!store || !slideId) return;
    store.batch(() => store.updateSlideBackground(slideId, {}));
    setGradientDraft(null);
    onCommit?.();
  }, [store, slideId, onCommit]);

  return {
    backgroundFill, backgroundImage, gradientDraft,
    onChangeSolid, onChangeGradient, onFlushGradientDraft,
    onChooseImage, onRemoveImage, onResetToTheme,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- use-slide-background`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/use-slide-background.ts packages/frontend/src/app/slides/use-slide-background.test.ts
git commit -m "Widen useSlideBackground for gradient/image/reset" -m "..." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Desktop panel — Background popover (Color / Image / Reset)

**Files:**
- Create: `packages/frontend/src/app/slides/background-panel.tsx` (the popover body, reused by desktop + mobile)
- Modify: `packages/frontend/src/app/slides/toolbar/global-controls.tsx` (`RightGlobals` L145-230, `RightGlobalsProps` L100-110)
- Modify: `packages/frontend/src/app/slides/toolbar/index.tsx` (pass `upload` to `RightGlobals`, ~L130)
- Test: `packages/frontend/src/app/slides/background-panel.test.tsx` (create)

**Interfaces:**
- Consumes: `useSlideBackground` return (Task 3), `FillPicker` (`fill-picker/index.tsx:32`, props `{ fill, theme, recentColors, onChangeSolid, onChangeGradient, onClear }`), the upload fn `(file: File) => Promise<{ url: string; w: number; h: number }>` threaded from `slides-detail.tsx`.
- Produces: `BackgroundPanel` component (default export or named), consumed by Task 5.

- [ ] **Step 1: Write `BackgroundPanel`**

```tsx
// background-panel.tsx
import { useRef } from 'react';
import type { SlidesStore, Theme } from '@wafflebase/slides';
import { FillPicker } from './fill-picker';
import { useSlideBackground } from './use-slide-background';

export interface BackgroundPanelProps {
  store: SlidesStore;
  theme: Theme;
  slideId: string;
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
  onCommit?: () => void; // close popover/sheet after a discrete pick
}

export function BackgroundPanel({ store, theme, slideId, upload, onCommit }: BackgroundPanelProps) {
  const bg = useSlideBackground(store, slideId, theme, onCommit);
  const fileRef = useRef<HTMLInputElement>(null);
  const fillForPicker = bg.gradientDraft ?? bg.backgroundFill;

  const onPickFile = async (file: File) => {
    if (!upload) return;
    const { url } = await upload(file);
    bg.onChooseImage(url);
  };

  return (
    <div className="w-[224px] space-y-2">
      <FillPicker
        fill={fillForPicker}
        theme={theme}
        recentColors={store.read().meta.recentColors}
        onChangeSolid={bg.onChangeSolid}
        onChangeGradient={bg.onChangeGradient}
        onClear={bg.onResetToTheme}
      />
      {upload && (
        <>
          <input
            ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.currentTarget.value = ''; }}
          />
          <button
            className="w-full rounded border px-2 py-1 text-xs hover:bg-muted"
            onClick={() => fileRef.current?.click()}
          >
            {bg.backgroundImage ? 'Replace image…' : 'Choose image…'}
          </button>
          {bg.backgroundImage && (
            <button className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              onClick={bg.onRemoveImage}>Remove image</button>
          )}
        </>
      )}
      <button
        className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        onClick={bg.onResetToTheme}
      >
        Reset to theme
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Test it renders + wires the reset**

```tsx
// background-panel.test.tsx — render with a fake store, click "Reset to theme",
// assert store.updateSlideBackground called with {}.
```

Run: `pnpm --filter @wafflebase/frontend test -- background-panel`
Expected: FAIL first (no component), then PASS after Step 1.

- [ ] **Step 3: Swap the desktop control to `BackgroundPanel`**

In `global-controls.tsx`: add `upload?` to `RightGlobalsProps`; replace the `useSlideBackground(...) + <ThemedColorPicker>` block (L145-227) — keep the `DropdownMenu` + `ColorSwatchButton` trigger, but render `<BackgroundPanel store={store} theme={theme} slideId={slideId} upload={upload} onCommit={() => { backgroundMenu.markSwatchClicked(); setBackgroundOpen(false); }} />` inside `DropdownMenuContent`, and flush the gradient draft on close. Because the swatch button needs a resolved color, keep a small `useSlideBackground` read JUST for `backgroundFill` → `currentBackground` (or move that read into a tiny selector); render the stripe via `resolveColor(representativeColor(fill), theme)` so a gradient still shows a swatch.

```tsx
// close handler flushes any uncommitted gradient draft
<DropdownMenu open={backgroundOpen} onOpenChange={(o) => { if (!o) flushRef.current?.(); setBackgroundOpen(o); }}>
```

(Expose the flush by lifting `useSlideBackground` into `RightGlobals` and passing `onChange*` down, OR give `BackgroundPanel` an imperative `onFlush` via a ref. Prefer lifting the hook into `RightGlobals` and passing the whole `bg` object into `BackgroundPanel` as a prop, so the close handler can call `bg.onFlushGradientDraft()` — this keeps one hook instance.)

- [ ] **Step 4: Thread `upload` into `RightGlobals`**

In `toolbar/index.tsx` at the `<RightGlobals .../>` render (L130), add `upload={upload}` (the Toolbar already receives `upload` — it passes it to `ObjectSection` at L122). Confirm `upload` is a Toolbar prop; if not, add it to the Toolbar props and pass from `slides-detail.tsx` where `<Toolbar>` is rendered (uploadFn is defined at `slides-detail.tsx:309`).

- [ ] **Step 5: Verify build + tests**

Run: `pnpm --filter @wafflebase/frontend exec tsc --noEmit && pnpm --filter @wafflebase/frontend test -- background-panel global-controls`
Expected: PASS / no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/slides/background-panel.tsx packages/frontend/src/app/slides/background-panel.test.tsx packages/frontend/src/app/slides/toolbar/global-controls.tsx packages/frontend/src/app/slides/toolbar/index.tsx
git commit -m "Desktop slide Background panel: color/gradient/image/reset" -m "..." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Mobile — reuse `BackgroundPanel` in the bottom sheet

**Files:**
- Modify: `packages/frontend/src/app/slides/toolbar/mobile-toolbar.tsx` (`SlideBackgroundSheet` L654-695; add `upload` prop threading from the mobile toolbar's props)

**Interfaces:**
- Consumes: `BackgroundPanel` (Task 4), the mobile toolbar's `upload` prop (add it if absent, threaded from `slides-detail.tsx`).

- [ ] **Step 1: Replace the sheet body**

```tsx
function SlideBackgroundSheet({ open, onOpenChange, store, theme, slideId, upload }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  store: SlidesStore; theme: Theme; slideId: string;
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom,8px)]">
        <SheetHeader>
          <SheetTitle>Background</SheetTitle>
          <SheetDescription className="sr-only">Set the slide background color or image.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <BackgroundPanel store={store} theme={theme} slideId={slideId} upload={upload}
            onCommit={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

Rename the menu label at L615 `Slide background…` → keep (it opens the sheet); the sheet title reads `Background`. Pass `upload={upload}` where `<SlideBackgroundSheet .../>` is rendered (L631-639).

- [ ] **Step 2: Verify**

Run: `pnpm --filter @wafflebase/frontend exec tsc --noEmit && pnpm --filter @wafflebase/frontend test -- mobile-toolbar`
Expected: no type errors, existing mobile tests green.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/mobile-toolbar.tsx
git commit -m "Mobile slide Background sheet reuses BackgroundPanel" -m "..." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rename label + Phase 1 smoke

**Files:**
- Modify: `packages/frontend/src/app/slides/toolbar/global-controls.tsx` (tooltip/label `Slide background` → `Background`, `IconBackground` kept)

- [ ] **Step 1: Rename the control label**

Change the `ColorSwatchButton label="Slide background"` and `<TooltipContent>Slide background</TooltipContent>` (L207/L212) to `Background`.

- [ ] **Step 2: Manual smoke in `pnpm dev`**

Run: `docker compose up -d && pnpm dev`
Verify on a slide: (a) Color solid pick paints; (b) Gradient tab → drag a stop → release persists, one undo reverts it; (c) Choose image → background shows the image; (d) Reset to theme clears back to inherited; (e) desktop + mobile viewport both work.

- [ ] **Step 3: Run the Phase 1 gate + commit**

```bash
pnpm verify:fast
git add packages/frontend/src/app/slides/toolbar/global-controls.tsx
git commit -m "Rename slides Background Color control to Background" -m "..." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Extension

### Task 7: Apply to all slides (write master background)

**Files:**
- Modify: `packages/frontend/src/app/slides/use-slide-background.ts` (add `onApplyToAll`)
- Modify: `packages/frontend/src/app/slides/background-panel.tsx` (add the button)
- Test: `use-slide-background.test.ts` (add a case)

**Interfaces:**
- Consumes: `SlidesStore.updateMaster(masterId, patch: MasterPatch)` where `MasterPatch.background = { fill?: ThemeColor; image?: MasterBackgroundImage | null }` (`store.ts:25-27`, L115). NOTE the master patch fill type is `ThemeColor`, not `Fill` — see Step 3.

- [ ] **Step 1: Failing test** — `onApplyToAll` calls `updateMaster` with the current resolved background

```typescript
it('onApplyToAll writes the current background to the master', () => {
  const store = makeFakeStore(); // doc.meta.masterId = 'm1', slide fill = red
  const { result } = renderHook(() => useSlideBackground(store, 's1', theme));
  act(() => result.current.onApplyToAll());
  expect(store.calls.at(-1)).toEqual(['updateMaster', 'm1', { background: { fill: { kind: 'srgb', value: '#ff0000' } } }]);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @wafflebase/frontend test -- use-slide-background`
Expected: FAIL — `onApplyToAll` undefined.

- [ ] **Step 3: Implement `onApplyToAll`**

Decide the master-patch fill type. `MasterPatch.background.fill` is `ThemeColor` today. To let a gradient background apply to all, **widen `MasterPatch.background.fill: ThemeColor → Fill` in `store.ts:27`** and confirm the `MemSlidesStore` + `YorkieSlidesStore` `updateMaster` impls clone the patch (they already `clone`, so no logic change). Then:

```typescript
const onApplyToAll = useCallback(() => {
  if (!store || !slideId) return;
  const doc = store.read();
  const slide = doc.slides.find((s) => s.id === slideId);
  if (!slide) return;
  const fill = resolveBackgroundFill(slide, doc);
  const image = resolveBackgroundImage(slide, doc);
  store.batch(() =>
    store.updateMaster(doc.meta.masterId, {
      background: image ? { image } : { fill },
    }),
  );
  onCommit?.();
}, [store, slideId, onCommit]);
```

Add `onApplyToAll` to the hook's return object.

- [ ] **Step 4: Add the panel button**

In `background-panel.tsx`, add below Reset: `<button ... onClick={bg.onApplyToAll}>Apply to all slides</button>`.

- [ ] **Step 5: Run tests + commit**

Run: `pnpm --filter @wafflebase/frontend test -- use-slide-background background-panel && pnpm --filter @wafflebase/slides build`
```bash
git add packages/frontend/src/app/slides/use-slide-background.ts packages/frontend/src/app/slides/background-panel.tsx packages/frontend/src/app/slides/use-slide-background.test.ts packages/slides/src/store/store.ts
git commit -m "Slides Background: apply to all slides (master)" -m "..." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Background image opacity slider

**Files:**
- Modify: `packages/frontend/src/app/slides/use-slide-background.ts` (add `onChangeImageOpacity`)
- Modify: `packages/frontend/src/app/slides/background-panel.tsx` (slider, shown only when an image is set)
- Test: `use-slide-background.test.ts`

**Interfaces:**
- Consumes: `BackgroundImage.opacity` (`presentation.ts:15`), already painted by `drawImage`.

- [ ] **Step 1: Failing test**

```typescript
it('onChangeImageOpacity preserves src and sets opacity', () => {
  const store = makeFakeStore(); // slide image src = 'u'
  const { result } = renderHook(() => useSlideBackground(store, 's1', theme));
  act(() => result.current.onChangeImageOpacity(0.5));
  expect(store.calls.at(-1)).toEqual(['updateSlideBackground', 's1', { image: { src: 'u', opacity: 0.5 } }]);
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @wafflebase/frontend test -- use-slide-background`

- [ ] **Step 3: Implement**

```typescript
const onChangeImageOpacity = useCallback((opacity: number) => {
  if (!store || !slideId || !backgroundImage) return;
  store.batch(() => store.updateSlideBackground(slideId, { image: { ...backgroundImage, opacity } }));
}, [store, slideId, backgroundImage]);
```

Add to the return. In `background-panel.tsx`, render a range input (0..1) beneath the image buttons when `bg.backgroundImage`, wired to `bg.onChangeImageOpacity`. Debounce is unnecessary if the slider commits on change; if it feels chatty, gate the store write to `onPointerUp` and keep a local value during drag.

- [ ] **Step 4: Tests + commit**

Run: `pnpm --filter @wafflebase/frontend test -- use-slide-background background-panel`
```bash
git add packages/frontend/src/app/slides/use-slide-background.ts packages/frontend/src/app/slides/background-panel.tsx packages/frontend/src/app/slides/use-slide-background.test.ts
git commit -m "Slides Background: image opacity slider" -m "..." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: PPTX `<p:bg>` gradient import + export round-trip

**Files:**
- Modify: `packages/slides/src/import/pptx/shape.ts` (export `parseGradientFill`, L940 — change `function parseGradientFill` to `export function parseGradientFill`)
- Modify: `packages/slides/src/import/pptx/slide.ts` (`parseSlideBackground` L172-199 — add a `gradFill` branch)
- Modify: `packages/slides/src/export/pptx/slide.ts` (`backgroundToXml` L79-86 — use `fillXml`; rename the shadowing local; import `fillXml`)
- Test: `packages/slides/src/import/pptx/*.test.ts` and/or the round-trip harness over importer fixtures (check `ls packages/slides/src/import/pptx/*.test.ts` and `packages/slides/src/export/pptx/*.test.ts`)

**Interfaces:**
- Consumes: `parseGradientFill(grad, clrMap): GradientFill | undefined` (`shape.ts:940`), `fillXml(fill: Fill): string` (`color.ts:67`, already emits `gradFillXml` for ≥2-stop gradients else representative solid).

- [ ] **Step 1: Failing round-trip test** — a gradient `<p:bg>` imports to a gradient fill and re-exports as `<a:gradFill>`

```typescript
it('round-trips a gradient slide background', async () => {
  const xml = `<p:bg><p:bgPr><a:gradFill><a:gsLst>` +
    `<a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>` +
    `<a:gs pos="100000"><a:srgbClr val="000000"/></a:gs>` +
    `</a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill></p:bgPr></p:bg>`;
  const bg = await parseSlideBackground(parseXml(xml), clrMap, imageCtx);
  expect(bg.fill?.kind).toBe('gradient');
  const out = backgroundToXml(bg); // export
  expect(out).toContain('<a:gradFill>');
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @wafflebase/slides test -- pptx`
Expected: FAIL — importer ignores `gradFill`; exporter emits `<a:solidFill>` (representative color) via the local `solidFillXml`.

- [ ] **Step 3: Import branch**

```typescript
// shape.ts L940 — export it
export function parseGradientFill(grad: Element, clrMap: ClrMap): GradientFill | undefined { /* unchanged */ }

// slide.ts parseSlideBackground — inside `if (bgPr) {`, BEFORE the solidFill block
const grad = child(bgPr, 'gradFill');
if (grad) {
  const g = parseGradientFill(grad, clrMap);
  if (g) return { fill: g };
}
// import parseGradientFill from './shape.js'
```

- [ ] **Step 4: Export swap (mind the shadow)**

```typescript
// export/pptx/slide.ts
import { fillXml, solidFillXml } from './color.js'; // solidFillXml still used elsewhere? keep only what's needed

function backgroundToXml(bg: Background): string {
  const fill = bg.fill ?? { kind: 'role' as const, role: 'background' as const };
  const body = fillXml(fill); // was: const fillXml = solidFillXml(fill) — rename local to avoid shadowing the import
  return `<p:bg><p:bgPr>${body}</p:bgPr></p:bg>`;
}
```

Update the stale comment block (L61-77) noting gradients now round-trip.

- [ ] **Step 5: Run tests + commit**

Run: `pnpm --filter @wafflebase/slides test -- pptx`
Expected: PASS. Solid + image background tests stay green (image export is still fill-fallback — unchanged, out of scope).
```bash
git add packages/slides/src/import/pptx/shape.ts packages/slides/src/import/pptx/slide.ts packages/slides/src/export/pptx/slide.ts packages/slides/src/import/pptx/*.test.ts
git commit -m "PPTX: round-trip gradient slide backgrounds" -m "..." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Finalization

- [ ] Run the full gate: `pnpm verify:self` (lint + unit + builds).
- [ ] Self-review the branch diff via `/code-review` (or `superpowers:requesting-code-review`); apply blocking findings.
- [ ] Capture lessons in `docs/tasks/active/20260712-slides-background-lessons.md`.
- [ ] `git fetch && git rebase origin/main`; open PR (title ≤70 chars; body = Summary + Test plan).

## Self-Review (plan vs spec)

- **Spec coverage:** label rename → Task 6; Color solid+gradient → Tasks 1-4; Image + upload → Tasks 3-4; Reset to theme → Tasks 3-4; model widening → Task 1; renderer swap → Task 2; Yorkie migrate → Task 1; desktop+mobile → Tasks 4-5; Apply to all → Task 7; image opacity → Task 8; PPTX gradient → Task 9. Non-goals (tile/repeat, bg-image crop) intentionally absent.
- **Type consistency:** `resolveBackgroundFill: Fill` used by renderer (Task 2) and hook (Task 3); `FillPicker` prop names (`onChangeSolid`/`onChangeGradient`/`onClear`) match its definition; `MasterPatch.background.fill` widened in Task 7 where the gradient master-write needs it.
- **Open confirmations for the implementer (read before coding, not blockers):** exact test-file names/paths per package; whether `upload` is already a Toolbar prop (Task 4 Step 4); the migrate entry export name (`migrateDocument` vs other) in Task 1.
