# Slides Mobile View — read-only viewport-768 branch

**Goal:** Add a mobile (`< 768px` viewport) view of the slides editor
that mounts a dedicated read-only component — header, single canvas,
swipe + footer-arrow navigation, Present button — instead of the
desktop editor. Read-only by construction (the editor module is not
mounted on mobile).

**Design doc:** [slides-mobile-view.md](../../design/slides/slides-mobile-view.md)

**Architecture:** `SlidesView` branches at the top of render based on
the existing `useIsMobile()` hook. The new `MobileSlidesView`
component reuses `SlideRenderer` (already exported from
`@wafflebase/slides`) directly — same pattern as
`view/present/presenter.ts`. A small `usePointerSwipe` hook
encapsulates the horizontal-swipe gesture.

**Tech stack:** React 18, TypeScript, Vitest + jsdom for unit tests,
existing Yorkie `useDocument`, existing `SlideRenderer`.

---

## Task 1 — `usePointerSwipe` hook

**Files:**

- Create: `packages/frontend/src/hooks/use-pointer-swipe.ts`
- Create: `packages/frontend/src/hooks/use-pointer-swipe.test.tsx`

Isolated pointer-gesture classifier. Pure-ish (state lives in refs);
TDD-able with synthetic `PointerEvent`s in jsdom.

**Public shape:**

```ts
export interface PointerSwipeOptions {
  onSwipeLeft: () => void;   // dx < 0
  onSwipeRight: () => void;  // dx > 0
  /** Minimum |dx| before a swipe fires. Default 50. */
  thresholdPx?: number;
  /** Max elapsed ms for a swipe. Default 600. */
  maxDurationMs?: number;
  /** |dx| where horizontal intent is locked. Default 10. */
  classifyAtPx?: number;
}

export function usePointerSwipe(
  ref: React.RefObject<HTMLElement | null>,
  options: PointerSwipeOptions,
): void;
```

Classification rules:

1. On `pointerdown`, record `(x, y, time)`.
2. On `pointermove`, if not yet classified:
   - If `|dx| > classifyAtPx` and `|dx| > |dy|` → lock horizontal,
     call `event.preventDefault()`.
   - Else if `|dy| > classifyAtPx` and `|dy| >= |dx|` → cancel
     (vertical scroll intent).
3. On `pointerup` (only if classified horizontal):
   - If `elapsed < maxDurationMs` and `|dx| >= thresholdPx`:
     `dx < 0 ? onSwipeLeft() : onSwipeRight()`.
4. `pointercancel` cancels.

`pointerdown` calls `event.currentTarget.setPointerCapture(pointerId)`
so move/up events don't get lost if the pointer leaves the element.

