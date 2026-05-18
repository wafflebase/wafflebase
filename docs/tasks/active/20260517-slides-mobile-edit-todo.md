# Slides Mobile Light Edit (Phase B) — todo

**Goal:** Replace the mobile read-only `SlideRenderer` path inside
`MobileSlidesView` with the full desktop `SlidesEditor`, then layer
mobile-specific UI on top — bottom-sheet text formatting, slide-ops
FAB, header undo/redo — so a phone user can tap to select, drag to
move, double-tap to edit text, format text, and add/duplicate/delete
slides. Edits go through the existing `SlidesStore`; Yorkie sync,
undo/redo, and persistence are inherited from desktop.

**Design doc:** [slides-mobile-edit.md](../../design/slides/slides-mobile-edit.md)
**Phase A doc (still authoritative for the shell):** [slides-mobile-view.md](../../design/slides/slides-mobile-view.md)
**Phase A lessons (read first):** [20260517-slides-mobile-view-lessons.md](./20260517-slides-mobile-view-lessons.md)

**Architecture summary:** `MobileSlidesView` already owns
`YorkieSlidesStore` (for Present mode). The change is: stop building
a `SlideRenderer` against `<canvas>`, build a `SlidesEditor` against
`<canvas> + <overlay>` instead. The editor's existing public surface
(`enterTextEditing`, `setSelection`, `getActiveTextEditor`,
`store.*`) is what mobile UI binds to.

**Tech stack:** React 18, TypeScript, existing `SlidesEditor` /
`YorkieSlidesStore`, `node:test` for pure-logic helpers, Playwright
(`pnpm verify:browser:docker`) for UI behavior. **No Vitest, no
React Testing Library** (see Phase A lesson on `resolve-hooks.mjs`).

---

## PR sequencing

The work is split into five PRs that each leave `main` shippable. The
spike (Task 0) found that iOS Safari does not synthesize `mousemove`
during touch drags — the editor's `mousedown/mousemove/mouseup`
handlers see only the down/up halves. Task 1 was therefore split into
Task 1a (Pointer Events migration in the slides package) and Task 1b
(the original mobile-mount work). See
[lessons](./20260517-slides-mobile-edit-lessons.md) for the matrix
that drove this split.

| PR | Adds | Risk |
|---|---|---|
| **Task 0** — spike | Throwaway branch, no merge | None — discovery only (✅ done) |
| **Task 1a** — Pointer Events migration | `mouse*` → `pointer*` in slides editor; desktop unchanged | Mechanical rename, wide diff |
| **Task 1b** — Mount editor on mobile | Tap, drag, resize work on touch; long-press callout suppressed | Builds on 1a |
| **Task 2** — Text edit + bottom-sheet | Double-tap → edit; format bar | Mobile IME quirks |
| **Task 3** — Slide ops FAB + undo/redo | Add/dup/delete slide; history buttons | Store API additions |
| **Task 4** — Visual tests + final polish | Playwright fixtures, perm-gated read-only fallback | Snapshot baselines |

---

## Task 0 — Spike (no PR; discovery) ✅ done

**Outcome:** ran on iPhone 16 Pro sim. Tap-select, double-tap-text,
blank-tap clear all work via iOS's `mousedown→mouseup→click`
synthesis. **Drag is blocked** — iOS does not synthesize `mousemove`
during touch drag, so the editor's `document.addEventListener('mousemove', ...)`
handlers never fire. **Long-press callout is not suppressed** by
`onContextMenu` — iOS's callout is a separate gesture, not a
`contextmenu` event.

Gate decision: **option (B) — split Task 1 into 1a (Pointer Events
migration) + 1b (mobile mount).** Full matrix and rationale in
[lessons](./20260517-slides-mobile-edit-lessons.md).

Spike artifacts discarded:
- `slides/mobile-edit-spike` branch
- `packages/frontend/public/_spike-login.html` (cookie-installer; tokens via URL hash, never logged)
- exploratory edits to `mobile-slides-view.tsx`

---

## Task 1a — Pointer Events migration (PR 1a)

**Files (all in `packages/slides/`):**

- Modify: `packages/slides/src/view/editor/editor.ts` (~35 listener strings)
- Modify: `packages/slides/src/view/editor/thumbnail-panel.ts`
- Modify: `packages/slides/src/view/editor/context-menu.ts`
- Modify: `packages/slides/src/view/editor/layout-picker.ts`

