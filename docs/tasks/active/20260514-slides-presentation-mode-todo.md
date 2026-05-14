# Slides Presentation Mode — v1 (local-only)

**Goal:** Implement the presentation-mode UI that `slides-view.tsx` has
been waiting on (the `onStartPresentation` callback is intentionally
unwired, with `Cmd/Ctrl+Enter` shortcuts already firing). Single-canvas
fullscreen player, keyboard nav, click-to-advance, end screen,
fullscreen-overlay fallback. Local-only — no presence broadcast.

**Design doc:** [slides-presentation-mode.md](../../design/slides/slides-presentation-mode.md)

**Architecture:** A framework-free `startPresenter(options) → Presenter`
module in the slides package (matches `initializeEditor`'s shape) plus
a thin React shell in the frontend. Slide identified by **ID**, not
index, so concurrent Yorkie edits don't shift the presenter under the
user.

**Tech stack:** TS, Vitest + jsdom for unit tests, existing
`SlideRenderer`, React 18 for the shell.

---

## Task 1 — Presenter skeleton + navigation state

**Files:**

- Create: `packages/slides/src/view/present/presenter.ts`
- Create: `packages/slides/src/view/present/index.ts`
- Create: `packages/slides/src/view/present/presenter.test.ts`

Build the state machine and the public API; no DOM rendering yet.
The presenter tracks `currentSlideId: string | null` and
`atEndScreen: boolean`. Methods (initially private, exposed via the
returned object): `next()`, `prev()`, `goToFirst()`, `goToLast()`,
`setDocument(doc)`.

- [ ] **1.1** Write failing tests for navigation on a 3-slide fixture
  (`A`, `B`, `C`):
  - `startPresenter` with `startSlideId: 'B'` puts current at `B`.
  - `next()` from `A` → `B`; from `C` → `atEndScreen = true`; another
    `next()` while at end-screen is a no-op (exit comes from a
    separate `exit()` path, not from `next()` past end-screen).
  - `prev()` from `B` → `A`; from `A` stays at `A`. From end-screen
    state, `prev()` goes back to last slide and clears
    `atEndScreen`.
  - `goToFirst()` / `goToLast()` jump and clear `atEndScreen`.

  Mock `container.requestFullscreen` to resolve (so the constructor
  doesn't blow up in jsdom).

- [ ] **1.2** Run tests, confirm they fail with "startPresenter is
  not defined" / equivalent.
- [ ] **1.3** Implement the minimum to pass — `PresenterOptions`,
  `Presenter`, `startPresenter`. Internal `state` object with
  `currentSlideId`, `atEndScreen`, `slides: readonly Slide[]`,
  `doc: SlidesDocument`. Navigation methods mutate state; render is
  a no-op stub at this point.

  Important shape — tests will rely on this:

  ```ts
  export interface Presenter {
    setDocument(doc: SlidesDocument): void;
    dispose(): void;
    // test-only helpers (also re-exported under a `__testing` namespace?):
    // - getCurrentSlideId(): string | null
    // - isAtEndScreen(): boolean
  }
  ```

  Decision: expose `getCurrentSlideId()` and `isAtEndScreen()` on
  the `Presenter` interface itself. They're cheap and useful for
  the React shell (e.g., showing the slide number, though we
  aren't doing that in v1).

- [ ] **1.4** Run tests, confirm pass.
- [ ] **1.5** Commit: `slides: add presenter scaffold and navigation state`.

---

## Task 2 — Canvas render integration

**Files:**

- Modify: `packages/slides/src/view/present/presenter.ts`
- Modify: `packages/slides/src/view/present/presenter.test.ts`

Mount a `<canvas>` into `container`, size it to a fit-to-viewport box
(with `devicePixelRatio` baked into the backing store), and re-render
through `SlideRenderer` on every navigation. Reuse the math from
`slides-view.tsx`'s `computeFitSize` — copy it locally as a small
private helper rather than touching the frontend file in this task.

- [ ] **2.1** Add a failing test that verifies after `startPresenter`,
  `container.querySelector('canvas')` is non-null and the canvas
  `width`/`height` attributes reflect `dpr * fittedWidth/Height` for
  a stubbed `window.innerWidth/innerHeight = 1280/720`.

  Note: jsdom doesn't run `ResizeObserver`. Stub it:

  ```ts
  beforeEach(() => {
    // jsdom lacks ResizeObserver
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });
  ```

- [ ] **2.2** Implement: in `startPresenter`, create canvas, append
  to container, install a `ResizeObserver` on
  `document.documentElement` that recomputes fit on resize.
  Construct a `SlideRenderer(ctx, { hostWidth, hostHeight, dpr })`.
  Add a private `paint()` that branches on state:
  - `state.atEndScreen === true` → fill the canvas black and draw
    centered white text "End of slideshow — click or press Esc to
    exit" directly via the 2D context (no `SlideRenderer` involved).
    Font: `${Math.round(hostHeight * 0.04)}px system-ui`.
  - Otherwise → look up the current slide by ID and call
    `renderer.render(slide, doc)`. Between slide switches call
    `renderer.markDirty()` first — `SlideRenderer` is per-slide-state
    and skips repaints without it.

  Call `paint()` after every state change and after resize.

- [ ] **2.3** Add a follow-up test that `next()` triggers an additional
  call to a spied `renderer.render`. (Spy via vi.spyOn on
  `SlideRenderer.prototype.render`.) Add a test that
  `next()` from the last slide enters end-screen and that
  `renderer.render` is NOT called for the end-screen paint (it's a
  raw 2D fill).

- [ ] **2.4** Container background: set `container.style.background =
  '#000'` and `display: flex; align-items: center; justify-content:
  center` so the canvas letterboxes naturally. Save prior inline
  styles to restore on `dispose`.

- [ ] **2.5** Run tests, pass.
- [ ] **2.6** Commit: `slides: render slides on the presenter canvas`.

---

## Task 3 — Keyboard + click-to-advance

**Files:**

- Modify: `packages/slides/src/view/present/presenter.ts`
- Modify: `packages/slides/src/view/present/presenter.test.ts`

Install a capture-phase `keydown` listener on `document` and a `click`
listener on the canvas. The keydown listener `stopImmediatePropagation`s
every key (so editor key rules don't also fire) and `preventDefault`s
anything it doesn't consume.

- [ ] **3.1** Failing tests:
  - Dispatching `keydown` for `'ArrowRight'`, `' '` (space),
    `'PageDown'`, `'n'` advances. (One sub-test each, plus an
    end-screen advance.)
  - `'ArrowLeft'`, `'PageUp'`, `'Backspace'`, `'p'` go back.
  - `'Home'` / `'End'` jump.
  - `'Escape'` calls `onExit`.
  - `'z'` (with Cmd) does nothing AND `stopImmediatePropagation` /
    `preventDefault` are invoked — spy on the event. Use
    `new KeyboardEvent('keydown', { key: 'z', metaKey: true })` and
    `document.dispatchEvent(ev)`; check that `ev.defaultPrevented`
    is `true`.
  - Click on the canvas advances. Click on canvas while at
    end-screen invokes `onExit`.

- [ ] **3.2** Implement the listener. Use a single keydown handler
  table — `KEY_ACTIONS: Record<string, (state) => void>` — to keep
  the rule list compact. `Esc` → `options.onExit()` (caller decides
  whether to call `dispose` from `onExit`).

- [ ] **3.3** Pass.
- [ ] **3.4** Commit: `slides: wire presenter keyboard and click navigation`.

---

## Task 4 — Cursor auto-hide + fullscreen with overlay fallback

**Files:**

- Modify: `packages/slides/src/view/present/presenter.ts`
- Modify: `packages/slides/src/view/present/presenter.test.ts`

Hide the cursor after 3 s of no `mousemove` and restore on
`mousemove`. Call `container.requestFullscreen()` on entry; on
rejection, apply `position: fixed; inset: 0; z-index: 9999`. Listen
to `document.fullscreenchange` and call `onExit` when we leave
fullscreen via the browser chrome.

- [ ] **4.1** Failing tests (use `vi.useFakeTimers()`):
  - `container.style.cursor === 'none'` after 3 s of no movement.
  - `mousemove` clears `cursor` and re-arms.
  - `requestFullscreen` is called on the container; when it rejects,
    `container.style.position === 'fixed'` and `inset === '0px'`.
  - `fullscreenchange` event with `document.fullscreenElement = null`
    triggers `onExit`. (Stub via `Object.defineProperty` because
    jsdom doesn't implement fullscreen.)

- [ ] **4.2** Implement. Store the original inline style values
  (`container.style.cssText`?) once at entry and restore on
  `dispose`. Track `mountMode: 'fullscreen' | 'overlay'` so
  `dispose` knows whether to call `exitFullscreen` or just remove
  the overlay styles.

- [ ] **4.3** Pass. Commit:
  `slides: add presenter fullscreen with overlay fallback and cursor auto-hide`.

---

## Task 5 — Remote-change handling in setDocument

**Files:**

- Modify: `packages/slides/src/view/present/presenter.ts`
- Modify: `packages/slides/src/view/present/presenter.test.ts`

`setDocument(newDoc)` must:

1. Re-bind `state.doc` and `state.slides`.
2. If the current slide ID is still present, re-render (so theme /
   element edits show up immediately).
3. If it's gone, pick the slide at the same index in the new array;
   if the index is now out-of-bounds, pick the last; update
   `currentSlideId`.
4. If `slides.length === 0`, call `onExit`.
5. The `atEndScreen` state is preserved unless the deck shrinks below
   the original-last-slide index, in which case it stays at
   end-screen (`atEndScreen = true`) — the presentation is still
   "over."

- [ ] **5.1** Failing tests:
  - Setting a doc where current slide still exists → no slide-id
    change; render is called once with the new doc.
  - Setting a doc where current slide is removed (was at index 1 of
    `[A, B, C]`; new is `[A, C]`) → currentSlideId becomes the
    slide now at index 1 (`C`).
  - Removing all slides → `onExit` invoked.

- [ ] **5.2** Implement. Pass. Commit:
  `slides: handle remote doc changes in the presenter`.

---

## Task 6 — dispose() cleanup + public exports

**Files:**

- Modify: `packages/slides/src/view/present/presenter.ts`
- Modify: `packages/slides/src/view/present/index.ts`
- Modify: `packages/slides/src/view/present/presenter.test.ts`
- Modify: `packages/slides/src/index.ts`

Make sure `dispose()` is idempotent and tears down everything
installed. **Order matters**: detach the `fullscreenchange` listener
BEFORE calling `exitFullscreen`, otherwise our own teardown triggers
the listener which calls `onExit` which loops back into `dispose`.

- Set a `disposed = true` flag at the very top; bail out of further
  cleanup if it was already set (idempotency).
- Remove the `fullscreenchange` listener.
- Remove the document-level keydown listener (capture-phase — must
  pass `{ capture: true }` to `removeEventListener` to match the
  registration).
- Remove the canvas click listener.
- Remove the `mousemove` listener.
- Clear the cursor-hide timeout.
- Disconnect the `ResizeObserver`.
- If `mountMode === 'fullscreen'` AND `document.fullscreenElement`
  is non-null, call `document.exitFullscreen()` wrapped in a
  try/catch (it throws when not in fullscreen, e.g. user already
  pressed Esc).
- Remove the canvas from `container`.
- Restore the container's `style.cssText` to its pre-entry value.

- [ ] **6.1** Test: call `dispose()`, then verify
  `container.children.length === 0`, container style restored,
  subsequent `keydown` dispatches don't advance / don't crash, and a
  second `dispose()` call is a no-op.

- [ ] **6.2** Implement.

- [ ] **6.3** Add `view/present/index.ts`:

  ```ts
  export {
    startPresenter,
    type Presenter,
    type PresenterOptions,
  } from './presenter';
  ```

  Append to `packages/slides/src/index.ts`:

  ```ts
  export {
    startPresenter,
    type Presenter,
    type PresenterOptions,
  } from './view/present';
  ```

- [ ] **6.4** Run `pnpm --filter @wafflebase/slides test` + `typecheck`
  + `build` to make sure the new export survives the library build.

- [ ] **6.5** Commit: `slides: ship presenter dispose and public exports`.

---

## Task 7 — React shell (slides-presentation-mode.tsx)

**Files:**

- Create: `packages/frontend/src/app/slides/slides-presentation-mode.tsx`
- Create: `packages/frontend/src/app/slides/slides-presentation-mode.test.tsx`

Thin React component that owns a portal `<div>` (mounted onto
`document.body`), calls `startPresenter` on mount, forwards
`store.onChange` snapshots into `presenter.setDocument`, and
`dispose`s on unmount.

Props:

```ts
interface SlidesPresentationModeProps {
  store: YorkieSlidesStore;
  startSlideId: string;
  onExit: () => void;
}
```

Implementation outline:

```tsx
export function SlidesPresentationMode(props: SlidesPresentationModeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const presenterRef = useRef<Presenter | null>(null);

  useEffect(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hostRef.current = host;

    // Drop editor focus so its contenteditable doesn't eat keystrokes.
    (document.activeElement as HTMLElement | null)?.blur?.();

    const presenter = startPresenter({
      container: host,
      doc: props.store.read(),
      startSlideId: props.startSlideId,
      onExit: () => {
        props.onExit();
      },
    });
    presenterRef.current = presenter;

    const unsubscribe = props.store.onChange(() => {
      presenter.setDocument(props.store.read());
    });

    return () => {
      unsubscribe();
      presenter.dispose();
      host.remove();
      presenterRef.current = null;
      hostRef.current = null;
    };
  // Intentionally mount-only: store / startSlideId changes are not
  // expected within a single presentation session. If they did
  // change, we'd want to dispose + remount rather than reconfigure
  // mid-flight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
```

- [ ] **7.1** Failing test (`slides-presentation-mode.test.tsx`): mount
  with a stub store (`onChange`, `read`), assert
  `document.body.lastChild` is a `<div>` containing a `<canvas>`.
  Unmount, assert the div is gone.

- [ ] **7.2** Implement and pass.

- [ ] **7.3** Commit: `slides: add presentation-mode react shell`.

---

## Task 8 — Wire `onStartPresentation` in slides-view.tsx

**Files:**

- Modify: `packages/frontend/src/app/slides/slides-view.tsx`

`SlidesLayout` (the parent in `slides-detail.tsx`) owns the
"presenting" state. `slides-view.tsx` forwards a prop down to the
editor:

```ts
interface SlidesViewProps {
  // ...existing
  onStartPresentation?: (from: 'current' | 'first') => void;
}
```

…and passes it into `initializeEditor`:

```ts
const editor = initializeEditor({
  // ...
  onStartPresentation: props.onStartPresentation,
});
```

- [ ] **8.1** Update the prop type + thread it through to
  `initializeEditor`. The comment block currently saying "Present
  mode UI lands in a separate phase" needs to be deleted (it's now
  landed).

- [ ] **8.2** Run `pnpm --filter @wafflebase/frontend typecheck`.

- [ ] **8.3** Commit: `slides: forward onStartPresentation to the editor`.

---

## Task 9 — Present split-button + state in slides-detail.tsx

**Files:**

- Modify: `packages/frontend/src/app/slides/slides-detail.tsx`

Add the `presentingFrom: 'current' | 'first' | null` local state,
the handler that sets it, and the conditional
`<SlidesPresentationMode />` mount. Add a "Present" split-button into
the `SiteHeader` children, next to `ShareDialog` and `UserPresence`.

Split-button shape: a primary button ("Present") + a small chevron
that opens a Radix dropdown menu with one item ("Present from
beginning"). The primary button calls `handleStart('current')`, the
menu item calls `handleStart('first')`. Disabled when
`!store || store.read().slides.length === 0`.

The starting slide ID:

```ts
function resolveStartSlideId(
  store: YorkieSlidesStore,
  from: 'current' | 'first',
  editor: SlidesEditor | null,
): string | undefined {
  const slides = store.read().slides;
  if (slides.length === 0) return undefined;
  if (from === 'first') return slides[0].id;
  return editor?.getCurrentSlideId() ?? slides[0].id;
}
```

Mount conditionally:

```tsx
{presentingFrom && store && (
  <SlidesPresentationMode
    store={store}
    startSlideId={resolveStartSlideId(store, presentingFrom, editor)!}
    onExit={() => setPresentingFrom(null)}
  />
)}
```

The button uses Lucide `Play` icon + the existing
`@/components/ui/button` + `@/components/ui/dropdown-menu`
primitives (check sibling files for the exact import paths).

- [ ] **9.1** Add a tiny `<PresentButton />` component inside
  `slides-detail.tsx` (or extract to its own file
  `slides-present-button.tsx` if it grows beyond ~30 lines).

  Props: `{ disabled: boolean; onStart: (from: 'current' | 'first') => void }`.

- [ ] **9.2** Wire the state + the conditional mount. The
  `handleStart` function MUST early-return when
  `!store || store.read().slides.length === 0` — this guards both
  the button path and the `Cmd+Enter` shortcut path (the shortcut
  goes through the editor's `onStartPresentation` callback, which
  we wire to the same `handleStart`). The button's `disabled` is
  cosmetic defense-in-depth; the handler guard is the real one.

- [ ] **9.3** Verify the button is keyboard-accessible (Tab into it,
  Enter fires "current", `ArrowDown` opens the menu). The existing
  dropdown-menu primitive handles this — just make sure the button
  isn't wrapped in something that swallows keys.

- [ ] **9.4** Commit: `slides: add Present split-button to the slides header`.

---

## Task 10 — Verify + smoke + close out

- [ ] **10.1** `pnpm verify:fast` — passes (Exit 0). If lint / unit
  tests fail, fix and re-run before continuing.

- [ ] **10.2** Manual smoke (`pnpm dev`):
  1. Open a slides doc, create 3 slides with distinct titles.
  2. Click the **Present** button → fullscreen, current slide
     visible, letterboxed.
  3. `→` advances. `←` goes back. `Space`/`PageDown` advance.
     `Home`/`End` jump.
  4. Click on the canvas → advances.
  5. `→` past the last slide → black "End of slideshow" screen.
     Click it → exits to editor.
  6. Re-enter, hit `Esc` → exits cleanly.
  7. Re-enter on slide 2, in another browser tab edit slide 2's
     text → text updates in presenter.
  8. Re-enter on slide 3, in another tab delete slide 3 → presenter
     jumps to remaining last slide.
  9. Click chevron → "Present from beginning" → starts at slide 1.
  10. Move mouse, wait 3 s → cursor disappears. Move → reappears.

  If any step regresses, fix before declaring done.

- [ ] **10.3** Cross-check the slides-keyboard-shortcuts task doc
  (`20260514-slides-keyboard-shortcuts-todo.md`) — Task 4 has a
  "Deferred: onStartPresentation wiring" item that this PR closes.
  Tick that box and add a back-reference.

- [ ] **10.4** Update commit log into a single PR-ready summary in
  a `## Status` section at the end of this file (mirror the
  keyboard-shortcuts task doc's pattern).

- [ ] **10.5** Self review the full branch diff via
  `superpowers:requesting-code-review` or `/code-review` before
  pushing. Address blocking findings; note non-blocking ones as
  known limitations in the PR description.

- [ ] **10.6** Capture lessons in
  `20260514-slides-presentation-mode-lessons.md`.

- [ ] **10.7** `pnpm tasks:archive && pnpm tasks:index`. Commit
  the archived files and the README update.

---

## Status

**Branch:** `feat/slides-presentation-mode` (off `main` @ `2c319e59`).

**Commits (13, oldest → newest):**

1. `c9ce715f` Add slides presentation mode v1 design and plan
2. `4e173dd5` Add slides presenter scaffold and navigation state
3. `1e17df5b` Guard slides presenter against empty deck *(Task 1 fixup)*
4. `ee045edf` Render slides on the presenter canvas
5. `caefa99a` Guard presenter ResizeObserver and lift end-screen constants *(Task 2 fixup)*
6. `e7501762` Wire presenter keyboard and click navigation
7. `ef7155db` Add presenter fullscreen, overlay fallback, cursor auto-hide
8. `bdc7df05` Identity-gate presenter fullscreenchange handler *(Task 4 fixup)*
9. `6bc0920b` Handle remote doc changes in the presenter
10. `06c24ecc` Tear down presenter cleanly and export from the package
11. `e2fce34b` Add slides presentation mode React shell
12. `cc9dbc83` Forward onStartPresentation to the slides editor
13. `ffa0df8e` Add Present split-button and presenting state to slides header

**Verification:** `pnpm verify:fast` green on the latest commit
(47 test files, 764 tests). 50 unit tests in
`packages/slides/src/view/present/presenter.test.ts` cover navigation,
canvas mount, end-screen, keyboard, click, cursor auto-hide, fullscreen,
overlay fallback, identity-gated fullscreenchange, remote-change
handling, and dispose cleanup.

**Outstanding (10.2 / 10.5 / 10.6 / 10.7):**

- Manual browser smoke (`pnpm dev`) per the Task 10.2 checklist —
  user-driven per the workflow.
- Optional final cross-cutting code review (e.g. `/ultrareview`).
- Lessons file (`20260514-slides-presentation-mode-lessons.md`).
- Archive (`pnpm tasks:archive && pnpm tasks:index`).

**Parked work**: Branch `wip/shape-insert-hover-preview` carries the
unrelated shape-insert hover-preview + Escape-disarm changes that were
sitting uncommitted on `main` at session start. Independent of this PR.
