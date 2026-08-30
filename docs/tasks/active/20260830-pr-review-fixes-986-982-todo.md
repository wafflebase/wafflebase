# Resolve review-panel findings on PR #986 and #982

Two open PRs carry blocking findings from the agent review panel (and one
CodeRabbit inline comment). This task takes both to a state where the
blocking list is empty.

## Context

- **#986** `feat/v1-row-col-structure` (ggyuchive, upstream branch) — moves the
  worksheet axis/structure helpers into `@wafflebase/sheets` and adds v1
  `POST insert / delete / move` on a tab. Panel: **9 blocking**, 10 suggestions,
  6 nits. CodeRabbit: reject `index + count - 1 > axisLimit`.
- **#982** `fix/docs-image-copy` (shjohw12, fork, `maintainerCanModify: true`) —
  three commits: image copy, selection-tint rounding, stale image selection.
  Panel: **7 blocking**.

**#982 is largely superseded.** `main` already carries #984
(`739a4703c`, "Copy table-cell content and click-selected images with
formatting"), which fixes the same issue (#870) through
`TextEditor.imageSelectionProvider` / `imageDeleteHandler`. Commits 1 and 3 of
#982 are redundant with it. The **tint rounding fix** (`3b9f6fecd`) is *not* on
main — `doc-canvas.ts` still rounds the box before the overlap test — so that
commit is the only surviving value. Decision (confirmed with the author of this
task): rebase #982 onto main keeping the tint commit alone.

## PR #982 — tint only

- [x] Branch from `origin/main`, cherry-pick `3b9f6fecd` only
- [x] **[blocking]** Tint regression is never exercised through `DocCanvas` —
      the test re-implements the render loop, so restoring `Math.round` at the
      real call site fails nothing. Drive `DocCanvas.render` with a recording ctx
      (pattern: `test/view/image-selection-overlay.test.ts`) and assert the
      tint `fillRect`
- [x] **[blocking → carried]** `table-renderer.ts:439` still holds the rounded
      copy of the same intersection, so cell images keep the half-pixel
      over-tint. Route it through `imageIntersectsSelection`
- [x] **[suggestion]** Test box drops `pageY`, so the vertical half of the
      intersection assertion is vacuous
- [x] Rewrite the PR title/body: it is now a rendering fix, not an image-copy fix
- [x] Drop the 5 blocking findings that only applied to the superseded commits
      (readOnly gate, `selectImageAt` guard, table-cell carve-out, header/footer,
      sibling `getBlock`) — all belong to code #984 replaced. Reply on the thread
      saying so.

## PR #986 — nine blocking

- [x] **[critical ×2]** `index`/`count` bounded only by the axis length (1e6):
      one request builds a million-entry axis array inside `doc.update` —
      event-loop stall, `splice` spread RangeError, and a non-terminating
      `createWorksheetAxisId` retry once the 36^4 id space is exhausted.
      Needs a *work* bound like `MaxClearedCells`, not a grid bound
- [x] **[major]** Nothing caps the resulting `rowOrder`/`colOrder` length, so
      repeated inserts grow the axis arrays past the grid bound
- [x] **[major + CodeRabbit]** `index + count - 1` may exceed `axisLimit(axis)`
      in both `parseAxisShift` and `parseAxisMove`; add boundary tests
- [x] **[major]** Move endpoint skips `Sheet.moveCells`' merge-split guard, so an
      API move half-crossing a merged block silently drops the merge
- [x] **[major ×2]** `applyWorksheetShift`/`applyWorksheetMove` are called alone;
      the editor complements them with `shiftFilterState`, `shiftUserHiddenState`
      and the freeze-pane remap. `ws.filter`, `hiddenRows`/`hiddenColumns`,
      `frozenRows`/`frozenCols` are left pointing at pre-shift indices
- [x] **[major]** Cached formula values (`v`) are never recalculated, so
      `GET /cells` serves stale values after a structural edit
- [x] **[major]** Unvalidated `tabId` used directly as a property key
      (`root.sheets?.[tabId]`) — `__proto__`/`constructor` pollution vector, and
      the new handlers are the first to *write* through that lookup
- [x] **[minor, cheap]** No guard against structural edits on a pivot-output or
      non-sheet tab
- [x] **[minor]** Record the three new endpoints in `docs/design/rest-api.md`
- [x] **[nit]** `docs/design/sheets/comments.md` and `data-validation.md` still
      cite the pre-move frontend module path
- [x] **[nit]** Delete endpoint echoes a negative `count`
- [x] Tests: parser upper bounds, unknown-`tabId` 404, `normalizeStoredCell`
      direct coverage, cross-tab chart/pivot range pass

## Verification

- [x] `pnpm verify:fast` green on each branch before pushing
- [x] Push both (approved): #986 to the upstream branch, #982 force-push to the
      fork's `fix/docs-image-copy`

## Review

### #982 — done

Rebased onto `main` (`51243ec43`) carrying `3b9f6fecd` alone; force-pushed to
`shjohw12:fix/docs-image-copy`; title and body rewritten; the finding
disposition posted as a PR comment.

Two blocking findings fixed, five retired with the code they were about.
`imageIntersectsSelection` moved from `doc-canvas.ts` to
`image-selection-overlay.ts` so `table-renderer.ts` — which paints cell content
itself and carried a second rounded copy of the same comparison — can share it
without the import cycle `doc-canvas → table-renderer → doc-canvas`.

The test rewrite is the substantive part. It now drives `DocCanvas.render` and
`renderTableContent` against a recording 2D context instead of re-deriving
their loops. Both halves were confirmed to fail with their own rounding
restored (body: images 3 and 4 of 4 — the reported "from roughly the third
image onwards"; cell: 2 and 3 of 4) and to pass with it removed.

### #986 — done

All 9 blocking findings addressed, plus the 2 cheap minors, 2 nits and the
CodeRabbit inline comment. The three parallel investigation agents each
verified their cluster against the code before anything was written; two of
their findings were corrections worth keeping:

- The `__proto__` prototype-pollution claim is **refuted** through a Yorkie
  proxy — the get trap reads a real `Map` and answers `undefined`. But
  `toString` / `toJSON` / `toJS` / `toJSForTest` / `getID` are answered with a
  *function*, which is truthy, so `.../tabs/toString/insert` walked past the
  guard and reached the engine (a 500, not a 404). `Object.hasOwn` and `in`
  are both unusable on that proxy; `Object.keys` membership is the fix, and it
  is correct on the plain-object fixture too, where `__proto__` really is
  truthy.
- The stale `hiddenRows` half of the filter/hidden/freeze finding is a
  **pre-existing engine gap**, not a regression this PR introduced:
  `Sheet.shiftUserHiddenState` mutates only the in-memory set and never calls
  `persistHiddenState`. Lifting the remap into the engine helper fixes both
  callers at once, which is why that was chosen over re-implementing it in the
  controller.

The bound is two-part, because one part cannot do the job. `index + count - 1`
against the grid is a shape check; the bound that caps *work* is
`assertAxisGrowth`, applied in the controller where the axis's current length
is visible — `{index: 1000000, count: 1}` passes every span check and still
materializes 999,999 CRDT entries. Measured by the investigating agent against
a real `yorkie.Document`: 10,000 entries ~80ms, 50,000 ~1.3s, 200,000 ~17.6s,
and ~100,000 spread into `order.splice` throws `RangeError`. The controller
test for it is fast only because the assert precedes every mutation; without
the fix it does not fail, it hangs the suite for minutes.

Backend recalculation was considered and rejected on three independent
grounds (`calculate` unexported, `Sheet`/`Store` unreachable from the backend,
and `async` inside a synchronous `doc.update`). Clearing the cached `v` is the
honest alternative: `null` beats a number that no longer matches the formula
beside it. Documented in `rest-api.md` §5.4 and in the controller doc comment,
which previously claimed unqualified parity with the editor.

### Known limitations, not fixed here

- Cross-tab **formula text** is not rewritten by either caller — `=Sheet1!A5`
  on tab-2 is not repointed when tab-1's row 5 is deleted. Pre-existing, shared
  by the editor, now recorded in `collaboration.md`.
- The same truthiness tab-lookup exists in eight other v1 controllers. PR #974
  already deferred that consolidation with a task doc; widening this PR into it
  would bury the change under an unrelated sweep.
- The in-editor `insertWorksheetAxis` / `moveWorksheetAxis` callers remain
  unbounded. Only the REST entry point is capped, because only there does the
  coordinate arrive from an untrusted body.
