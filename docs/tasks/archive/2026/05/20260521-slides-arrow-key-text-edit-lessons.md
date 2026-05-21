# Slides — Arrow Key Hijacks Text-Box Editing (Lessons)

## "Pre-existing failure on main" was a stale local dist

When `pnpm verify:fast` reported three failing frontend tests
(`tests/app/slides/yorkie-slides-{store,equivalence,two-user}.test.ts`)
with `SyntaxError: ... does not provide an export named 'worldTightFrame'`,
the symptom looked like a regression introduced by PR #269. `git stash`
+ re-run reproduced the failure on bare `main`, which reinforced the
"pre-existing" diagnosis.

It wasn't. The frontend's `tests/resolve-hooks.mjs` resolves
`@wafflebase/slides` to `packages/slides/dist/wafflebase-slides.es.js`
when it exists (falling back to `src/index.ts` only when the dist is
missing). `pnpm verify:fast` does **not** rebuild the slides package,
so any export added to `src/index.ts` that hasn't been followed by
`pnpm --filter @wafflebase/slides build` will surface as a missing
export at test-time — even though the source is correct and clean
checkouts on a CI machine (which build everything fresh) would pass.

**Takeaway**: when frontend tests fail with "does not provide an
export named X" on a workspace package, the first move is
`pnpm --filter @wafflebase/<package> build`, not git archaeology.
The same trap applies to `@wafflebase/sheets` and `@wafflebase/docs`
(resolve-hooks does the same dist-first lookup for both).

## `git stash pop` is not "restore the file I just stashed"

To verify the new regression test catches the bug, I ran
`git stash push -- packages/slides/src/view/editor/interactions/keyboard.ts`,
intending to revert the production fix temporarily, run the test,
then `git stash pop`. The file was clean (the fix had already been
committed), so `stash push` created *no* stash. The subsequent
`git stash pop` then popped the topmost *existing* stash —
`stash@{0}: wip-148-baseline-changes-2026-05-11` — onto the working
tree, dumping ~100 visual-baseline PNGs with merge conflicts.

The stash itself remained safe in the stash list, so recovery was
just `git checkout HEAD -- packages/frontend/tests/visual/baselines/`.
But the principle is: **`git stash pop` always pops stash@{0}
regardless of what you stashed**. To temporarily revert a tracked
file, use `git checkout HEAD -- <path>` (or `git restore <path>`) and
re-apply via a Read+Edit cycle, *not* the stash queue.

## When asserting "this file doesn't exist"

I claimed `packages/slides/test/view/editor/interactions/keyboard.test.ts`
didn't exist and proposed the absence of tests as an architectural
limitation. The reviewer correctly pointed at the file. The mistake
upstream of that was treating a single `find -name "keyboard*"`
returning empty as authoritative, when `ls` on the parent directory
would have shown the file immediately. For repository structure
claims, prefer `ls` of the candidate directories over `find` glob
matching — it's both more reliable and visibly enumerates what *is*
there, which often answers the next question for free.
