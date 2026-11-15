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
- Round 3 (security/docs): the revision-preview rebuttal overturned its
  finding. 2 new blocking, both fixed after the round: the no-room
  fallback was a fixed offset, so repeated drops stacked on one point
  (now cascades past every exact cover); document-level tool keys fired
  from sibling chrome such as the history panel (now scoped to the board
  root or `document.body`). The loop hit its 3-round bound, so these fixes
  go to human review in the PR rather than a 4th round.
- Lesson: a document-level key handler needs a positive "is this mine"
  scope, not just a list of things to stand down for.