**Goal:** Replace every `mousedown` / `mousemove` / `mouseup` event
listener with `pointerdown` / `pointermove` / `pointerup`. Pointer
Events are a strict superset of Mouse Events — `PointerEvent`
inherits from `MouseEvent` in the TS lib, and browsers synthesize
pointer events from both mouse and touch inputs. Desktop behavior is
unchanged; iOS touch drag will fire move events for the first time.

**Constraints:**

- Do not change the state machine, hit-test logic, drag-commit code,
  or render pipeline. This PR is purely the event-type rename and
  any minimal accompanying changes (`MouseEvent` parameter types →
  `PointerEvent`, `setPointerCapture` calls where needed for
  drag-out-of-element).
- `document.addEventListener('mousemove' / 'mouseup', ...)` after a
  canvas/overlay mousedown becomes `document.addEventListener('pointermove' / 'pointerup', ...)`.
  Keep the same handler shape.
- For handlers that need pointer capture to survive the pointer
  leaving the element (drag, resize, rotate), call
  `e.currentTarget.setPointerCapture(e.pointerId)` on pointerdown
  and `releasePointerCapture` on pointerup. The existing pattern of
  attaching move/up to `document` already works without capture —
  use capture only where the spike or follow-up smoke shows
  drag-out lossage.

**Steps:**

- [ ] **1a.1** Branch from latest main (already on this branch —
  `slides/mobile-edit-pointer-events`):

  ```bash
  git status            # confirm clean working tree on this branch
  ```

- [ ] **1a.2** In `packages/slides/src/view/editor/editor.ts`,
  replace event-type strings — `mousedown` → `pointerdown`,
  `mousemove` → `pointermove`, `mouseup` → `pointerup`. Update
  callback parameter types from `(e: MouseEvent)` to
  `(e: PointerEvent)` where present. There are ~35 listener strings
  per spike grep; expect each to fall into one of three shapes:

  1. Initial canvas/overlay listener (lines ~824-825 today):
     `this.on(canvas, 'mousedown', onDown)` → `this.on(canvas, 'pointerdown', onDown)`.
  2. Per-interaction document move+up pair (drag, resize, rotate,
     adjustment, lasso, connector-endpoint, etc.): both listeners
     in the pair convert together.
  3. Cleanup `removeEventListener` calls — must match the listener
     they tear down.

- [ ] **1a.3** Repeat for sibling files. They cover panel widgets:

  - `thumbnail-panel.ts` — slide-strip drag-to-reorder.
  - `context-menu.ts` — right-click context menu show/hide
    (still triggered via `contextmenu` event, which is correct —
    only the pair-internal mousedown/move/up listeners change).
  - `layout-picker.ts` — layout swatch hover/click panel.

- [ ] **1a.4** Run `pnpm verify:fast`. Expect zero new failures —
  the existing slides editor unit tests use synthetic events; if
  any test dispatches a literal `new MouseEvent('mousedown', ...)`
  the test still works because pointer-event listeners do NOT fire
  on dispatched mouse events. **Re-check the test files** for any
  such cases and update them to dispatch `PointerEvent` if so. Use:

  ```bash
  grep -rnE "new MouseEvent\(|dispatchEvent.*mouse" packages/slides --include="*.ts" --include="*.test.ts"
  ```

- [ ] **1a.5** Desktop smoke (`pnpm dev`, wide window):
  - Open a deck, click an element → selection box appears
  - Drag an element → moves smoothly
  - Drag a corner handle → resizes
  - Drag rotate handle → rotates
  - Right-click → context menu
  - Drag a thumbnail to reorder slides
  - Open layout picker, hover swatches
  - **Crucially:** drag an element, hold, drag the pointer outside
    the canvas, release — the drop should land at the release
    position (this tests that `document`-level pointer move/up
    listeners still receive events after the pointer leaves the
    canvas). If this fails, add `setPointerCapture` on the
    triggering pointerdown.

- [ ] **1a.6** Self-review with `/code-review` over the branch diff.
  Apply blocking findings.

- [ ] **1a.7** Commit (one commit — this is a single mechanical
  refactor, not a sequence of independent fixes):

  ```bash
  git add packages/slides/src/view/editor/editor.ts \
    packages/slides/src/view/editor/thumbnail-panel.ts \
    packages/slides/src/view/editor/context-menu.ts \
    packages/slides/src/view/editor/layout-picker.ts
  # plus any updated test files from step 1a.4

  git commit -m "$(cat <<'EOF'
  slides: migrate editor from Mouse Events to Pointer Events

  Replaces every mousedown/mousemove/mouseup listener with the
  pointer-event equivalent. PointerEvent is a strict superset of
  MouseEvent (it inherits from it in TS), and browsers synthesize
  pointer events for both mouse and touch input — so this rename
  costs nothing on desktop but is the prerequisite for touch drag
  on iOS Safari, which never synthesizes mousemove during a touch
  drag (only mousedown/mouseup for taps). Pen tablets and stylus
  input get supported as a side-effect.

  Phase B spike findings:
  docs/tasks/active/20260517-slides-mobile-edit-lessons.md
  EOF
  )"
  ```

