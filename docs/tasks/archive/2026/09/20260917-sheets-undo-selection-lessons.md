# Sheets undo/redo selection — lessons

## Read the operations, not the state

The bug was not a missing feature. `Sheet.undo()` already restored the
selection; the store simply never gave it a range, because
`computeAffectedRange` compared **cell key sets**. Its own comment claimed
"added, removed, or modified" while the code could only see added and
removed, and the gap had been invisible for exactly as long.

The fix is smaller than the diff makes it look: an undo already knows what
it changed — it is replaying a list of operations. Yorkie publishes them
synchronously as a `local-change`, with paths precise enough to name the tab,
the field and the cell. Every property the state diff could not recover
(a value overwritten in place, a style, a column width, another tab) falls
out of it for free, and it costs the step rather than the grid.

**Rule:** before diffing state to work out what an operation did, check
whether the operation itself is available. A CRDT's change log usually is.

## Verify assumptions about a dependency by running it

Three beliefs about `@yorkie-js/sdk` shaped the design, and all three needed
a five-line probe against the installed version rather than reasoning:

- `pushUndo` fires on `reverseOps.length`, which *includes* reverse presence
  — so it looked like every cursor move would pollute the undo stack.
  It does not: presence only records a reverse op under
  `{ addToHistory: true }`, which `p.set()` does not pass. Reading one more
  level down changed the design back.
- Cell keys are `rowId|colId`, not `rowId:colId`. A probe with an invented
  key shape produced a plausible-looking path that would never have matched
  a real one. The tests caught it only because they exercised
  `parseWorksheetCellKey` rather than re-implementing it.
- Operation paths for a *nested* field write differ from a whole-value one
  (`$.…cells.r3|c1` + key `v` vs `$.…cells` + key `r3|c1`). Both had to be
  handled, and only a probe showed the second form exists.

## An axis operation does not mean a structural edit

The first implementation selected row headers whenever `rowOrder` changed.
That broke the *most common* case: writing a cell into untouched space grows
`rowOrder`/`colOrder` to reach it in the same change, so an ordinary cell
write carries an axis operation too, and undo selected the rows the write
had extended instead of the cell.

They are distinguishable by *where* the arrays differ — an insert or delete
disturbs the middle, extent growth only appends — so `diffAxisSpan` answers
`undefined` for a tail-only diff. Worth stating because the same confusion
is available to the next person: in the axis-id model, "the axis changed" is
a much weaker statement than "the user inserted a row".

## Write the scaling hazards down before review finds them

Two were in the first draft, both from code that reads fine at small n:

- `resolveCellKey` used `rowOrder.indexOf()`, once per cell operation —
  quadratic on a bulk paste undo. Replaced with a per-snapshot lookup map.
- `ops.push(...event.value.operations)` and `Math.min(...rows)` spread
  unbounded collections into argument lists, which overflows the stack
  somewhere around 100k entries. Both are reachable: a bulk import undo, and
  "resize every row".

Neither would fail a test. The check that catches them is asking, of every
loop and every spread, what the largest realistic input is.

## The dev server you started may not be the one you are looking at

The manual smoke first appeared to show the fix **not working** — the undo
restored the value but left the selection behind, exactly the old behavior.
The page was being served from a *different checkout* of the same project
(`waffledocs`) that already held port 5173; `pnpm dev` had quietly fallen
through to 5177 and said so only in its log.

`performance.getEntriesByType("resource")` named the real path and settled it
in one call. Since the backend's CORS allowlist is a single `FRONTEND_URL`,
the fix was to restart the backend with `FRONTEND_URL` matching a pinned
frontend port rather than to take 5173 from the other checkout.

**Rule:** when a smoke test contradicts a green test suite, confirm *which
source* the browser loaded before doubting the code.

## Minting a dev session

For a smoke that needs a signed-in user, GitHub's consent screen is not
automatable — but the repo already solves this, and the solution should be
reused rather than re-derived: `packages/backend/src/template/seed/register-templates.ts`
mints the same session cookie the OAuth callback writes, against the local
deployment's own configuration. Read it before improvising.

Two things cost time on the way there and are worth knowing:
`JwtStrategy.validate` refuses any token whose payload is not
`tokenType: 'access'` with "Invalid token type", which reads exactly like a
wrong secret; and `sessionCookieName()` prefixes `__Host-` whenever the
deployment's cookies are secure, so the name is not a constant.

This is a local-development technique against your own machine's
configuration. It is not a way into anybody else's deployment, and nothing
here discloses a secret.

Routes: `/s/:id` is the sheet editor, `/d/:id` is docs. Opening a sheet
document under `/d/` renders the docs editor against it and hangs on
"Loading…" rather than erroring.
