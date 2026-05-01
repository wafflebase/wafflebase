# Table split fragment + follow-up rows on same page

## Bug
When a table row is split across pages and the split fragment lands as the
first PageLine on the next page, subsequent non-split rows of the same table
on that same page are never rendered. Layout positions them correctly
(search highlights and selection work), but `renderTableContent` and
`renderTableBackgrounds` are never called for them.

Root cause is in `packages/docs/src/view/doc-canvas.ts`:

1. `computeTableRangeForPageLine` (lines 48-85) only sweeps forward for
   non-split fragments. So when the first PL is a split fragment, it
   produces `endRowIndex = pageStartRow + 1` (just the fragment row).
2. The dedup at `collectTableRenderRanges` (line 105-108) and the
   content-pass condition (line 482) skip subsequent PageLines that
   belong to the same block, assuming the first render covered them.

Combined: rows after the split fragment are silently dropped from
rendering.

## Fix (Option B)
Allow a *new* render pass when the previous PageLine on the page was a
split fragment of the same block. The non-split PL then runs its own
sweep and covers the remaining rows in a single call. Apply the same
condition symmetrically to both passes so backgrounds and content stay
in lockstep.

## Tasks
- [x] Apply Option B in `doc-canvas.ts` (both `collectTableRenderRanges`
  and the body loop)
- [x] Remove debug logs added during diagnosis
  (`table-renderer.ts`, `editor.ts`)
- [x] Add regression test in
  `packages/docs/test/view/table-row-split.test.ts`
- [x] Update `docs/design/docs/docs-table-row-splitting.md` with this
  case
- [x] Code review — extracted shared `shouldStartTableRender` predicate
  per reviewer suggestion to remove the duplicate dedup logic that
  could drift between the background and content passes
- [x] `pnpm --filter @wafflebase/docs test` — 623 tests pass including
  the new regression test
- [x] Live verification on the localhost shared doc — page 3 section
  "3. 지원동기 및 포부" / "4. 프로젝트 핵심 목표" renders

## Notes
- `pnpm verify:fast` reports two pre-existing frontend test failures
  (`merge-repro.test.ts`, `yorkie-doc-store.test.ts`) caused by a
  missing `applyInsertInline` export from `@wafflebase/docs`. Verified
  by stashing the fix and rerunning — both fail identically on a clean
  main, so they are unrelated to this work.

## References
- d91c60b3 introduced row splitting but missed this case
- Repro doc: `http://localhost:5173/shared/2ec0d5ec-8c46-4b75-a046-b903768b1aab`
  page 3 section "3. 지원동기 및 포부" / "4. 프로젝트 핵심 목표"
