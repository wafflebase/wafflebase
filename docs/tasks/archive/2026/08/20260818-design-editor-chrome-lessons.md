# Lessons — design-editor shell chrome (PR 11b)

## A browser gate that can serve stale bytes is not a gate

`verify:frame` rebuilt the shell only when `dist/shell/index.html` was *missing*, so it
happily tested a bundle built before the change under test. It cost an hour debugging a
wiring fix that was already correct in the source. Fixed by comparing the newest mtime
under `src/`. Any gate that consumes a build artefact needs the same check.

## Three claims in the plan did not survive measurement

- "`SceneHost` has 25 `Select` call sites" was `grep -o` counting imports, types and
  closing tags. Actual: one. It had been steering the plan toward vendoring Radix.
- The scene list could not come from `virtual:wb-scenes` — the shell is prebuilt.
- The drill-in cache was unnecessary: `/metadata` already carries every file's `roots`.

Pattern: each was plausible, written down, and inherited. Measure before building on a
number someone (including me) wrote in a doc.

## Porting drops features that live in no file list

`useTailwindCandidates` was in neither 11b's table nor 12's, so it nearly vanished.
Without it Tailwind emits no rule for a class the editor composes, and the class editor
*looks* broken while working correctly. When a port's file list is the plan, the files
that are not on it are the risk.

## Vacuous tests are the default outcome, not the exception

Roughly a third of the tests written here passed against a deliberately broken
implementation on the first revert-prove: an undo test that emptied the stack either way,
a `×N rendered` check where N was 1, a `'2'` substring that matched elsewhere on the page,
an `instances > 0` guard shadowed by a second condition. Reverting each rule and naming
which tests must fail is what found them.

## The pre-push hook corrupted this repo twice

Fixed upstream by #866 (`scripts/agent/git-env.mjs`). Confirmed after rebasing: a full
hook run left `core.bare`, `core.filemode`, `user.name` and HEAD untouched. Note the
hook now runs the full `verify:self`, which exceeds ten minutes.