- [ ] **1a.8** Hold the push. Wait for Task 1b commits, then push
  the batch and open a single PR that covers 1a + 1b — the migration
  has no behavior change on its own and the meaningful test is
  Task 1b's mobile mount. (If 1a's diff is too large to comfortably
  review alongside 1b, open 1a as a standalone PR — judge after
  seeing the diff.)

---

## Task 1b — Mount `SlidesEditor` on mobile (PR 1b)

**Files:**

- Modify: `packages/slides/src/view/editor/hit-test.ts` (touch hit tolerance)
- Modify: `packages/frontend/src/app/slides/mobile-slides-view.tsx`
- Modify: `packages/frontend/src/app/slides/slides-detail.tsx`
  (pass `mode` prop; default `'edit'`)

**Acceptance:** every "works" row in the spike matrix still works;
every "blocked" row from the spike lands its fix in this PR (Pointer
Events covers the drag/resize/rotate gap from 1a; the long-press
callout suppression lands here in 1b.5).

- [ ] **1.1** Continue on `slides/mobile-edit-pointer-events` (or
  whichever branch holds the 1a commit). 1a and 1b ship as a single
  PR unless the 1a diff turns out to be too large to review
  comfortably alongside 1b.

- [ ] **1.2** Add a `tolerance?: number` parameter to `handleHitTest`
  in `packages/slides/src/view/editor/hit-test.ts`. Default 0 (no
  behavior change for desktop). When > 0, every handle's hit
  rectangle expands by `tolerance` on each side. Add a pure-logic
  unit test in `packages/slides/src/view/editor/hit-test.test.ts`
  using `node:test`:

  ```ts
  import { describe, it } from 'node:test';
  import assert from 'node:assert/strict';
  import { handleHitTest } from './hit-test';

  describe('handleHitTest tolerance', () => {
    it('hits a corner handle within tolerance', () => {
      // Frame at (100, 100), 200x100. Top-left handle center at (100,100).
      // Without tolerance, point (110, 110) at default 8px handle = miss outside core.
      const frame = { x: 100, y: 100, w: 200, h: 100, rotation: 0 };
      const hit = handleHitTest({ x: 110, y: 110 }, frame, { tolerance: 22 });
      assert.equal(hit, 'nw');
    });

    it('does not hit far outside even with tolerance', () => {
      const frame = { x: 100, y: 100, w: 200, h: 100, rotation: 0 };
      const hit = handleHitTest({ x: 50, y: 50 }, frame, { tolerance: 22 });
      assert.equal(hit, null);
    });
  });
  ```

  Update all `handleHitTest` callers — none should change behavior
  (omit `tolerance` to keep default 0).

- [ ] **1.3** Add a `mode?: 'edit' | 'view'` prop to
  `MobileSlidesView`. Default `'edit'`. The `'view'` branch keeps
  the current `SlideRenderer` path word-for-word. The `'edit'`
  branch builds canvas + overlay + `SlidesEditor` (pattern copied
  from spike).

  Pass `touchHandleTolerance: 22` to the editor — exposed via a
  new optional field on `SlidesEditorOptions`. The editor forwards
  it to `handleHitTest` calls. (If the spike found `0.2`'s
  changes were narrower, do those instead — but always preserve
  the desktop default of 0.)

