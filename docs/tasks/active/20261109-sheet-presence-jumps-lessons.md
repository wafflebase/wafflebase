# Sheet Presence Jumps — Lessons

## Diagnosis

- The fastest signal came from the live document, not from screenshots:
  finding the Yorkie `Document` through the React fiber tree, subscribing to
  `presence`, and resolving each peer's presence exactly as `overlay.ts`
  does every 50 ms turned "the cursors wobble" into a log of concrete
  transitions (`A5 → A1`, `HIDDEN(anchor-miss)` after a tab switch).
- Lining up two clocks by interval rather than absolute time was enough to
  tie a row delete to an A1 jump: two deletes 6,565 ms apart, two jumps
  6,543 ms apart.
- Reproducing in a fresh sheet needed axis coverage in mind: a cell past
  `rowOrder` / `colOrder` publishes no anchor, so it neither snaps on delete
  nor goes stale on a tab switch. The first attempt at each case picked such
  a cell and looked like a non-repro.

## Out of scope

- Some clients delivered presence in ~1 s bursts. The receiver pulled
  promptly and the server batches at 100 ms, so it is sender-side; the SDK's
  sync loop is a `setTimeout(…, 50)` chain, which a throttled tab runs at
  1 Hz. Not reproduced: the browser automation keeps its tabs visible.

## Self review

- Round 1 (correctness/tests, separate reviewer): no blocking findings.
  Took the doc wording fix and a past-coverage test (deleting the last
  covered row publishes no anchor). Left as known limitations: the kept
  position can sit on a filter-hidden row; `selectionType` stays `row` /
  `column` after the selected row is deleted (pre-existing); a cross-tab
  jump now briefly announces A1 before its target. Stopped after one round:
  the diff is two small hunks and the round found nothing blocking.

## Review panel

- Blast-radius lens, 1 major: publishing presence inside
  `Spreadsheet.initialize` landed *before* the host's `cancelled` guard, so a
  mount torn down mid-initialize still wrote `selection` / `activeCell` for
  the tab the user had just left — the same stale-presence bug this task set
  out to fix, only in the other direction. The lesson is that an `await` in
  an engine method splits the host's lifecycle in two: anything with an
  outside effect has to run on the host's side of that split, where the
  cancellation is known. Publishing is now a public
  `Spreadsheet.publishSelection()` the host calls after its guard.
- Test-adequacy lens, 1 major: moving the call to the host moved the
  behavior out from under the engine's unit test, and the frontend's engine
  double auto-stubs unknown methods — so a `publishSelection()` that was
  never called could not fail anything. The ordering that motivated the move
  is a *host* guarantee and needed a host test:
  `sheet-view-mount-presence.test.tsx` mounts `SheetView` against a deferred
  `initialize`, asserting the announcement on a surviving mount and silence
  (plus `cleanup()`) on one unmounted while `initialize` was in flight. Both
  cases were checked against a mutated `sheet-view.tsx` — call removed, and
  call moved above the guard — so neither passes vacuously.
