# Lessons — Sheets cell link spans

## A regex that runs in the render loop is a performance contract, not a detail

`detectLinks` runs per line, per visible cell, per frame. The first version
used one alternation whose address branch began `[A-Za-z0-9._%+-]+@`, which
backtracks quadratically on a long run of those characters — 32 k characters
took ~2.1 s per pass. Every unit test passed, because every fixture was a
realistic sentence and realistic sentences contain spaces.

The trap was believing the cheap pre-check bought safety. `includes('@') ||
includes('://')` rejects ordinary cells, but the pathological inputs are
exactly the ones that satisfy it. A guard that filters the common case tells
you nothing about the worst case.

**Rule:** when a pure function is called from a paint loop, one of its tests
must be an adversarial input with a wall-clock bound. Not a benchmark — an
assertion, so the next person who reaches for a tidy pattern fails the suite
instead of shipping a frozen grid. Prefer an index scan over a pattern whenever
the input is attacker-controlled and the call site is hot; bound every
outward expansion by something principled (RFC 5321's 64-character local part)
rather than leaving it open.

## "Derive the hit target from the paint" is only true if you know the whole clip

The design's good idea was recording hit boxes while painting, so geometry
could not drift from pixels. It was implemented as "intersect with the cell
rect" — and that is not what bounds the pixels. `render()` draws four
separately clipped quadrants when a freeze is set, and when none is set it
paints the headers *over* the cells with no clip at all.

So the invariant the code's own comment asserted ("would leave a link clickable
where nothing is on screen") was violated by the code under the comment. In
read-only mode that meant a plain click on a frozen cell could open a URL
belonging to a cell scrolled out of sight behind it.

**Rule:** when deriving interaction geometry from a render pass, enumerate
every `ctx.clip()` and every later overpaint between the draw call and the
screen — not just the innermost one. If a region is enforced by clipping in one
branch and by draw order in another, record it explicitly in both, because the
branch that relies on draw order leaves no clip for you to find.

## Delegated exploration is evidence, not testimony

A subagent reported "there is no test anywhere that exercises `worksheet.ts`
mouse handling." There was: `packages/sheets/test/view/worksheet-mouse.test.ts`.
It had looked in `src/view/__tests__/` and generalised. The claim was believed
and the branch broke that suite twice — once per new method called from a
handler the test drives with a hand-built `this`.

**Rule:** treat a subagent's *negative* claim ("X does not exist") as a lead,
not a finding — it is the shape of answer a bounded search gets wrong most
easily. Confirm absence with a search whose root is the package, not the
directory the agent happened to look in. See `[[feedback_no_record_needs_full_read]]`.

## Verify against the server you actually started

Two dev servers and two checkouts were live on this machine. Port 5173 belonged
to a *different* checkout, so the first "the feature does not work in the app"
observation was a reading of someone else's code — `performance.getEntriesByType`
showed the modules being served from `…/waffledocs/packages/sheets/src/`. The
real server had been pushed to 5176, and CORS (pinned to `FRONTEND_URL`) then
made it look like an auth failure.

**Rule:** before concluding anything from a running app, confirm which process
is answering — the dev server's own log line for the port it bound, and, in the
browser, the resource URLs the page actually loaded. A port number is an
assumption.

## Related

- `[[project_slides_typecheck_gate_gap]]` — the same class of stale-artifact
  confusion; here it was a stale `@wafflebase/docs` dist blocking the backend
  and a Prisma client behind a migration.
- `[[feedback_verify_review_findings]]` — every finding in the review pass was
  checked against the code; the ReDoS claim was reproduced independently before
  being acted on, and one expectation the review implied (that the glued
  `a.b@c.dhttps://…` link should still be found) was rejected in favour of
  matching the existing glued-left rule.
