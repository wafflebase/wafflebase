# Lessons — Slides Hover & Text-Edit Entry browser smoke

## A manual smoke that found a real bug

The two deferred items were framed as "verify-and-document", but Phase D3
(Korean IME type-to-edit) surfaced a genuine regression. Lesson: treat a
deferred manual-smoke as real testing, not a formality — the scenario was
explicitly written as a "regression hedge", and the hedge paid off. The
bug ships on `main`; it is now a documented known issue (see the todo file)
rather than a silent gap.

## Unit-green ≠ browser-correct (the hard lesson here)

I wrote a jsdom unit test, made it green, and was ready to call the bug
fixed. In the real browser the bug was unchanged. The unit test asserted
*the contract I designed* (IME keydown → no `initialText`, no
`preventDefault`) using a synthetic `KeyboardEvent({ isComposing: true })`
— but the production keystroke on the actual machine apparently never set
that signal, so the guard never fired and the real code path was never
exercised. When a task is explicitly spun off *because* jsdom can't drive
the real input (IME, here), a passing jsdom test is necessary but NOT
sufficient evidence. Verify in the lane the task was created for before
claiming done.

## Don't ship an unverified "fix"

The attempted fix was reverted once the browser showed no change. Leaving
a behavior change in the tree that (a) I couldn't prove helps and (b)
demonstrably didn't fix the reported symptom is worse than a clean,
well-documented known issue. Revert, preserve the analysis in the
known-issue writeup, move on.

## IME keystroke detection is environment-dependent

`isImeComposingKeyEvent = e.isComposing || e.key === 'Process' ||
e.keyCode === 229` is the shipped sheets heuristic (`worksheet.ts:74`) and
works for sheets cell entry — but sheets focuses a *real* input and lets
the browser route the keystroke; it never injects. Slides type-to-edit
*injects* the first key as `initialText`, and on the test machine the
first Korean jamo arrived as a length-1 `key` ('ㅎ') that matched the
*printable* gate without any IME signal — so the same heuristic did not
catch it at the entry keydown. Takeaway: before relying on an IME signal,
instrument the real keydown on the target environment; the signals that
exist mid-composition (isComposing) are not guaranteed on the *entry*
keystroke.

## Find the working sibling before designing a fix

Docs / Sheets / Slides-text all compose Korean fine. The decisive
difference is that those paths let the browser put the keystroke into a
focused input; only the Slides type-to-edit path manufactures the first
character. The real fix direction (for a future attempt) is to stop
injecting and adopt true Sheets parity — focus the textarea and let the
native key land — not to detect IME and special-case it.

## verify:fast noise on this checkout

Local `verify:fast` fails on pre-existing issues unrelated to any change
here: frontend + slides `pdf*.test.ts` fail on `pdf-lib` dynamic-import /
module resolution, and `tsc` reports the known `.at()` es2022-lib error.
Confirm "pre-existing" by `git stash` + re-run rather than assuming your
diff caused a red. (See memory: slides-typecheck-gate-gap.)