- [ ] **1.1** Write failing tests covering:

  ```tsx
  import { renderHook } from '@testing-library/react';
  import { usePointerSwipe } from './use-pointer-swipe';

  function makeRef(el: HTMLElement) {
    return { current: el } as React.RefObject<HTMLElement>;
  }

  function fire(
    el: HTMLElement,
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    x: number,
    y: number,
  ) {
    const ev = new PointerEvent(type, {
      clientX: x,
      clientY: y,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  }

  test('left swipe past threshold fires onSwipeLeft', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const left = vi.fn();
    const right = vi.fn();
    renderHook(() =>
      usePointerSwipe(makeRef(el), { onSwipeLeft: left, onSwipeRight: right }),
    );
    fire(el, 'pointerdown', 200, 100);
    fire(el, 'pointermove', 120, 100); // dx = -80, locks horizontal
    fire(el, 'pointerup', 120, 100);
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).not.toHaveBeenCalled();
  });

  test('right swipe past threshold fires onSwipeRight', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const left = vi.fn();
    const right = vi.fn();
    renderHook(() =>
      usePointerSwipe(makeRef(el), { onSwipeLeft: left, onSwipeRight: right }),
    );
    fire(el, 'pointerdown', 100, 100);
    fire(el, 'pointermove', 200, 100);
    fire(el, 'pointerup', 200, 100);
    expect(right).toHaveBeenCalledTimes(1);
    expect(left).not.toHaveBeenCalled();
  });

  test('vertical movement cancels classification', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const left = vi.fn();
    const right = vi.fn();
    renderHook(() =>
      usePointerSwipe(makeRef(el), { onSwipeLeft: left, onSwipeRight: right }),
    );
    fire(el, 'pointerdown', 100, 100);
    fire(el, 'pointermove', 105, 200); // dy >> dx
    fire(el, 'pointerup', 200, 100);   // dx large here but classification was vertical
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  test('below threshold does nothing', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const left = vi.fn();
    const right = vi.fn();
    renderHook(() =>
      usePointerSwipe(makeRef(el), { onSwipeLeft: left, onSwipeRight: right }),
    );
    fire(el, 'pointerdown', 100, 100);
    fire(el, 'pointermove', 130, 100); // dx 30, classifies horizontal
    fire(el, 'pointerup', 130, 100);   // but below 50px threshold
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  test('too slow (> maxDurationMs) does not fire', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const left = vi.fn();
    renderHook(() =>
      usePointerSwipe(makeRef(el), {
        onSwipeLeft: left,
        onSwipeRight: vi.fn(),
        maxDurationMs: 600,
      }),
    );
    fire(el, 'pointerdown', 200, 100);
    fire(el, 'pointermove', 120, 100);
    vi.advanceTimersByTime(700);
    fire(el, 'pointerup', 120, 100);
    expect(left).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test('pointercancel mid-gesture aborts', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const left = vi.fn();
    renderHook(() =>
      usePointerSwipe(makeRef(el), { onSwipeLeft: left, onSwipeRight: vi.fn() }),
    );
    fire(el, 'pointerdown', 200, 100);
    fire(el, 'pointermove', 120, 100);
    fire(el, 'pointercancel', 120, 100);
    fire(el, 'pointerup', 120, 100);
    expect(left).not.toHaveBeenCalled();
  });
  ```

  Note: `setPointerCapture` may not exist on jsdom elements — stub
  it via `Object.defineProperty(el, 'setPointerCapture', { value: vi.fn() })`
  in the test setup, or in the hook itself check `'setPointerCapture' in el`
  before calling. Production browsers always have it.

- [ ] **1.2** Run tests, confirm they fail with "usePointerSwipe is not defined":

  ```bash
  pnpm --filter @wafflebase/frontend test packages/frontend/src/hooks/use-pointer-swipe.test.tsx
  ```

- [ ] **1.3** Implement the hook:

  ```ts
  import { useEffect } from 'react';

  export interface PointerSwipeOptions {
    onSwipeLeft: () => void;
    onSwipeRight: () => void;
    thresholdPx?: number;
    maxDurationMs?: number;
    classifyAtPx?: number;
  }

  type Phase = 'idle' | 'pending' | 'horizontal' | 'cancelled';

  interface GestureState {
    phase: Phase;
    startX: number;
    startY: number;
    startTime: number;
    pointerId: number | null;
  }

  export function usePointerSwipe(
    ref: React.RefObject<HTMLElement | null>,
    options: PointerSwipeOptions,
  ): void {
    useEffect(() => {
      const el = ref.current;
      if (!el) return;

      const threshold = options.thresholdPx ?? 50;
      const maxDuration = options.maxDurationMs ?? 600;
      const classifyAt = options.classifyAtPx ?? 10;

      const state: GestureState = {
        phase: 'idle',
        startX: 0,
        startY: 0,
        startTime: 0,
        pointerId: null,
      };

      const onDown = (e: PointerEvent) => {
        state.phase = 'pending';
        state.startX = e.clientX;
        state.startY = e.clientY;
        state.startTime = performance.now();
        state.pointerId = e.pointerId;
        if ('setPointerCapture' in el) {
          try {
            (el as Element).setPointerCapture(e.pointerId);
          } catch {
            // jsdom or browsers refusing capture — ignore.
          }
        }
      };

      const onMove = (e: PointerEvent) => {
        if (state.phase === 'idle' || state.phase === 'cancelled') return;
        if (state.pointerId !== e.pointerId) return;
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (state.phase === 'pending') {
          if (Math.abs(dx) > classifyAt && Math.abs(dx) > Math.abs(dy)) {
            state.phase = 'horizontal';
            e.preventDefault();
          } else if (Math.abs(dy) > classifyAt && Math.abs(dy) >= Math.abs(dx)) {
            state.phase = 'cancelled';
          }
        } else if (state.phase === 'horizontal') {
          e.preventDefault();
        }
      };

      const onUp = (e: PointerEvent) => {
        if (state.pointerId !== e.pointerId) return;
        const wasHorizontal = state.phase === 'horizontal';
        state.phase = 'idle';
        if (!wasHorizontal) return;
        const dx = e.clientX - state.startX;
        const elapsed = performance.now() - state.startTime;
        if (elapsed > maxDuration) return;
        if (Math.abs(dx) < threshold) return;
        if (dx < 0) options.onSwipeLeft();
        else options.onSwipeRight();
      };

      const onCancel = (e: PointerEvent) => {
        if (state.pointerId !== e.pointerId) return;
        state.phase = 'cancelled';
      };

      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onCancel);

      return () => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onCancel);
      };
    }, [ref, options]);
  }
  ```

