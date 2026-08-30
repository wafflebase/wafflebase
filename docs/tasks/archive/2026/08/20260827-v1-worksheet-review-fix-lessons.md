# Lessons — v1 worksheet API review fixes (#974)

## A bot review is a list of leads, not a list of defects

Seven actionable comments and two nitpicks. Verified against the actual code:
four were real, two were real but the stated impact was wrong, two were
style calls dressed as defects, and the single worst bug in the PR was raised
by nobody. Acting on the list as written would have produced three wrong
changes and left the 500 in place.

## The fix a review proposes can be wrong even when the defect is real

The `readCharts` comment correctly spotted that a shallow spread leaves a
nested array attached to Yorkie, and then told us to fix it with
`detachYorkieValue`. That helper branches on `Array.isArray(value)`, which is
**false** for a Yorkie array proxy — its target is a `CRDTArray`. Applying the
suggestion would have swapped a 500 for silently-wrong data
(`{createdAt, movedAt}` where an array belonged) and closed the thread.

The right helper was `unwrapJson`, three lines away in the same file, already
used for exactly this in `slides-tree.ts` with a comment saying why.

**Rule:** when a review names a helper, read that helper before using it.

## Following a review's "existing precedent" is how we found the worse bug

The comment justified its fix by pointing at the filter/pivot controller as
the sibling that already did it right. Reading that sibling showed it had the
same bug — `filter.hiddenRows` and all four pivot arrays were already being
served as CRDT metadata. The cited precedent was the second instance of the
defect, not the cure.

## A test that cannot fail is not coverage

Every spec in this PR built its root with `createSpreadsheetDocument()`, a
plain JS object. The bug only exists on a Yorkie **proxy**, so no possible
assertion in those specs could have caught it. The regression tests now build
a real `new yorkie.Document()` and seed it through `doc.update` — no server
needed, `doc.update` alone produces the proxy.

Same shape elsewhere: `parseFilter`'s test was a `toMatchObject` over four
bounds, so a dropped fifth field was invisible. `toEqual` over the whole
object is what makes an omission fail.

## Defensive readers are how a data bug ships quietly

`hiddenRows` was dropped by the parser, and *both* readers defended
independently — `[...(state.hiddenRows || [])]` on the frontend,
`coerceIndexedArray(...) ?? []` on the backend. No crash, no log, no stack
trace. The filter just silently does nothing. Defensive coding at the edges
converts a loud failure into a quiet wrong answer; it is not a substitute for
validating at the boundary.

The structural fix was deleting the blanket `as WorksheetFilterState` cast.
A checked object literal turns the next dropped field into a compile error.

## "Omitted" and "null" are different requests

Three parsers treated `undefined` like `null`, and the controllers' `null`
branch deletes the stored field. So a typo'd key, or a body-less `PUT` that
Express hands Nest as `{}`, wiped state and returned 200. Every other parser
in the same PR already rejected a missing key — the contract existed, two
parsers just didn't implement it.

## Measure the cap you are choosing, don't reason it

The first blocking-time estimate for `clear-range` (~48M cells/sec) was
measured against a worksheet whose `rowOrder` was empty, so `getWorksheetCell`
returned early and the benchmark timed the wrong thing. Re-measured against a
populated worksheet it is ~1e6 cells per 0.5s — about 24× slower, which is
what actually justifies the 1,000,000-cell limit.

Also worth checking the number in the report against the repo: `A1:XFD1048576`
is Excel's grid, not wafflebase's (`MaxRows` is 1,000,000), so it is rejected
by the bounds check and proves nothing about the *area* cap. The over-area
test needed an in-grid range.

## Findings worth recording as "not taken"

Two of the nine were declined, and the reason in both cases was that the
review anchored on a fraction of the real surface: 3 of 15 identical GET
handlers, and 3 of 8 files with the duplicated guard. Fixing only what was
cited would have made the PR *less* internally consistent than leaving it.
Both are written up in the todo file so the next reader does not re-open them.

## Backend lint is enforced by nothing

`packages/backend` enables `prettier/prettier` through
`eslint-plugin-prettier/recommended`, but no CI lane runs `pnpm backend lint`
— `verify-self` runs `lint:arch`, a separate config without the rule. 16 of
this PR's 25 files failed `prettier --check` with CI fully green, and `main`
carries ~50 already-failing files. Adding the gate means clearing those first.
