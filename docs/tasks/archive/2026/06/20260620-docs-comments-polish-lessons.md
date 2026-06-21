# Docs/Sheets Comments Polish — Lessons

## Type duplication across packages is structural, not nominal

The `as unknown as SharedThread<SheetCellAnchor>` casts existed only
because sheets and the frontend each declared their own structurally
identical `Thread`. TypeScript is structural, so the casts were never
needed for safety — dropping them entirely already compiled (only
unused-import errors). The real fix is single-source-of-truth: the
lowest package (`@wafflebase/sheets`) owns the base shape, higher
packages alias it (`Thread<A> = BaseThread<A>`). To let the frontend
instantiate the generic with a docs-only anchor, the sheets constraint
has to be loosened to `A extends { kind: string }`, not `A extends
CommentAnchor` (sheets' own union) — otherwise `DocsRangeAnchor`
violates the bound.

## Frontend `tsc -b` is NOT a gate here

`verify:fast` runs `frontend lint` + `frontend test`, but only
`typecheck` for sheets/slides/cli/docs — not the frontend. `npx tsc -b`
on the frontend reports ~110 pre-existing baseline errors (yorkie SDK
`ProxyArray` typing, etc.). Don't treat that count as a regression
signal; instead diff the *specific files* you touched and confirm they
gain no new errors. Build the workspace dists first
(`pnpm --filter @wafflebase/{sheets,docs,slides} build`) or the count
balloons from stale dist types.

## Throwing inside Yorkie `doc.update` propagates and rolls back

`addThread` throws `StaleCommentAnchorError` inside the `doc.update`
callback (before any mutation). The added unit test confirms the error
rejects the `addThread` promise *and* leaves `root.comments` empty —
so the `instanceof` check in the controller is reachable and no partial
thread is persisted. Worth a test because "does update rethrow?" is not
obvious from the SDK types.

## Two context menus, one menu item

The docs text context menu and table context menu are mutually
exclusive (`isInTable()` gate), but both need the same "Insert comment"
row. Code review correctly flagged the hand-copied button as drift risk
(shortcut hint, label, icon in two places). Extracted
`InsertCommentMenuItem` as a thin presentational component — the two
menus pass their own (identical) class string and an `onSelect` that
wraps `beginCompose()` + `close()`.

## Declined cleanup: don't merge differently-shaped error handlers

The reviewer suggested one `runWithToast` helper for the three
`try/catch + toast.error` sites. Declined: the controller distinguishes
error types and drives compose state; the card's resolve handler has a
busy flag, delete does not. Forcing a shared helper adds parameters for
no real gain. Recorded the reasoning in the todo rather than complying
reflexively.