- [ ] **1.4** Run tests, confirm pass.

- [ ] **1.5** Run `pnpm verify:fast` to confirm lint + unit tests are green.

- [ ] **1.6** Commit:

  ```bash
  git add packages/frontend/src/hooks/use-pointer-swipe.ts \
    packages/frontend/src/hooks/use-pointer-swipe.test.tsx
  git commit -m "$(cat <<'EOF'
  frontend: add usePointerSwipe hook for mobile slide nav

  Encapsulates horizontal swipe classification so the upcoming
  mobile slides view can hand off all gesture logic to a single
  unit-tested hook. Locks intent once |dx| > 10px to suppress iOS
  swipe-back, falls back to no-op below a 50px / 600ms threshold,
  and uses pointer capture so move/up don't get lost if the pointer
  leaves the element mid-gesture.
  EOF
  )"
  ```

---

## Task 2 — `MobileSlidesView` scaffold (no canvas yet)

**Files:**

- Create: `packages/frontend/src/app/slides/mobile-slides-view.tsx`
- Create: `packages/frontend/src/app/slides/mobile-slides-view.test.tsx`

Render the header, footer, and an empty `canvas-host` div. Read the
Yorkie root, track `currentSlideId`, wire prev/next buttons and the
swipe hook. No canvas painting yet — verifying the React shell in
isolation first.

