# Docs Collaboration — Concurrent Convergence Bugs

Split out from `20260517-docs-comments-followup-todo.md`. These are
**docs editing-engine (Tree CRDT) convergence bugs**, not comments work —
the comments integration lane only surfaced them. Tracking them under a
dedicated docs-collaboration task so the comments follow-up can close.

## Context

The frontend integration lane now runs in CI (wired by the comments
follow-up branch). Five subtests in
`packages/frontend/tests/app/docs/yorkie-doc-store-concurrent.integration.ts`
are `{ skip: KNOWN_BUG }` so the lane stays green while the failures stay
documented and discoverable. Remove each skip as its fix lands.

These tie into the intent-preserving-edits Tree migration (PR #152–#156).
See `docs/design/docs/docs-intent-preserving-edits.md` and
`docs/design/docs/docs-collaboration.md`. Deep CRDT work — a focused
branch + manual QA, likely multi-day; not a tack-on.

Run the lane locally:

```bash
docker compose up -d   # PostgreSQL + Yorkie
RUN_DB_INTEGRATION_TESTS=true RUN_YORKIE_INTEGRATION_TESTS=true \
  YORKIE_RPC_ADDR=http://localhost:8080 \
  pnpm --filter @wafflebase/frontend test:integration
```

## Split / merge convergence (3 subtests)

- [ ] **Two users splitting the same paragraph should converge.**
  `ABCDEFGH` → `ABGHCDEFGH` (text duplication). Test at
  `yorkie-doc-store-concurrent.integration.ts:78`.
- [ ] **Concurrent merge + text insert should converge.** The insert is
  lost. Test at line 108.
- [ ] **Concurrent split + text delete should converge.** The delete is
  lost. Test at line 173.

## Table-cell convergence (2 subtests)

- [ ] **Concurrent `applyCellSpan` removal + `applyCellStyle` should both
  be preserved.** Test at line 750.
- [ ] **Concurrent `updateTableAttrs` (rowHeights) + `applyCellStyle`
  should both be preserved.** Test at line 846.

## Closeout

- [ ] Each fix removes its `{ skip: KNOWN_BUG }` and lands with the
  scenario passing non-flaky across repeated runs.
- [ ] When all five pass, drop the `KNOWN_BUG` constant and its comment
  block from the test file.
- [ ] Update `docs/design/docs/docs-collaboration.md` /
  `docs-intent-preserving-edits.md` with whatever Tree-edit semantics the
  fixes establish.
