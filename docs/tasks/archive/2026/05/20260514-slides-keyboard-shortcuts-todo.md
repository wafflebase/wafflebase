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

- [x] Add `ShortcutEntry` type and `SHORTCUTS` array covering all
      shortcuts shipped here.
- [x] Add catalog invariant tests (non-empty keys, valid category).

### Task 2: Extend `KeyboardContext` + add key rules

**Files:**
- Modify: `packages/slides/src/view/editor/interactions/keyboard.ts`
- Modify: `packages/slides/src/view/editor/editor.ts`
- Modify: `packages/slides/src/view/editor/interactions/keyboard.test.ts`

- [x] Extend `KeyboardContext` with `setCurrentSlide`,
      `enterEditMode`, `onStartPresentation`, `onShowShortcutsHelp`.
      (`onLinkRequest` lives on `SlidesEditorOptions` only — the
      slides-level keyRule is unnecessary because docs' text-editor
      already binds Cmd+K inside text-box edit mode.)
- [x] Add rules: `Cmd+A`, `Esc`, `Tab`/`Shift+Tab`, `F2`/`Enter`,
      `Cmd+M`, `Cmd+Shift+D`, `Page Up`/`Page Down`,
      `Cmd+Enter` / `Cmd+Shift+Enter`, `Cmd+/`. (Cmd+Shift+V already
      matched by the existing `Cmd+V` rule since it doesn't gate on
      shift; no new rule needed.)
- [x] Wire new ctx into `SlidesEditorImpl`.
- [x] Add `onStartPresentation` / `onShowShortcutsHelp` /
      `onLinkRequest` to `SlidesEditorOptions`.
- [x] Tests per new rule, Cmd variants only (Ctrl parity is covered
      by `isModPressed` and the existing Ctrl+Z tests).

### Task 3: Link callback plumbing

**Files:**
- Modify: `packages/docs/src/view/text-box-editor.ts`
- Modify: `packages/slides/src/view/editor/text-box-editor.ts`
- Modify: `packages/slides/src/view/editor/editor.ts`

- [x] Add option to docs text-box editor, set on TextEditor instance.
- [x] Forward through slides wrapper.
- [x] Pass `options.onLinkRequest` from `enterEditMode`.

### Task 4: Frontend wiring

**Files:**
- New: `packages/frontend/src/app/slides/slides-shortcuts-help.tsx`
- Modify: `packages/frontend/src/app/slides/slides-view.tsx`

- [x] Help modal renders `SHORTCUTS` categorized; closes via the
      Dialog primitive's Esc / overlay-click.
- [x] Wire `onShowShortcutsHelp` to open the modal.
- [x] **Wired in `feat/slides-presentation-mode`**: `view/present/`
      now exists in the slides package, `SlidesView` forwards
      `onStartPresentation`, and `SlidesLayout` routes the callback
      to `handleStartPresentation` so the Cmd/Ctrl+Enter shortcuts
      and the new Present split-button share the same entry path.
      See `docs/tasks/active/20260514-slides-presentation-mode-todo.md`.
- **Deferred (follow-up):** Real `onLinkRequest` popover. Requires
      extending `TextBoxEditorAPI` with `insertLink(url)` /
      `getLinkAtCursor()` so a slides-side popover can actually
      mutate the active text-box. The keyboard plumbing is in place
      (Cmd+K fires through docs text-editor → onLinkRequest), but
      no host wiring → currently a no-op while editing text. Track
      as a follow-up.

### Task 5: Verify and commit

- [x] `pnpm verify:fast` — passes (Exit 0).
- [x] Manual smoke: `pnpm dev`, exercise each new shortcut (browser
      smoke before merge per user workflow). *(Merged as #238.)*
- [x] Commits one per logical chunk; each commit `verify:fast` green.
- [x] Update `docs/design/README.md` with link to the new design doc.

### Task 6: Archive

- [x] Capture lessons in `20260514-slides-keyboard-shortcuts-lessons.md`.
- [x] `pnpm tasks:archive && pnpm tasks:index`.

## Status

- **Commits on branch `feat/slides-keyboard-shortcuts`:**
  - `Add Google Slides parity keyboard shortcuts in the editor`
  - `Wire slides shortcuts help modal on Cmd+/`
- **Next steps:** manual browser smoke; review; PR (after rebase on
  main).
