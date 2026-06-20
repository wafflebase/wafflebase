# Slides undo/redo churn — lessons

**Created**: 2026-06-21

## Lessons

(filled in as work progresses)

- Reproduce first: `doc.getGarbageLen()` is a clean black-box proxy for
  CRDT op churn — splice-replace of an array turns every removed node
  into garbage, so the garbage delta after an undo measures exactly how
  much the restore path churned. No server attach needed.

- A local (unattached) Yorkie document never GCs, so `getGarbageLen()`
  grows monotonically. Measure the delta around a single `undo()` to
  isolate that one restore's churn from prior operations.

- `read()` runs `migrateDocument`, which wraps legacy color strings into
  `ThemeColor` objects. A snapshot is therefore in migrated shape; if the
  live root stored the legacy shape, the first reconcile rewrites every
  migrated field — a one-time migration cost that looks like churn. It
  fooled the first churn run (1336 → 186) until the test seeded canonical
  `ThemeColor` fills. Lesson: when diffing a snapshot against live CRDT
  state, make sure both sides are in the same (post-migration) shape, or
  you measure migration, not the thing you changed.

- Reconcile, don't rebuild: keep CRDT node identity by reordering with
  the array move primitives (`moveFront` / `moveAfter`) instead of splice
  remove + re-insert. Moves relink nodes and emit no garbage; splice
  tombstones the moved subtree.

- The Yorkie JS object proxy supports the `delete` operator (verified
  with a scratch test) — needed to drop optional fields (e.g.
  `placeholderRef`) during in-place reconcile.

- Stale workspace dist after a `main` pull: `pnpm slides typecheck`
  compiles against `@wafflebase/docs/dist`, not its source. After pulling
  `main` (new docs exports), run `pnpm --filter @wafflebase/docs build`
  before `verify:fast`, or typecheck fails on unrelated missing exports.
