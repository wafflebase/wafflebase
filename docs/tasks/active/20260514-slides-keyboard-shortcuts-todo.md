# Slides Keyboard Shortcuts — Google Slides Parity

**Goal:** Add the Google Slides parity shortcuts to the slides editor
(selection / slide navigation / present-mode start / link / help
modal). Group/Ungroup and Find/Replace are intentionally deferred.

**Design doc:** [slides-keyboard-shortcuts.md](../../design/slides/slides-keyboard-shortcuts.md)

---

### Task 1: Shortcuts catalog

**Files:**
- New: `packages/slides/src/view/editor/shortcuts-catalog.ts`
- New: `packages/slides/src/view/editor/shortcuts-catalog.test.ts`
- Modify: `packages/slides/src/index.ts` (export catalog)

- [ ] Add `ShortcutEntry` type and `SHORTCUTS` array covering all
      shortcuts shipped here.
- [ ] Add catalog invariant tests (non-empty keys, valid category).

### Task 2: Extend `KeyboardContext` + add key rules

**Files:**
- Modify: `packages/slides/src/view/editor/interactions/keyboard.ts`
- Modify: `packages/slides/src/view/editor/editor.ts`
- Modify: `packages/slides/src/view/editor/interactions/keyboard.test.ts`

- [ ] Extend `KeyboardContext` with `setCurrentSlide`,
      `enterEditMode`, `onStartPresentation`, `onShowShortcutsHelp`,
      `onLinkRequest`.
- [ ] Add rules: `Cmd+A`, `Esc` (clear selection), `Tab`/`Shift+Tab`,
      `F2`/`Enter` (enter edit on text element), `Cmd+M` (new slide),
      `Cmd+Shift+D` (duplicate slide explicit), `Page Up`/`Page Down`,
      `Cmd+Enter` / `Cmd+Shift+Enter`, `Cmd+Shift+V`, `Cmd+/`.
- [ ] Maintain ordering — Cmd+Shift+V rule must precede Cmd+V; F2/Enter
      rule must precede other Enter handling.
- [ ] Wire new ctx into `SlidesEditorImpl`. Promote `enterEditMode`
      to a method usable by the keyRule via context.
- [ ] Add `onStartPresentation` / `onShowShortcutsHelp` /
      `onLinkRequest` to `SlidesEditorOptions`.
- [ ] Tests per new rule, both Cmd and Ctrl variants where relevant.

### Task 3: Link callback plumbing

**Files:**
- Modify: `packages/docs/src/view/text-box-editor.ts`
      (`TextBoxEditorOptions.onLinkRequest`, wire to TextEditor)
- Modify: `packages/slides/src/view/editor/text-box-editor.ts`
      (`MountSlidesTextBoxOptions.onLinkRequest`, forward)
- Modify: `packages/slides/src/view/editor/editor.ts` (pass through)

- [ ] Add option to docs text-box editor, set on TextEditor instance.
- [ ] Forward through slides wrapper.
- [ ] Pass `options.onLinkRequest` from `enterEditMode`.
- [ ] No new test for plumbing — covered by integration via frontend.

### Task 4: Frontend wiring (help modal + present + link popover)

**Files:**
- New: `packages/frontend/src/app/slides/slides-shortcuts-help.tsx`
- Modify: `packages/frontend/src/app/slides/slides-detail.tsx`
      (wire callbacks, open present mode, open help modal,
      mount link popover)

- [ ] Help modal — renders `SHORTCUTS` categorized; closes on Esc /
      click outside.
- [ ] Wire `onShowShortcutsHelp` to mount help modal.
- [ ] Wire `onStartPresentation` to existing present-mode entry path.
- [ ] Wire `onLinkRequest` to a minimal link popover (text input +
      apply button) anchored near the caret.

### Task 5: Verify and commit

- [ ] `pnpm verify:fast` — must pass.
- [ ] Manual smoke: `pnpm dev`, exercise each new shortcut.
- [ ] Commits one per logical chunk; each commit must run
      `pnpm verify:fast` green.
- [ ] Update `docs/design/README.md` with link to the new design doc.

### Task 6: Archive

- [ ] Capture lessons in `20260514-slides-keyboard-shortcuts-lessons.md`.
- [ ] `pnpm tasks:archive && pnpm tasks:index`.
