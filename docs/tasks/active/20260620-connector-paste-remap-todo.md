# Connector paste/duplicate — remap attached endpoints

## Problem

In Slides, connecting two shapes with an arrow (connector), selecting all,
then pasting (Cmd+V) or duplicating (Cmd+D) produces a pasted arrow that
still points at the **original** shapes instead of the pasted copies.

## Root cause

- A connector endpoint references its shape by id: `Endpoint = { kind:
  'attached'; elementId; siteIndex }` (`model/connector.ts`).
- Paste (`keyboard.ts` Cmd+V) and duplicate (Cmd+D) call `store.addElement`
  per element. `addElement` assigns a fresh id to the element itself but
  copies the connector's `start.elementId` / `end.elementId` verbatim —
  there is no old→new id remap.
- The clipboard serializer (`clipboard.ts`) additionally stripped each
  element's own `id`, so the paste path had no key to correlate copies.

Result: pasted/duplicated connectors keep pointing at the source shapes.

## Plan

- [x] Preserve element `id` through clipboard serialize/deserialize so the
      paste path can build a source→new id map. (`addElement` overrides the
      incoming id anyway, so keeping it is harmless.)
- [x] Add a pure, testable helper `pasteElements(store, slideId, sources,
      dx, dy)` that: (1) inserts each source offset by (dx,dy), recording
      `sourceId → newId`; (2) for every pasted connector, remaps each
      `attached` endpoint whose `elementId` is in the map to the new id via
      `updateConnectorEndpoint` (which recomputes the frame). Endpoints
      pointing outside the pasted set are left untouched.
- [x] Wire Cmd+V and Cmd+D in `keyboard.ts` through the helper.
- [x] Tests: serializer preserves id; helper remaps endpoints to the new
      shapes; endpoints outside the set are preserved.

## Known limitations / non-goals

- Pasting a **group** still duplicates nested child ids verbatim
  (pre-existing `addElement` behavior); connectors attached to a
  group-nested child are not remapped. Out of scope here.

## Review

- Implemented `pasteElements` helper; wired Cmd+V and Cmd+D in `keyboard.ts`
  through it; clipboard serializer now preserves `id`.
- Verification (isolated worktree, fresh from `origin/main`):
  - `pnpm slides typecheck` — clean.
  - `pnpm slides test` — 261 files, 1816 passed / 2 skipped.
  - New `paste.test.ts` covers: endpoints remap to pasted shapes; endpoints
    outside the paste set are preserved; non-connector frames offset.
- Note: a concurrent session was sharing the primary checkout and reverting
  tracked-file edits; work was moved into `.claude/worktrees/` to isolate it,
  then redone in the `wafflesheets` clean clone (rebased onto `main` #374).

### Code review (high effort, self) — findings + resolution

1. **Free-endpoint connectors weren't offset on paste/duplicate.** A
   connector's frame is recomputed from its endpoints on insert, so the
   `frame` offset was discarded for connectors — a standalone line/arrow's
   copy landed exactly on the original (pre-existing behavior). **Fixed** in
   `pasteElements` by shifting `free` endpoints by `(dx, dy)`; covered by a
   test asserting `start`/`end` move.
2. **Remap pattern mirrors `MemSlidesStore.duplicateSlide`** (which already
   does element-id regeneration + connector-endpoint remap + frame recompute).
   Kept separate: the two operate via different mechanisms (store ops on a
   live slide vs. mutating a detached `clone()` before splice), so the only
   shareable part is the trivial endpoint rewrite. Not worth a shared helper.
3. Group-nested child remap remains a documented non-goal (see above).
