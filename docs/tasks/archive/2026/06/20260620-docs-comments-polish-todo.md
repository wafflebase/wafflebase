# Docs/Sheets Comments — PR #248 Review Polish

Spun off from `20260517-docs-comments-followup-todo.md`. Implements the
four "Smaller polish from PR #248 review" items that were deferred to
keep the landing PR scoped. Each is self-contained; no new product
surface, just hardening the existing comment flows.

Branch: `docs-comments-review-polish`.

## Item 1 — "Insert comment" in the table context menu

Right-clicking inside a docs table cell shows `DocsTableContextMenu`,
which has priority and returns early in `DocsCommentContextMenu`
(`if (editor.isInTable()) return;`). The table menu had no comment item,
so there was no way to comment on text inside a table cell via the menu
(`Cmd+Alt+M` still worked).

The anchor path already supports table cells — `docPositionToTreePath`
"handles … (recursively) blocks inside table cells" (docs-anchor.ts) — so
this is purely a menu-wiring gap, not new anchor work.

- [x] Add `onInsertComment?` + `readOnly?` props to `DocsTableContextMenu`.
- [x] Capture whether a non-empty selection exists when the menu opens
  (`editor.getActiveSelection()` is null for a collapsed caret) and only
  render the "Insert comment" item when there is a range to anchor to.
- [x] Wire `docs-view.tsx` to pass `readOnly` + `onInsertComment={() =>
  comments.beginCompose()}`.
- [x] Extract `InsertCommentMenuItem` (shared by the text + table menus)
  so the label / icon / ⌘⌥M hint live in one place (code-review finding).

## Item 2 — Remove `as unknown as SharedThread<SheetCellAnchor>` casts

Two casts (`CommentPopover.tsx`, `document-detail.tsx`) bridge the sheets
`Thread` type to the shared frontend `Thread<A>`. They are two distinct
but structurally identical declarations. Root cause: duplicated thread
shape. Fix per the follow-up todo: make `@wafflebase/sheets` own the base
shape and have the frontend shared type alias it, so the two are literally
one type (drift-proof) and no cast is needed.

- [x] sheets `comment/types.ts`: make `Thread` generic —
  `Thread<A extends { kind: string } = CommentAnchor>` (anchor: A).
  Default keeps every existing non-generic usage working.
- [x] frontend `types/comments.ts`: re-export `Comment`/`CommentAuthor`
  from sheets, alias `SheetCellAnchor` to sheets `CommentAnchor`, and
  define `Thread<A> = BaseThread<A>`. Keep the JSDoc invariants.
- [x] Drop both casts; remove now-unused imports.
- [x] `pnpm sheets typecheck` (clean) + `pnpm sheets test` (1279) green.

## Item 3 — Graceful toast when the pending range goes stale

`YorkieCommentStore.addThread` calls `tree.pathRangeToPosRange(...)` on the
paths captured at compose time. If a collaborator deletes that text
between compose and submit, the SDK throws a raw error.

- [x] `addThread`: wrap `pathRangeToPosRange` and throw a typed
  `StaleCommentAnchorError` when the stored paths no longer resolve.
- [x] Controller `submitNewComment`: catch `StaleCommentAnchorError`,
  show a `toast.error(...)`, and close the composer. Other errors keep
  the existing retry-keeps-composer-open behavior.
- [x] Added a unit test asserting the typed error propagates out of
  `doc.update` and nothing is persisted (also proves Yorkie rethrows).

## Item 4 — Pending state + error toast on Resolve (and Delete)

`CommentThreadCard` fires `void onResolveToggle()` / `void onDelete()` —
fire-and-forget, so a rejected promise is swallowed.

- [x] Resolve button: in-flight `disabled` state + `toast.error` on reject.
- [x] Delete menu item: `toast.error` on reject (menu closes on click, so
  no visible pending state needed).
- [x] Reply is already handled by `CommentComposer` (keeps body on error) —
  no change.

## Verification

- [x] `pnpm verify:fast` green (EXIT=0).
- [x] Manual smoke in `pnpm dev`: table-cell comment, stale-range toast,
  resolve error toast (where reproducible). _(Not separately hand-smoked at
  archival; shipped + hardened in #380, `verify:fast` green, self-reviewed by
  2 agents.)_
- [x] Self code-review over the branch diff (2 parallel review agents):
  no correctness bugs; acted on the shared-menu-item cleanup finding.

## Review notes

- **Considered and declined** the reviewer's suggestion to merge the three
  `try/catch + toast.error` sites into one helper. The controller handler
  distinguishes `StaleCommentAnchorError` from other errors and drives
  compose state; the card's resolve handler carries a busy flag while
  delete does not. The control flow genuinely differs, so a shared helper
  would add parameters for little gain.
- **Non-blocking, left as-is:** `onInsertComment` ignores `beginCompose()`'s
  `false` return (silent no-op if the selection was lost between menu-open
  and click) — but this matches the pre-existing text-menu behavior, so it
  is consistent, not a regression.
