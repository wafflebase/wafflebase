# Docs Comments — Follow-up Work

Spun off from `20260516-docs-comments-todo.md` (PR #248). The main PR
ships docs comments end-to-end behind real users; this file tracks the
items the original task explicitly deferred so they keep showing in
`tasks/active/`.

## Live multi-user integration tests

`packages/frontend/tests/app/docs/comments/yorkie-comment-store-concurrent.integration.ts`
exists and is sound. Running it under `pnpm verify:integration` (or
the equivalent direct `tsx --test` call) currently fails at module
load with `applyDeleteText` missing from `@wafflebase/docs`'s
`dist/node.js` export. All `.integration.ts` files in this repo share
the gate.

- [ ] Reconcile the `@wafflebase/docs` node-entry build so the SDK
  helpers `YorkieDocStore` imports (`applyDeleteText`, friends) are
  re-exported from `dist/node.js`, OR adjust the test runner to use
  the browser bundle.
- [ ] Run the concurrent integration tests under
  `docker compose up -d` + `YORKIE_RPC_ADDR=...` and confirm all four
  scenarios (concurrent add / reply / resolve, undo-restores-orphan)
  pass.

## Visual harness scenarios

The original Task 8 was a Playwright visual harness for the docs
comments UI. The repo has no docs-comments visual route yet (visual
harness scaffolding under `packages/frontend/src/app/harness/visual/`
is sheets-focused), so standing one up cleanly was out of scope for
PR #248.

- [ ] Add a `harness/docs-comments` route mounting a minimal docs
  editor with a seeded thread + side panel.
- [ ] Range selection + `Cmd+Alt+M` opens composer focused at input.
- [ ] Highlight renders across a line wrap (per-line rects).
- [ ] Highlight click → popover positioned correctly; flips near
  viewport edge.
- [ ] Two overlapping threads → popover lists both.
- [ ] Side panel tab counts update on resolve / reopen.
- [ ] "Orphaned" sub-section renders quotedText; jump-to disabled.
- [ ] Side panel thread click → scroll + caret + flash highlight.
- [ ] Read-only mode: composer hidden, resolve/edit/delete hidden.
- [ ] `pnpm verify:browser:docker` green.

## Smaller polish from PR #248 review

These items were noted in code review but deferred to keep the
landing PR scoped.

- [ ] Right-click "Insert comment" menu inside table cells
  (currently suppressed because the table context menu has priority;
  table menu has no comment item).
- [ ] Replace `as unknown as SharedThread<SheetCellAnchor>` casts in
  `app/spreadsheet/components/comments/CommentPopover.tsx` and
  `app/documents/document-detail.tsx` by re-exporting `Thread<A>`
  from `@wafflebase/sheets` (or migrating sheets fully to the shared
  type).
- [ ] Re-resolve `pendingRangeRef` paths just before `addThread`
  fires, so a stale-after-remote-delete compose surfaces a graceful
  toast instead of a Yorkie SDK error.
- [ ] Promise rejection handling on the Resolve / Reply icon buttons
  (currently `void onResolveToggle()` — fire-and-forget). Add a
  pending state + error toast once the failure paths are exercised
  end-to-end.

## Roadmap continuation

Out-of-scope items remain (see PR #248 design doc §8):

- Step 3 — slides comments (third consumer of the shared module).
- Step 4 — `@user` mentions + notifications across all consumers.
