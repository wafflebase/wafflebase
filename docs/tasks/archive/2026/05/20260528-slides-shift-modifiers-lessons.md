# Slides Shift Drag Modifiers — Lessons

Non-obvious gotchas surfaced while shipping
`docs/design/slides/slides-shift-modifiers.md`.

## 1. `pnpm verify:fast` needs `pnpm --filter @wafflebase/docs build` first

The slides typecheck resolves `@wafflebase/docs` against its built
`dist/`, not against the docs source. On a fresh checkout (or after
docs source has changed), the slides typecheck fails with
`Object literal may only specify known properties, and
'transformLayoutBlocks' does not exist in type 'TextBoxEditorOptions'`
even when nothing in the slides package was touched.

**Why:** This was already documented in the autofit task's lessons
(`20260525-slides-text-autofit-lessons.md`). It re-surfaced here on
the very first commit because the design+plan commit triggered the
pre-commit hook, which runs the full `verify:fast` lane.

**How to apply:** Before the first commit in any new slides-touching
session, run `pnpm --filter @wafflebase/docs build`. If a commit
fails with the `transformLayoutBlocks` error, rebuild docs and retry.
Never `--no-verify`.

## 2. Plan's "define constant now, use later" hit TS no-unused-vars

The plan instructed Task 1 to define `const ANGLE_STEP = Math.PI / 12`
in `constraints.ts` for future Task 2 to consume. TypeScript's
strict-mode unused-variable check rejected this — the constant had
no reader in Task 1.

**Why:** Wanting the module's "shape" to be right from commit 1 is a
nice-to-have; satisfying the linter on every commit is a hard
requirement.

**How to apply:** In future plans, defer constant/type/import
introductions until the commit that actually consumes them. The
implementer correctly removed `ANGLE_STEP` in Task 1 and the
spec-review/code-review loop accepted that judgment. Task 2 re-added
it alongside `snapEndpointAngle`.

## 3. `ShapeKind` literal mismatch in the plan

The plan's Task 4 integration test used `'rectangle'` as the
`buildInsertElement` shape kind. The actual `ShapeKind` union uses
`'rect'`. The plan explicitly told the implementer "match whatever
the codebase uses" and the implementer correctly adapted to `'rect'`
and `'ellipse'`.

**Why:** When writing plans without first reading the consumer's exact
type, leave the placeholder explicit so the implementer knows to
adapt.

**How to apply:** For unknown literals, write `<kind>` in the plan
body and add a note like "use whatever `insert.test.ts` already
uses." Avoid plausible-but-fake literals; they cause silent test
failures if the implementer doesn't double-check.

## 4. `shortcuts-catalog.ts` enforces its category union via a test

Adding a new `ShortcutCategory` literal (`'Drag'`) required updating
both the union type AND an allowed-categories assertion in
`shortcuts-catalog.test.ts` that hardcodes the set of accepted
categories. The plan only listed the source file.

**Why:** Defensive tests can pin enum unions; a single source change
isn't enough.

**How to apply:** When adding a literal to a `ShortcutCategory`-style
union, grep for the literal's neighbors (e.g.
`grep -rn "'Selection'\\|'Slide'" packages/slides/test`) to find any
catalogs/allowlists that need to be extended together. Add the test
edit to the plan up-front.

## 5. Reviewer subagents leave the working tree on `main` or detached HEAD

A code-quality reviewer subagent ran `git checkout` against a SHA or
branch to inspect a diff and then exited without restoring the
parent's working tree. The next implementer subagent (Task 7)
started its work and would have committed onto `main` if the
controller hadn't checked first.

**Why:** Subagents are stateless — they don't know which branch the
controller wants them to leave behind. Their default is "wherever I
ended up."

**How to apply:** In every implementer/reviewer prompt that involves
`git`, include an explicit "start with `git checkout <branch>`" line
AND a "stay on `<branch>` when you're done; do not check out main."
The controller should also `git checkout <branch>` (or at least `git
branch --show-current`) before each `Agent` dispatch as a safety
belt.

## 6. `lockAxis` before snap is not enough — the lock must run AFTER snap too

The plan and the design doc both claimed "lockAxis applies first so
guides only nudge along the locked axis." Code review caught this
as wrong: `snapDelta` evaluates X and Y snap candidates
independently, so even when `lockAxis` zeroes the perpendicular
axis BEFORE the snap pass, `snapDelta` can re-introduce a non-zero
adjustment on that axis if a sibling edge or guide is within
`SNAP_THRESHOLD` (8 logical px). The element then drifts off the
locked axis — exactly the bug the lock was meant to prevent.

**Fix shipped:** Apply `lockAxis` twice when Shift is held — once
before snap (so the snap engine sees the user's intended axis as
"the only one in play") and once after snap (to enforce the lock
against any per-axis adjustment the snap engine added). The
"final" lock has the last word.

**Why:** "Pre-snap modifiers solve all snap conflicts" is a
plausible-sounding intuition that only holds when the snap engine
itself is axis-aware. `snapDelta` here is not — it treats X and Y
independently — so the modifier has to bracket the snap pass on
both sides.

**How to apply:**
- When wiring a constraint into a handler with an independent-axis
  snap pass, default to bracketing (constraint-snap-constraint),
  not just pre-flighting.
- Add an integration test that places a sibling edge within
  `SNAP_THRESHOLD` of the locked-zero axis and asserts the final
  commit respects the lock. The original plan promised this test;
  it shipped without one.

## 7. Connection-site precedence is implicit, not branched

For B2 (connector draw + Shift) and B3 (endpoint drag + Shift), the
plan deliberately avoided "if Shift then disable attachment"
branching. Instead, the snapped coordinate is what
`buildConnectorInit` / `snappedEndpoint` sees, so attachment falls
out naturally — if the snapped point happens to be inside a site
radius, the endpoint attaches; otherwise free. Release Shift to
attach.

**Why:** Two interlocking constraint systems (angle + site) are
easier to reason about as a pipeline (angle first, site test on
the result) than as a precedence rule with explicit overrides.

**How to apply:** When adding a new modifier to a flow that already
has a snap behavior, prefer "transform the input, let the existing
snap decide" over "branch on modifier to disable the existing snap."
Less code, fewer corner cases.