- [ ] **1.4** In `slides-detail.tsx`'s `SlidesLayout`, leave
  `mode` defaulted (don't pass it yet). Permission-gated `'view'`
  wiring lands in Task 4. Phase A's `<MobileSlidesView documentId={...} />`
  becomes `<MobileSlidesView documentId={...} mode="edit" />` —
  explicit at the call site.

- [ ] **1.5** Suppress iOS long-press callout (the spike's second
  blocked row). In the `'edit'` branch of `MobileSlidesView`, add
  to the canvas-host inline style:

  ```ts
  WebkitTouchCallout: 'none' as const,
  WebkitUserSelect: 'none' as const,
  userSelect: 'none' as const,
  ```

  The `onContextMenu={(e) => e.preventDefault()}` from the spike is
  no-op against iOS — the callout (text/image preview) is a
  separate touch gesture. The CSS combo is what blocks it. Leave
  `onContextMenu` in place for desktop right-click suppression
  inside `edit` mode (right-click context menu still belongs to
  the editor).

- [ ] **1.6** Run gate locally:

  ```bash
  pnpm verify:fast
  ```

- [ ] **1.7** Manual smoke (per [Phase A feedback memory on browser
  verification](../../tasks/active/20260517-slides-mobile-view-lessons.md)):

  - iPhone 16 sim re-run of the spike matrix (the sim is the
    easiest fast-loop; cookie-installer trick from the spike has
    been removed, so log in via GitHub OAuth on the sim once or
    re-introduce the installer locally without committing it).
    Expect drag/resize/rotate to all work now.
  - Long-press on a shape: verify the iOS callout no longer
    appears.
  - Desktop ≥ 768px still mounts the full editor unchanged
    (regression check on `slides-view.tsx`).
  - **Real device pass** for IME + pinch — sim can't faithfully
    reproduce either. Open via `vite --host` on iPhone Safari +
    Android Chrome.

- [ ] **1.8** Self-review with `/code-review` over the full
  branch diff (covers 1a + 1b commits). Apply blocking findings.

- [ ] **1.9** Commit each scoped change separately (per
  `feedback_workflow_preferences`), push the batch at the end:

  ```bash
  # commit 1: hit-test tolerance
  git add packages/slides/src/view/editor/hit-test.ts \
    packages/slides/src/view/editor/hit-test.test.ts
  git commit -m "$(cat <<'EOF'
  slides: add touch-friendly tolerance to handleHitTest

  Mobile fingertips can't reliably hit 8px handles. Add an opt-in
  tolerance parameter that expands the hit rectangle without
  changing the visual handle size or any desktop behavior (default
  0). MobileSlidesView passes 22 in the next commit.
  EOF
  )"

  # commit 2: editor option
  # commit 3: MobileSlidesView edit mode
  # commit 4: slides-detail mode prop wiring

  git push -u origin slides/mobile-edit-mount
  gh pr create --title "slides: mount SlidesEditor on mobile (Phase B1)" --body "..."
  ```

---

## Task 2 — Text edit + bottom-sheet (PR 2)

**Files:**

- Modify: `packages/slides/src/view/editor/text-box-editor.ts`
  (expose any format getters/setters missing on `SlidesTextBoxEditor`)
- Create: `packages/frontend/src/app/slides/mobile-text-format-sheet.tsx`
- Modify: `packages/frontend/src/app/slides/mobile-slides-view.tsx`

- [ ] **2.1** Audit `SlidesTextBoxEditor`'s public surface against
  what `toolbar/text-edit-section.tsx` calls today. List any
  desktop-only helpers (e.g. format toggles that live on the toolbar
  component rather than the editor). Move format read/write into
  `text-box-editor.ts` so the mobile sheet can bind to the same
  source of truth. The desktop toolbar refactors to call the new
  methods in the same PR.

- [ ] **2.2** Create `mobile-text-format-sheet.tsx`. Component
  takes `editor: SlidesEditor` and `currentTextEditor: SlidesTextBoxEditor | null`
  as props. Renders nothing when `currentTextEditor` is null. When
  present, renders a 64px-high bottom-anchored bar with:

  - B / I / U toggles (`active.toggleBold()` etc.)
  - Font size stepper (− / value / +)
  - Color swatch (opens a small color popover; reuse
    `themed-color-picker.tsx` if compact enough, otherwise inline a
    minimal swatch grid)

  Subscribe to `editor.onTextEditingChange` to mount/unmount the
  sheet. Within the sheet, re-render on a local timer or via
  `currentTextEditor.onSelectionChange` so toggle state stays
  current as the user moves the caret.

- [ ] **2.3** In `MobileSlidesView`'s `edit` branch, mount the
  sheet. When the sheet is visible, shrink `canvas-host` by 64px and
  call `editor.setHostSize(newW, newH)` so the canvas re-fits — the
  selected text element stays in view. Reverse on unmount.

- [ ] **2.4** Real-device pass on iOS Safari + Android Chrome:
  double-tap a text element, type Korean (IME),
  toggle bold/italic mid-typing, change font size, change color,
  tap outside to commit. Verify the same edits sync to a second
  browser tab (collaboration regression check).

- [ ] **2.5** `pnpm verify:fast`, self-review, commit-by-commit
  push, PR.

---

## Task 3 — Slide ops FAB + undo/redo (PR 3)

**Files:**

- Modify: `packages/slides/src/store/store.ts` (add `onHistoryChange`)
- Modify: `packages/slides/src/store/memory.ts`
- Modify: `packages/frontend/src/app/slides/yorkie-slides-store.ts`
- Create: `packages/frontend/src/app/slides/mobile-slide-ops-fab.tsx`
- Modify: `packages/frontend/src/app/slides/mobile-slides-view.tsx`

- [ ] **3.1** Extend `SlidesStore` with
  `onHistoryChange(cb: () => void): () => void`. Implement on both
  stores. `MemSlidesStore` fires it on every successful mutation
  inside `withHistory`; `YorkieSlidesStore` fires it after the
  Yorkie `doc.update` callback resolves.

- [ ] **3.2** Add `canUndo() / canRedo()` if not already present on
  `SlidesStore`. (Spec on existing implementation — they probably
  exist on `SlidesEditor`, may need to surface on the store.)

- [ ] **3.3** In the mobile header, add two icon buttons between
  Back and Title: undo (↶), redo (↷). Both have 44×44 touch targets.
  Bind `disabled` to `store.canUndo()` / `canRedo()`; re-derive on
  `store.onHistoryChange`.

- [ ] **3.4** Create `mobile-slide-ops-fab.tsx`. 56×56 circle,
  bottom-right of canvas-host, `+` glyph. Tap →
  `store.addSlide(currentLayoutId)`. Long-press (500ms) →
  vertical menu with:

  - Duplicate slide → `store.duplicateSlide(currentSlideId)`
  - Delete slide → `store.removeSlide(currentSlideId)` then
    `setCurrentSlideId(next-or-prev)`
  - Change layout → opens a sheet of layout thumbnails; tap →
    `store.applyLayout(currentSlideId, picked)`

  Layout thumbnails reuse the existing renderer
  (`view/canvas/layout-preview.ts`).

- [ ] **3.5** Real-device smoke. Add slide → confirm `currentSlideId`
  advances. Delete on a single-slide deck → confirm the editor
  handles the empty state (probably needs a guard — add it to the
  mobile component, not the store).

- [ ] **3.6** `pnpm verify:fast`, self-review, push, PR.

---

## Task 4 — Visual tests, perm-gated read-only fallback, polish (PR 4)

**Files:**

- Modify: `packages/frontend/src/app/slides/slides-detail.tsx`
  (wire `mode` from permission state)
- Add Playwright spec under
  `packages/frontend/tests/visual/slides-mobile-edit.spec.ts`
  (mirroring Phase A's spec)
- Modify: `docs/design/slides/slides-mobile-edit.md` (mark target
  version shipped, link to PRs)

- [ ] **4.1** Find where user permission for the document is
  available in `slides-detail.tsx` (likely a hook or context already
  shared with sharing.md's wiring). Pass `mode={canEdit ? 'edit' : 'view'}`.

- [ ] **4.2** Playwright spec at 390×844 + 360×640:

  - Tap an element → assert selection handles appear in the overlay
    DOM.
  - Drag an element by 100px → assert its CSS position changes (or
    the canvas snapshot shifts — pick whichever the existing slides
    spec uses).
  - Double-tap a text element → assert the bottom-sheet appears.
  - Tap the FAB `+` → assert footer count increments.
  - Snapshot the layout in edit mode.

- [ ] **4.3** `pnpm verify:browser:docker` — review first-run
  snapshots, commit baselines if they look right.

- [ ] **4.4** Final cross-PR smoke on real iOS + Android. Capture
  any surprises into `*-lessons.md`.

- [ ] **4.5** Archive + index:

  ```bash
  pnpm tasks:archive
  pnpm tasks:index
  ```

- [ ] **4.6** PR, self-review, merge.

---

## Self-review checklist (run before pushing each PR)

- [ ] No `console.log` left in.
- [ ] Desktop editor unchanged at ≥ 768px (diff `slides-view.tsx`,
  `slides-detail.tsx`'s desktop branch).
- [ ] All store mutations from mobile go through `SlidesStore`. No
  direct `doc.update` from mobile components.
- [ ] `useIsMobile` branch in `slides-detail.tsx` still places the
  mode swap consistent with React's rules-of-hooks (Phase A lesson).
- [ ] Phase A's read-only fallback is reachable via
  `<MobileSlidesView mode="view" />` and visually identical to
  before this work.
- [ ] Lessons file updated each PR with anything surprising.