- [ ] **2.1** Write failing test:

  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, fireEvent, screen } from '@testing-library/react';
  import { MobileSlidesView } from './mobile-slides-view';

  // Mock @yorkie-js/react useDocument with a fake doc that has 3 slides.
  vi.mock('@yorkie-js/react', () => ({
    useDocument: () => ({
      doc: makeFakeDoc(['s1', 's2', 's3']),
      loading: false,
      error: null,
    }),
  }));

  // Mock SlideRenderer so jsdom doesn't try to use canvas APIs.
  vi.mock('@wafflebase/slides', async (importOriginal) => {
    const mod = await importOriginal<typeof import('@wafflebase/slides')>();
    return {
      ...mod,
      SlideRenderer: vi.fn().mockImplementation(() => ({
        render: vi.fn(),
        markDirty: vi.fn(),
      })),
    };
  });

  function makeFakeDoc(ids: string[]) {
    const slides = ids.map((id) => ({
      id,
      background: { type: 'solid', color: '#fff' },
      elements: [],
      notes: [],
    }));
    return {
      getRoot: () => ({
        meta: { title: 'Test Deck', themeId: 'default-light', masterId: 'default' },
        slides,
        themes: [],
        masters: [],
        layouts: [],
      }),
      subscribe: () => () => {},
      update: vi.fn(),
    };
  }

  describe('MobileSlidesView', () => {
    it('renders title from yorkie meta', () => {
      render(<MobileSlidesView documentId="d" />);
      expect(screen.getByText('Test Deck')).toBeInTheDocument();
    });

    it('shows 1 / N indicator on mount', () => {
      render(<MobileSlidesView documentId="d" />);
      expect(screen.getByText('1 / 3')).toBeInTheDocument();
    });

    it('next button advances the indicator', () => {
      render(<MobileSlidesView documentId="d" />);
      fireEvent.click(screen.getByLabelText('Next slide'));
      expect(screen.getByText('2 / 3')).toBeInTheDocument();
    });

    it('next at last slide is a no-op', () => {
      render(<MobileSlidesView documentId="d" />);
      fireEvent.click(screen.getByLabelText('Next slide'));
      fireEvent.click(screen.getByLabelText('Next slide'));
      fireEvent.click(screen.getByLabelText('Next slide')); // already at 3
      expect(screen.getByText('3 / 3')).toBeInTheDocument();
    });

    it('prev at first slide is a no-op', () => {
      render(<MobileSlidesView documentId="d" />);
      fireEvent.click(screen.getByLabelText('Previous slide'));
      expect(screen.getByText('1 / 3')).toBeInTheDocument();
    });

    it('present button invokes onStartPresentation', () => {
      const onStart = vi.fn();
      render(<MobileSlidesView documentId="d" onStartPresentation={onStart} />);
      fireEvent.click(screen.getByLabelText('Start presentation'));
      expect(onStart).toHaveBeenCalledWith('current');
    });

    it('back button invokes navigateBack callback', () => {
      const onBack = vi.fn();
      render(<MobileSlidesView documentId="d" onBack={onBack} />);
      fireEvent.click(screen.getByLabelText('Back to deck list'));
      expect(onBack).toHaveBeenCalled();
    });
  });
  ```

- [ ] **2.2** Run, confirm fail with "MobileSlidesView is not defined":

  ```bash
  pnpm --filter @wafflebase/frontend test packages/frontend/src/app/slides/mobile-slides-view.test.tsx
  ```

- [ ] **2.3** Implement the scaffold:

  ```tsx
  import { useDocument } from '@yorkie-js/react';
  import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
  import { useNavigate } from 'react-router-dom';
  import { Loader } from '@/components/loader';
  import { usePointerSwipe } from '@/hooks/use-pointer-swipe';
  import type { YorkieSlidesRoot } from '@/types/slides-document';
  import type { SlidesPresence } from '@/types/users';
  import { ensureSlidesRoot } from './yorkie-slides-store';

  interface MobileSlidesViewProps {
    documentId?: string;
    onStartPresentation?: (from: 'current' | 'first') => void;
    /** Optional override for the back action; defaults to navigate('/slides'). */
    onBack?: () => void;
  }

  /**
   * Read-only mobile slide viewer mounted by `SlidesView` when the
   * viewport is below 768px. Does not mount the slides editor —
   * read-only is enforced by construction. Reuses `SlideRenderer`
   * directly via the slides package's public API (Task 3).
   */
  export function MobileSlidesView({
    documentId: _documentId,
    onStartPresentation,
    onBack,
  }: MobileSlidesViewProps) {
    const navigate = useNavigate();
    const { doc, loading, error } = useDocument<YorkieSlidesRoot, SlidesPresence>();

    // Snapshot the root into React state. The Yorkie subscription
    // (Task 3) will refresh this on remote-change.
    const [snapshot, setSnapshot] = useState<{
      title: string;
      slideIds: string[];
    }>({ title: '', slideIds: [] });

    useEffect(() => {
      if (!doc) return;
      ensureSlidesRoot(doc);
      const root = doc.getRoot();
      setSnapshot({
        title: root.meta?.title ?? 'Untitled',
        slideIds: (root.slides ?? []).map((s) => s.id),
      });
    }, [doc]);

    const [currentSlideId, setCurrentSlideId] = useState<string>('');
    useEffect(() => {
      if (snapshot.slideIds.length === 0) {
        setCurrentSlideId('');
        return;
      }
      // If the current slide was removed by a peer, fall back to first.
      setCurrentSlideId((id) =>
        snapshot.slideIds.includes(id) ? id : snapshot.slideIds[0],
      );
    }, [snapshot.slideIds]);

    const currentIndex = useMemo(
      () => snapshot.slideIds.indexOf(currentSlideId),
      [snapshot.slideIds, currentSlideId],
    );

    const nextSlide = useCallback(() => {
      if (currentIndex < 0 || currentIndex >= snapshot.slideIds.length - 1) return;
      setCurrentSlideId(snapshot.slideIds[currentIndex + 1]);
    }, [currentIndex, snapshot.slideIds]);

    const prevSlide = useCallback(() => {
      if (currentIndex <= 0) return;
      setCurrentSlideId(snapshot.slideIds[currentIndex - 1]);
    }, [currentIndex, snapshot.slideIds]);

    const canvasHostRef = useRef<HTMLDivElement>(null);
    usePointerSwipe(canvasHostRef, {
      onSwipeLeft: nextSlide,
      onSwipeRight: prevSlide,
    });

    const handleBack = useCallback(() => {
      if (onBack) onBack();
      else navigate('/slides');
    }, [onBack, navigate]);

    const handlePresent = useCallback(() => {
      onStartPresentation?.('current');
    }, [onStartPresentation]);

    if (loading) return <Loader />;
    if (error) return <div role="alert">Failed to load deck.</div>;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          maxHeight: '100vh',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 44,
            padding: '0 8px',
            gap: 8,
            borderBottom: '1px solid var(--border, #e5e7eb)',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            aria-label="Back to deck list"
            onClick={handleBack}
            style={{ width: 36, height: 36 }}
          >
            ‹
          </button>
          <h1
            style={{
              flex: 1,
              fontSize: 16,
              fontWeight: 500,
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {snapshot.title}
          </h1>
          <button
            type="button"
            aria-label="Start presentation"
            onClick={handlePresent}
            disabled={snapshot.slideIds.length === 0}
            style={{ width: 36, height: 36 }}
          >
            ▶
          </button>
        </header>

        <div
          ref={canvasHostRef}
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000',
            touchAction: 'pan-y',
          }}
        >
          {/* Canvas mounts here in Task 3 */}
        </div>

        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            height: 28,
            fontSize: 13,
            flexShrink: 0,
            borderTop: '1px solid var(--border, #e5e7eb)',
          }}
        >
          <button
            type="button"
            aria-label="Previous slide"
            onClick={prevSlide}
            disabled={currentIndex <= 0}
            style={{ minWidth: 32 }}
          >
            ‹
          </button>
          <span>
            {Math.max(currentIndex + 1, 0)} / {snapshot.slideIds.length}
          </span>
          <button
            type="button"
            aria-label="Next slide"
            onClick={nextSlide}
            disabled={currentIndex >= snapshot.slideIds.length - 1}
            style={{ minWidth: 32 }}
          >
            ›
          </button>
        </footer>
      </div>
    );
  }
  ```

- [ ] **2.4** Run tests, confirm pass.

- [ ] **2.5** Run `pnpm verify:fast`.

- [ ] **2.6** Commit:

  ```bash
  git add packages/frontend/src/app/slides/mobile-slides-view.tsx \
    packages/frontend/src/app/slides/mobile-slides-view.test.tsx
  git commit -m "$(cat <<'EOF'
  frontend: scaffold MobileSlidesView (header, nav, no canvas yet)

  Renders the header (back / title / Present), footer indicator,
  and prev/next handlers driven by both arrow buttons and the swipe
  hook from the previous commit. Yorkie subscription and the actual
  SlideRenderer canvas land in the next commit so this one keeps the
  React shell reviewable in isolation.
  EOF
  )"
  ```

---

## Task 3 — Canvas integration (SlideRenderer + ResizeObserver + remote-change)

**Files:**

- Modify: `packages/frontend/src/app/slides/mobile-slides-view.tsx`

Wire the canvas. On mount, create a `<canvas>` inside `canvasHostRef`,
attach a `SlideRenderer`, observe size changes with `ResizeObserver`,
and re-render whenever (a) the slide list changes, (b)
`currentSlideId` changes, or (c) the host resizes. Subscribe to
`doc` for `remote-change` events to refresh the snapshot.

- [ ] **3.1** Add a snapshot-refresh helper and a `doc.subscribe`
  effect that calls it on `remote-change`:

  ```tsx
  useEffect(() => {
    if (!doc) return;
    const refresh = () => {
      const root = doc.getRoot();
      setSnapshot({
        title: root.meta?.title ?? 'Untitled',
        slideIds: (root.slides ?? []).map((s) => s.id),
      });
    };
    const unsub = doc.subscribe((e) => {
      if (e.type === 'remote-change') refresh();
    });
    return () => unsub();
  }, [doc]);
  ```

  Note: the existing mount effect already calls `ensureSlidesRoot`
  and seeds the initial snapshot. Keep it; this new effect is the
  per-remote-change refresher only.

- [ ] **3.2** Replace the `{/* Canvas mounts here */}` comment with a
  `<canvas ref={canvasRef} />` and add the renderer effect:

  ```tsx
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<{
    renderer: SlideRenderer;
    cssWidth: number;
    cssHeight: number;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvasHostRef.current;
    if (!canvas || !host || !doc) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    const SLIDE_ASPECT = 16 / 9;
    function computeFit(availW: number, availH: number) {
      const wFit = { w: availW, h: availW / SLIDE_ASPECT };
      if (wFit.h <= availH) return wFit;
      return { w: availH * SLIDE_ASPECT, h: availH };
    }

    function paint() {
      const root = doc.getRoot();
      const slides = root.slides ?? [];
      const slide = slides.find((s) => s.id === currentSlideId);
      if (!slide || !rendererRef.current) return;
      // Cast: Yorkie root is structurally compatible with the
      // SlidesDocument the renderer wants. See yorkie-slides-store.ts
      // for the same cast.
      rendererRef.current.renderer.markDirty();
      rendererRef.current.renderer.render(slide, root as unknown as SlidesDocument);
    }

    function applyFit() {
      const rect = host.getBoundingClientRect();
      const fit = computeFit(rect.width, rect.height);
      const cssW = Math.round(fit.w);
      const cssH = Math.round(fit.h);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      rendererRef.current = {
        renderer: new SlideRenderer(ctx, {
          hostWidth: cssW,
          hostHeight: cssH,
          dpr,
        }),
        cssWidth: cssW,
        cssHeight: cssH,
      };
      paint();
    }

    let rafScheduled = false;
    const ro = new ResizeObserver(() => {
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        applyFit();
      });
    });
    ro.observe(host);
    applyFit(); // initial paint

    return () => {
      ro.disconnect();
      rendererRef.current = null;
    };
  }, [doc, currentSlideId]);
  ```

  Imports to add at the top of the file:

  ```ts
  import { SlideRenderer } from '@wafflebase/slides';
  import type { SlidesDocument } from '@wafflebase/slides';
  ```

- [ ] **3.3** Verify `SlidesDocument` is exported from
  `@wafflebase/slides`. If not, export it from
  `packages/slides/src/index.ts` in the same commit:

  ```bash
  grep -n "SlidesDocument\|export.*type" packages/slides/src/index.ts | head -5
  ```

  If missing, add: `export type { Slide, SlidesDocument } from './model/presentation';`
  (it's likely already exported — confirm before committing).

- [ ] **3.4** Run the existing `MobileSlidesView` tests. Because they
  mock `SlideRenderer`, they should still pass without modification.
  If a test now needs a `canvas` element in the DOM, add a
  `HTMLCanvasElement.prototype.getContext = vi.fn(() => ({} as any))`
  stub at the top of the test file.

- [ ] **3.5** Run `pnpm verify:fast`.

- [ ] **3.6** Manual smoke (don't skip this — visual regressions on
  Canvas don't show up in unit tests):

  ```bash
  pnpm dev
  ```

  Open Chrome DevTools → toggle device toolbar → iPhone 14 Pro
  (393×852). Navigate to a slide deck. Verify:

  - Header shows back, title, Present button.
  - Canvas paints the first slide and fits the visible area
    without scrollbars.
  - Footer shows `1 / N`.
  - Tap Next button: slide changes, footer updates.
  - Swipe left on the canvas: slide advances.
  - Swipe right: slide goes back.
  - Rotate device emulation (landscape): canvas resizes, no layout
    break.
  - Toggle out of mobile emulation (desktop 1280px): desktop editor
    mounts (this will only work after Task 4).

- [ ] **3.7** Commit:

  ```bash
  git add packages/frontend/src/app/slides/mobile-slides-view.tsx
  # plus packages/slides/src/index.ts if SlidesDocument needed exporting
  git commit -m "$(cat <<'EOF'
  frontend: paint slides on mobile via SlideRenderer

  Wires a single SlideRenderer to MobileSlidesView's canvas, with a
  ResizeObserver-driven fit (RAF-coalesced so window-drag doesn't
  spam re-instantiation) and a Yorkie remote-change subscription
  that re-snapshots title and slide-id list. Re-uses the same
  computeFitSize math as slides-view.tsx / presenter.ts —
  intentional ~10-line duplicate per the design doc.
  EOF
  )"
  ```

---

## Task 4 — `SlidesView` branch on `useIsMobile`

**Files:**

- Modify: `packages/frontend/src/app/slides/slides-view.tsx`

Top-of-render branch. The desktop path is left intact; only the
entry point changes.

- [ ] **4.1** At the top of `slides-view.tsx`, add the import:

  ```tsx
  import { useIsMobile } from '@/hooks/use-mobile';
  import { MobileSlidesView } from './mobile-slides-view';
  ```

- [ ] **4.2** In the `SlidesView` function, after `useDocument` and
  before the existing mount `useEffect`, branch:

  ```tsx
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <MobileSlidesView
        documentId={documentId}
        onStartPresentation={onStartPresentation}
      />
    );
  }
  ```

  Place the branch AFTER `useDocument` and `useIsMobile` calls but
  BEFORE any other hooks — React requires consistent hook order
  across renders. Since `useDocument` and `useIsMobile` are always
  called, and the branch returns before any other hook, this is
  safe. (The existing desktop hooks below the branch only run when
  `!isMobile`, but they'll still get called consistently on every
  desktop render. Confirm by running the dev server and resizing
  across the breakpoint — no "rendered fewer hooks than expected"
  warning should appear.)

- [ ] **4.3** Add a test verifying the branch (in a new file or
  appended to an existing slides-view test if one exists):

  ```tsx
  import { vi, describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { SlidesView } from './slides-view';

  vi.mock('@/hooks/use-mobile', () => ({
    useIsMobile: vi.fn(),
  }));
  vi.mock('@yorkie-js/react', () => ({
    useDocument: () => ({
      doc: { getRoot: () => ({ meta: { title: 'T' }, slides: [] }), subscribe: () => () => {} },
      loading: false,
      error: null,
    }),
  }));
  vi.mock('./mobile-slides-view', () => ({
    MobileSlidesView: () => <div data-testid="mobile-view" />,
  }));

  import { useIsMobile } from '@/hooks/use-mobile';

  describe('SlidesView mobile branch', () => {
    it('mounts MobileSlidesView when isMobile is true', () => {
      (useIsMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
      render(<SlidesView />);
      expect(screen.getByTestId('mobile-view')).toBeInTheDocument();
    });
  });
  ```

  Path: `packages/frontend/src/app/slides/slides-view.test.tsx` (new
  if absent; just append the `describe` block if present).

- [ ] **4.4** Run tests + verify:fast.

- [ ] **4.5** Manual smoke: `pnpm dev`, resize browser window across
  the 768px boundary. Confirm:

  - At < 768px: mobile view renders (header / canvas / footer).
  - At ≥ 768px: existing desktop editor renders.
  - Resizing across the boundary unmounts one, mounts the other
    cleanly; no console errors; Yorkie remains attached (look at
    Network tab — no extra Yorkie attach/detach).

- [ ] **4.6** Commit:

  ```bash
  git add packages/frontend/src/app/slides/slides-view.tsx \
    packages/frontend/src/app/slides/slides-view.test.tsx
  git commit -m "$(cat <<'EOF'
  frontend: branch SlidesView to MobileSlidesView under 768px

  Adds a one-line useIsMobile branch at the top of SlidesView's
  render. The desktop mount path is unchanged. Crossing the
  breakpoint at runtime swaps mounts without re-attaching the
  Yorkie document (DocumentProvider lives above SlidesView).
  EOF
  )"
  ```

---

## Task 5 — Visual / mobile-viewport browser tests

**Files:**

- Create: a new fixture under `packages/frontend/tests/visual/` or
  equivalent, depending on where existing slides visual tests live.
  Confirm by running:

  ```bash
  find packages/frontend/tests -name "*slides*" -type f 2>/dev/null | head -5
  find . -name "playwright*" -type f -not -path "*/node_modules/*" 2>/dev/null | head -5
  ```

- [ ] **5.1** Locate the existing slides visual test (likely a
  Playwright spec since the project uses `pnpm verify:browser:docker`).
  Read it to learn the fixture pattern.

- [ ] **5.2** Add a new spec — `slides-mobile-view.spec.ts` (next to
  the existing slides spec) — that:

  - Sets viewport to 390×844 (iPhone 14).
  - Navigates to a known seeded slide deck (use the same seed the
    existing visual test uses).
  - Asserts the header `Back to deck list`, `Start presentation`,
    and the indicator `1 /` text are present.
  - Takes a snapshot of the page (full-page).
  - Sets viewport to 360×640 and re-snapshots.
  - Clicks the `Next slide` aria-label and asserts the indicator
    increments.

  Use the same `await page.locator` and snapshot APIs as the existing
  spec — don't introduce a new framework.

- [ ] **5.3** Run `pnpm verify:browser:docker` locally. First-run
  snapshots will be written — review the generated images to confirm
  the layout looks right, then commit them.

- [ ] **5.4** Commit:

  ```bash
  git add packages/frontend/tests/  # adjust to actual path
  git commit -m "$(cat <<'EOF'
  frontend: add mobile-viewport visual test for slides

  Snapshots the MobileSlidesView layout at 390x844 and 360x640
  and verifies the Next slide arrow advances the indicator. Runs
  in pnpm verify:browser:docker alongside the existing slides
  visual fixture.
  EOF
  )"
  ```

---

## Task 6 — Final verification and PR

- [ ] **6.1** Pull latest main and rebase:

  ```bash
  git fetch origin
  git rebase origin/main
  ```

  Resolve any conflicts.

- [ ] **6.2** Run the full pre-merge check:

  ```bash
  pnpm verify:fast
  pnpm verify:self
  pnpm verify:browser:docker
  ```

- [ ] **6.3** Manual smoke pass one more time:

  - `pnpm dev`
  - DevTools mobile emulation: iPhone 14 Pro, iPhone SE (375×667),
    Pixel 7 (412×915).
  - Verify: header sizing, swipe left/right, tap Present →
    fullscreen presentation works (or overlay fallback fires),
    cross-breakpoint resize works.
  - Verify desktop is unchanged: open a deck on a wide window,
    confirm editor still mounts and behaves identically to main.

- [ ] **6.4** Self-review (don't skip — CLAUDE.md mandates a
  dispatched review before pushing). Run:

  ```bash
  /code-review
  ```

  or invoke the `superpowers:requesting-code-review` skill over the
  full branch diff. Apply blocking findings; record non-blocking
  as known limitations in the lessons file.

- [ ] **6.5** Update lessons file
  (`docs/tasks/active/20260517-slides-mobile-view-lessons.md`)
  with anything surprising encountered during implementation —
  Yorkie subscribe quirks, jsdom canvas stubs, ResizeObserver
  timing, Playwright snapshot rebaselines, etc.

- [ ] **6.6** Archive and reindex tasks:

  ```bash
  pnpm tasks:archive
  pnpm tasks:index
  ```

- [ ] **6.7** Push and open PR:

  ```bash
  git push -u origin slides-mobile-view
  gh pr create --title "slides: add read-only mobile view (<768px)" --body "$(cat <<'EOF'
  ## Summary

  - New `MobileSlidesView` component mounted by `SlidesView` when
    the viewport is under 768px. Read-only by construction (no
    editor module is mounted).
  - Header (back / title / Present), single full-width canvas via
    `SlideRenderer` reuse, footer indicator, and left/right swipe
    navigation through a new `usePointerSwipe` hook.
  - Design doc: `docs/design/slides/slides-mobile-view.md`.

  ## Test plan

  - [ ] `pnpm verify:fast` green
  - [ ] `pnpm verify:browser:docker` green (with new mobile fixture)
  - [ ] Manual: mobile emulation at 360, 390, 430 viewport widths
  - [ ] Manual: cross-breakpoint resize swaps mounts cleanly
  - [ ] Manual: Present button enters presentation (fullscreen or
        overlay fallback on iOS)
  - [ ] Manual: desktop editor unchanged at >=768px
  EOF
  )"
  ```

---

## Self-review checklist (run before pushing)

- [ ] All tasks above are checked off
- [ ] No `console.log` left in production code
- [ ] No mutation paths from `MobileSlidesView` to Yorkie except
  `ensureSlidesRoot` (which is idempotent)
- [ ] `useIsMobile` branch is placed where hook ordering stays
  consistent
- [ ] Existing desktop editor flow is byte-for-byte identical to
  `main` (diff `slides-view.tsx` — the only change should be the
  added imports and the early-return branch)
