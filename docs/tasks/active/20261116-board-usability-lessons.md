# Board usability pass — lessons

- The dev server on :5173 may be served from a sibling worktree
  (`waffledocs`), not this one. Check which checkout Vite serves before
  judging visuals.
- After branching from a fresh `origin/main`, run `pnpm install` and rebuild
  `@wafflebase/slides` before the first commit: a stale `node_modules` or
  `dist` fails `verify:fast` in unrelated packages (frontend SDK-realm test,
  CLI typecheck on `@wafflebase/slides/node`).

## Self-review

- Round 1 (correctness/tests): 5 blocking. Fixed: Miro round-rectangle
  shapes read as stickies (sticky preset + shadow moved into
  `@wafflebase/board`, Miro stickies get it), tool keys over an
  `alertdialog`, no StickyControls test, weak `hostInsertMenuItems` test.
  Disputed: "Escape test no longer exercises Escape" — it is the guard for
  the change (rebuttals file).
- Lesson: a type-less "preset" identity needs a signature no other
  creation path produces; check every importer, not just the toolbar.
- Round 2 (design fit): Esc-test rebuttal overturned the finding. 3 new
  blocking. Fixed: a stepped sticky could land off-screen and take the
  caret there (`freeStickyCenter` now walks the row both ways inside the
  visible rect, nudges otherwise); `onToolKey` gates were untested
  (extracted `handleBoardToolKey` with gate tests). Disputed: revision
  preview's "Escape is non-destructive" premise — opening the preview
  blurs and so commits any edit first (comment updated, rebuttal filed).
