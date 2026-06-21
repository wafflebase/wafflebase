# Slides native undo migration — lessons

**Created**: 2026-06-21

## Lessons

- Starting point from the #388 churn fix: Slides was the only store on
  snapshot-based undo; Sheets and Docs already use `doc.history`. The
  snapshot rebuild is what made undo/redo O(document) and caused the
  node-OOM incident — native undo is O(change) by construction.

- Known central challenge before any code: slides `batch()` runs N
  independent `doc.update()` calls, so a multi-edit batch is N native undo
  units. Grouping a batch into one undo unit is the prerequisite refactor.

- **One `doc.update` = one undo unit; there is no grouping API** in
  Yorkie 0.7.8 (no `message`/`groupId`, no public `pushUndo`). The only
  way to make one batch one undo unit is to run every mutation inside a
  single `doc.update`. Solved with an **ambient root**: `batch()` opens
  one `doc.update`, stores `r` in `this.activeRoot`, and a `withUpdate`
  helper runs each mutator against that root instead of opening its own
  update. A global `this.doc.update((r) => {` → `this.withUpdate((r) => {`
  replace converted all 50 mutators in one shot.

- **`yorkieToPlain` / `toJSON` works on object & object-array proxies
  inside an open `doc.update`** — but a *primitive*-array proxy (e.g.
  `recentColors: string[]`) has no `toJSON` and throws. Verified with a
  throwaway probe before committing to the ambient-root design. So
  `resolveMasterAndTheme` reading `activeRoot.themes` mid-update is fine;
  `pushRecentColor` correctly reads its primitive array by index. The
  pre-existing comment "a live CRDT array proxy inside doc.update throws
  on toJSON" was over-general — it's specific to primitive arrays.

- **Holding a `doc.update` open across a whole batch creates a nested-
  update hazard** that didn't exist when each mutator had its own short
  update: `updatePresence` (fired synchronously by `onSelectionChange`
  during a batch) would open a nested `doc.update`. Fix: capture the
  ambient presence proxy too (`activePresence`) and have `updatePresence`
  fold into it when a batch is open. Presence `set` is not added to
  history, so it never pollutes the batch's undo unit.

- **Undo floor needs a re-baseline hook, not just a constructor capture.**
  `ensureSlidesRoot` runs before store construction (so the constructor
  floor covers it), but the "new deck opens with one slide" seed runs
  *after* construction in `slides-view.tsx`. Added `markUndoBaseline()`
  (Yorkie-specific, not on the `SlidesStore` interface) called right after
  the seed so the user can't Cmd+Z the only slide away.

- **Verify reversibility of non-`set` ops with real undo assertions**, not
  just by reasoning. Added tests that drive `undo()`/`redo()` through an
  array move (`moveSlide`) and an object-key delete
  (`setSlideTransition(undefined)`) — both reverse cleanly under 0.7.8.
  Slides text is plain `Block[]` JSON (not Yorkie Tree), so the one known
  non-reversible op (Tree `editByPath` merge) doesn't apply here.

- **Stale deps masquerade as test failures.** 13 slides test files first
  failed with `Failed to resolve import "pdf-lib"` (declared in
  `packages/slides/package.json` but not installed after the recent PDF
  commit). `pnpm install` fixed it — not a regression from this work.
