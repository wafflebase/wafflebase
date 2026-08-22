# Slides Toolbar → Canvas Focus Release (issue #882)

**Goal:** After a toolbar control has been used and any menu it opened is
dismissed, the slide canvas is the keyboard target again — the selected
element responds to arrow keys, `Delete` and the z-order shortcuts without
needing another canvas click.

**Diagnosis (from the issue, confirmed in code):** every rule in
`buildKeyRules` is gated on `!isEditableTarget(e.target)`, and
`isEditableTarget` answers `true` for a focused `<button>`
(`packages/slides/src/view/editor/interactions/keyboard.ts:882`). Radix
returns focus to the *trigger* when a dropdown closes, and a plain button
keeps focus after a click, so from then on every document-level `keydown`
carries a toolbar button as `e.target` and every shortcut is skipped. The
gate is deliberate (Enter on a focused button must activate it; Tab inside
the shortcuts dialog must not hit the slides Tab-cycle rule) — the gap is
that nothing hands focus back once the toolbar interaction is over.

**Approach:** keep the gate; release focus at the end of a *pointer-driven*
toolbar interaction. A new `useCanvasFocusRelease()` hook watches
`focusin` inside any element marked `data-canvas-toolbar` and, on the next
task, blurs the focused toolbar button (`releaseFocusToBody()`, the helper
slides colour palettes already use). Guards:

- only `<button>` / `role="button"` are released — inputs (zoom, font size)
  legitimately keep focus;
- a trigger whose popup is still open (`data-state="open"` /
  `aria-expanded="true"`) is left alone, so opening a menu still works;
- controls marked `data-text-edit-keepalive` are exempt — they hold focus on
  behalf of a still-mounted in-place text box, and releasing would re-arm
  `Delete` / type-to-edit against the element being edited;
- the release is skipped while the user is *keyboard*-navigating: a `Tab`
  press sets that, the next `pointerdown` clears it, so Tab-navigating into
  the toolbar keeps focus where the keyboard user put it. It is deliberately
  not gated on the `pointerdown` landing *inside* the toolbar — the most
  common dismissal is clicking the canvas to close a modal Radix picker,
  which then hands focus back to the trigger;
- the check is deferred one task and re-reads `document.activeElement`, so a
  trigger that hands focus to its portalled content, and text-edit controls
  that end with `editor.focus()`, are both no-ops.

## Tasks

- [x] Add `packages/frontend/src/components/toolbar-focus-release.ts` with
      `CANVAS_TOOLBAR_ATTR` + `useCanvasFocusRelease()`.
- [x] Mark the desktop slides toolbar root with the attribute and call the
      hook from `packages/frontend/src/app/slides/toolbar/index.tsx`.
- [x] Co-located RTL test: plain-button click releases, menu open keeps
      focus, Escape-close releases, menu-item select releases, canvas-click
      dismissal releases, keepalive control keeps focus, Tab into the
      toolbar keeps focus, input keeps focus — each release assertion paired
      with a no-hook control render so it cannot pass vacuously.
- [x] Wiring test (`src/app/slides/toolbar/index.test.tsx`): the real
      `SlidesToolbar` renders the opt-in attribute and releases focus after a
      real toolbar button is clicked.
- [x] Document the rule in `docs/design/slides/slides-keyboard-shortcuts.md`
      next to the editable-target gate.

## Out of scope

- **Board.** The identical `tag === "BUTTON"` branch in
  `packages/frontend/src/app/board/is-editable-target.ts:27` is a pointer,
  not a claim — and on board that branch also keeps `Space` activating a
  focused toolbar toggle instead of entering pan mode, so opting board in
  would change board's pan-mode behaviour. The attribute is opt-in, so board
  can adopt it once that trade-off is decided; the trade-off is recorded
  under Known limitations in `docs/design/board/board-editing-parity.md`.
- The mobile slides toolbar (bottom sheets, no hardware keyboard target).
- Any change to `isEditableTarget` itself.
