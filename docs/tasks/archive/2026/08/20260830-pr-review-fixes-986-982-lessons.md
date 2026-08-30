# Lessons — resolving review-panel findings on #986 and #982

## Check whether the PR still has a job before fixing its findings

#982 arrived with 7 blocking findings. Five of them were about code that no
longer needed to exist: #984 had landed on `main` while the PR sat open and
fixed the same issue (#870) a different way. Fixing all seven would have
produced a careful, well-tested reimplementation of something already shipped.

The check that caught it cost one command — `git log <merge-base>..origin/main`
— and it belongs *before* reading the findings, not after. The right question
for an open PR is "what of this is still true?", and only then "what is
wrong with it?".

What survived was one commit out of three. Rebasing to keep only that, and
rewriting the PR title and body to match, is a smaller and more honest result
than answering every finding would have been.

## A bound on the coordinate is not a bound on the work

Both the review panel and CodeRabbit asked for `index + count - 1 <=
axisLimit`. That check is correct and worth having, and it does not close the
hole. `{index: 1000000, count: 1}` passes it and still materializes 999,999
CRDT entries, because `insertWorksheetAxis` back-fills the axis out to `index`
before minting anything.

The distinguishing question is **what does one unit of the request cost**, and
it is answerable only where the current state is visible — for a dense axis
array, in the controller, not the parser. The repo already had the pattern:
`parseClearRange`'s comment says "the grid bound alone does not help" and adds
`MaxClearedCells` on top. The new validator quoted that reasoning in its
docstring and then did not follow it, which is the failure mode to watch for —
a comment that describes the bound you meant to write.

## Verify the finding, not just the fix

Two of the three investigation agents came back with corrections, and both
mattered:

- The `__proto__` prototype-pollution claim is **refuted** through a Yorkie
  proxy — the get trap reads a real `Map` and answers `undefined`. Had the fix
  been written to the finding as stated, it would have guarded a key that was
  never dangerous and left `toString` / `toJSON` / `toJS` / `toJSForTest` /
  `getID` — which the trap answers with a truthy *function* — still walking
  straight through.
- The stale `hiddenRows` half of the filter/hidden/freeze finding is a
  pre-existing engine gap, not a regression the PR introduced. That changed
  where the fix belonged: into the shared engine helper, repairing both
  callers, rather than into the controller.

Both came from *running* the thing rather than reading it — the agent drove a
real offline `yorkie.Document` and tabulated what each key actually returned.

## Fix it where every caller gets it

`Sheet.shiftCells` did the filter/hidden/freeze remap itself, immediately
around `store.shiftCells`. That is invisible to any other caller, which is
precisely why the REST endpoint silently wrote corrupt state.

Re-implementing the remap in the controller was the cheap option and the wrong
one: two more engine exports, ~120 lines duplicated that must stay in lockstep
with `sheet.ts`, and the editor's own gap left open. Moving it into
`applyWorksheetShift` was safe only because a specific property held —
`setFilterState` / `setHiddenState` / `setFreezePane` are **absolute writes,
never read-modify-write** — so the editor writing the same value again after
the engine is a no-op. Check that property before deduplicating into a shared
path; without it, double application is a bug.

## Say "cannot" out loud instead of approximating

Backend recalculation of cached formula values is not reachable: `calculate` is
unexported, needs a live `Sheet` over a `Store`, and is `async` inside a
synchronous `doc.update`. Three independent blockers, any one sufficient.

The temptation is to half-do it. Clearing `v` so readers get `null` — plus one
paragraph in `rest-api.md` and the controller docstring saying why — is worth
more than a partial recalculation that is right most of the time. The
controller's class comment had claimed unqualified parity with the editor;
correcting that claim was part of the fix.

## Make the test fail before believing it

The #982 tint test verified the extracted helper plus a hand-copied duplicate
of the render loop. `imageIntersectsSelection` is an unconditional rectangle
test — it *cannot* express the defect, because the defect was in what the call
site passed it. The suite would have stayed green if `Math.round` came back.

Driving `DocCanvas.render` and `renderTableContent` through a recording 2D
context, then restoring each rounding and watching images 3 and 4 of 4 fail —
the exact reported symptom — is the only thing that made the test worth having.
Do that step; a test you have not seen fail is a test you have not written.

## Operational

- `.githooks/pre-commit` ends in `exec pnpm verify:fast`, so a commit takes
  2-4 minutes. A default 2-minute command timeout kills it mid-commit and
  leaves the change uncommitted. Give `git commit` a long explicit timeout.
- `pnpm verify:fast` failed with 4 CLI test failures about link sanitization
  on a branch that touched neither the CLI nor the link gate.
  `pnpm --filter @wafflebase/docs build` fixed all four — stale workspace
  `dist`. The tell is always the same: **failures in a package the diff never
  touched.**
- `verify:fast` does not run backend eslint. Lint changed backend files by
  hand before pushing.
- Yorkie array proxies do not deep-compare: `expect(rowOrder).toEqual([])`
  receives the string `"[]"`. Assert on `.length`, or spread first.
