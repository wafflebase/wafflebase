# Slides — Arrow Key Hijacks Text-Box Editing

Reported by user 2026-05-21: while editing text inside a Slides text-box,
pressing Arrow keys moves the surrounding shape instead of moving the
text caret, making text editing nearly impossible.

## Root cause

`packages/slides/src/view/editor/interactions/keyboard.ts:104-146` —
the Arrow nudge rule is the only `KeyRule` in this file that doesn't
gate on `!isEditableTarget(e.target)`. All sibling rules (Escape,
Delete/Backspace, Tab, Cmd+*, etc.) already skip when the event target
is a textarea / input / contenteditable.

`isEditableTarget` (defined at line 633 in the same file) already
recognises `TEXTAREA` — the hidden IME bridge mounted by
`text-box-editor.ts` via `@wafflebase/docs`' `TextEditor` — so the
guard is enough; no separate `editor.isTextEditing()` check needed.

## Plan

- [x] Add `!isEditableTarget(e.target)` to the Arrow nudge rule's
  `match` predicate, alongside `e.key === key && !isModPressed(e)`.
- [x] `pnpm verify:fast` green.
- [x] Regression test in `packages/slides/test/view/editor/interactions/keyboard.test.ts`
  modeled on the existing Backspace-in-textarea precedent. Verified to
  fail without the guard, pass with it.
- [x] Manual smoke in `pnpm dev`:
  - Select a text-box, press Arrow → shape still nudges 1px.
  - Enter text-edit mode (double-click / F2 / Enter), press Arrow →
    caret moves inside the text, shape does not move.
  - Shift+Arrow inside text → text selection extends, shape stays.
  - Esc exits edit mode, Arrow nudges again.

## Review

PR #272 — landed 2026-05-22 after #269.

- Production fix: 1 predicate term in `keyboard.ts:104-146`.
- Regression test: paired with the Backspace-in-textarea precedent
  (`keyboard.test.ts:162-172`); confirmed to fail without the guard.
- Self code review (`superpowers:requesting-code-review`) flagged the
  missing test as Important; addressed in `58c377eb`.
- Stale `packages/slides/dist/` masked itself as "pre-existing failure
  on main"; a `pnpm --filter @wafflebase/slides build` resolved it.
  Lessons file captures the trap so the next contributor on slides
  doesn't lose time on it.

## Out of scope

- Other shape-keyboard interactions inside text-edit mode (everything
  else already gates on `isEditableTarget`).
- Mobile / touch text editing — uses a different code path.
