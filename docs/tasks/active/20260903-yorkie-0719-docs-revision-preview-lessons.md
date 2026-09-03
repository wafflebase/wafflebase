# Lessons — Yorkie 0.7.19 + docs revision preview

## Verify the upstream fix before building on it, and verify it the same
## way the bug was found

The premise of this task was "0.7.19 is out, so docs preview is unblocked."
That premise was worth ten minutes of measurement rather than assumption:
installing both versions side by side and running the exact failure table
from `docs/design/revision-history.md` §4 against each. It confirmed the
fix *and* produced the before/after table that now lives in the design doc.
Reading the SDK's new source (`skipString` / `findMatchingParen` /
`splitTopLevelArgs`) then confirmed it was the string-aware scanner the
upstream ask had asked for, not a deeper regex — which is what makes it
safe to delete the contingency plan instead of leaving it hanging.

## "It parses now" was not the same as "it works now"

The interesting bug was one layer past the one that was fixed. With the
parser working, the obvious move is to reuse the backend's existing
`treeNodeToBlock`. That would have compiled, run, thrown nothing, and
rendered a document whose every block was a style-less `paragraph` with no
tables — because a `YSON.parse`d tree node and a live Yorkie proxy node
disagree twice:

- the attribute key is `attrs`, not `attributes`, and
- the values stay JSON-encoded (`"align": "\"center\""`); only the live
  path runs `JSON.parse` over them (`parseObjectValues`).

Both are silent. Neither is visible in a type signature, because both
shapes are structurally `{type, children, ...}`. This is the same class of
failure the design doc already recorded twice (the `Int(320)` wrapper that
painted a blank slide; the missing `slides` key that painted a blank
canvas) — a *missing or mistyped key rendering as plausible emptiness*
rather than an error. It is apparently the characteristic bug of this
subsystem, and worth looking for by default whenever a snapshot is read.

**Rule:** when converting between two representations of the same data,
diff the two representations against a real sample before writing the
converter — do not infer the shape from the type that names it.

## The captured fixture earned its keep immediately

`snapshot-adapters.test.ts` already carried a comment saying every fixture
must be captured from a real server, because hand-authored ones had once
passed against a parser that was corrupting every integer. Following that
rule here is what surfaced the `attrs` / JSON-encoding difference at all: a
hand-written fixture would have used whatever shape I believed was right,
and the tests would have agreed with the bug.

Capturing it through the *production writer* (`writeDocsRoot`) rather than
hand-building a `Tree` was the second half of that — it means the fixture
is byte-for-byte what the app stores, including the encoding quirk.

## Mutation-test the assertions that guard a silent failure

Because both traps fail silently, a passing test is weak evidence on its
own — it could pass for the wrong reason. Breaking the normalizer two ways
on purpose (skip the JSON decode; read `attributes` instead of `attrs`) and
confirming 5 tests failed each time is what makes "23 passed" mean
something. Cheap, and worth doing whenever the bug being prevented would
not announce itself.

## Trust the tripwire the previous author left

The old test suite asserted docs snapshots **could not** be parsed, with a
comment saying it existed to fail loudly when that changed. It did exactly
that. Replacing it with its inverse (plus the note bracket case) keeps the
tripwire pointed at the next regression rather than deleting the idea.

## Local gotchas

- The pre-commit hook runs the whole of `pnpm verify:fast` (~4 min). Budget
  for it; a 2-minute command timeout kills the commit mid-hook.
- `@wafflebase/docs` has two entry points, and **the backend resolves
  `src/node.ts`**, not `src/index.ts` (tsconfig `paths`). A new export added
  only to `index.ts` is invisible to the backend with a confusing "has no
  exported member" error. Frontend consumers resolve `dist/`, so the
  package needs a rebuild after new exports either way.
- `docker compose` in this directory resolves to `waffleslides-*`
  containers, but the ones actually published on :5432/:8080 — and holding
  the real data — are `wafflebase-*`. Query those directly by name.

## Left unfinished

The browser smoke could not be completed: the local app has no session and
signing in goes through GitHub OAuth, which the agent must not do. Every
layer below the canvas mount is verified (parser measured against a live
server, converter tested against a captured snapshot with mutation-checked
assertions, `verify:fast` green), but the rendered docs preview has not
been seen with human eyes. That is the one claim not yet backed by
evidence — see the todo file's Review section.
