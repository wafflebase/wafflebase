# Lessons — code defects the docs audit found

## Twelve defects, none found by a test

Every defect here surfaced because someone read code to check a documentation
claim. That is worth sitting with: the suite was green throughout, and several
of these were reachable from a plain HTTP request.

The mass-assignment hole shows why. `documents.controller.spec.ts` called the
handlers **directly**, which bypasses the global `ValidationPipe` entirely — so
a spec that looked like it covered the update path could not have caught a
validation defect. The fix booted a real Nest app over supertest with the pipe
configured as `main.ts` configures it. Any future test of pipe behaviour has to
do the same, or it is testing nothing.

## A test double more forgiving than the database hides the bug it exists to catch

`PATCH {"title": null}` was a 500. The spec's `updateDocument` double only
threw on *unknown columns*, so `null` on a non-nullable column read as a clean
200 in tests while Prisma threw in production. The double had to learn the
schema's nullability before the pre-fix test could fail honestly.

When a double stands in for a database, the failure modes it models are the
only ones your tests can ever see.

## Assertions that cannot fail for the reason their name gives

`expect(poolSize).toBeLessThanOrEqual(8)` passed with the buggy fallback of `2`
just as happily as with the correct `8`. That assertion is what let
`readBoundedInteger` claim to clamp for as long as it did. A loose bound on a
value with one correct answer is a test-shaped hole.

## Two fields, opposite `null` semantics, one decorator apart

The rebase collided with #1012, which had added `folderId` to the same handler.
`@IsOptional()` treats `null` as absent and skips every decorator after it —
right for `folderId`, where `null` means "move to the workspace root", and
wrong for `title`, where it let a `null` through to a non-nullable column.
`@ValidateIf((_object, value) => value !== undefined)` is the distinction.

And omitting `folderId` from the DTO would have turned every folder move into a
400 that **no unit test would catch**, because none of them run the pipe. A
union merge here was not "keep both hunks"; it was understanding why each side
existed.

## Fix the class, not the instance

Gating the `Insert comment` row on a selection closed one of `beginCompose`'s
two preconditions. The other, `currentUser`, left the row dead for an
editor-role share link opened anonymously — the same "offered but silently
inert" defect, still shipped. The fix derives one `canComment` boolean beside
the guard, from the guard's own conditions, so the two cannot drift again.

A review then found a third instance: `Add link` is dead at a caret inside a
header or footer. Worth a sweep rather than another one-off.

## The same constant in three files will drift, and the drift is invisible

Adding the busboy off-by-one to `POST /images` left the v1 sibling on the bare
cap, so a 10 MB image succeeded through one route and 413'd through the other —
both ending in the same service call, which accepts it. The frontend's
in-document picker uses the route that drifted.

`assertSheetDocument` now sits copy-pasted in nine controllers, differing only
by a message prefix. That shape is exactly how the cells one went missing.

## Config committed for the maintainer's own deploy is config every fork ships

`packages/frontend/.env.production` carried the upstream API host, Yorkie
project key and analytics property, and `vite build` runs in production mode
where it outranks the localhost `.env`. Every fork shipped a bundle addressing
wafflebase's own service, silently.

The values could not simply be deleted — the publish workflow had no overrides,
so that file *was* the deploy's configuration. They moved to **repository
variables** rather than into the workflow, because a fork inherits no variables
but does inherit workflow contents: hardcoding would have reproduced the bug
with a louder blast radius.

The failure direction matters more than the failure rate. A missing required
variable now fails the preflight before the deploy step runs, so the published
site is untouched — but the signal is a red run on a `workflow_run` trigger
that reaches nobody's review queue. Set the variables **before** merging such a
change; a task file recording the precondition is not a mechanism.

## A test double cannot pin a claim about the collaborator it replaces

`POST /images`'s new `fileFilter` was justified by being "byte-identical to
what `ImageService.upload` throws", and a spec asserted exactly that string.
But that spec provides `ImageService` as `{ upload: jest.fn() }` — the real
`upload` never runs, so the assertion pinned one side of an equality and
nothing at all about the other. Rewording the service would have left the
suite green and the justification false, which is the same drift
`image.constants.ts` was created to prevent, in the file created to prevent it.

Two things fix it, and both were needed. Give the two producers **one source**
(`unsupportedFileTypeMessage`), and assert the property that the source is
single — `image.constants.spec.ts` reads `packages/backend/src` and fails if
any non-spec file other than the constants spells the message out. Behavioural
tests cannot express "there is one definition"; a fifth site would restore the
drift with every test still passing.

The general form: whenever a comment says "the same as X", ask which test
would fail if X changed. If the only test that mentions X mocks X, the answer
is none.

## "Make it work" beats "gate it" when the action was never broken

`Add link` in a header looked like the `Insert comment` defect — a control
offered where its callback silently bails — and the obvious fix was the one
that had just worked: derive a `canLink` boolean and hide the row.

That would have removed a working feature. `insertLink` already writes to
header blocks; only the *anchor* the popover positions against was missing,
because `getCursorScreenRect` resolved through the body layout while the paint
path had branched to `computeHFCursorPixel` for exactly this case all along.
Checking which half was actually dead cost one test and changed the fix
completely.

"Offered but inert" has two repairs, and the cheap one is not always the right
one. Find out which side is missing before picking.

## Prove a refactor is behaviour-preserving; do not assert it

Two changes here claimed purity. `resolveActiveCursorPixel` lifts a ternary
out of `paint()` so `getCursorScreenRect` can share it; `assertSheetDocument`
replaces nine private copies.

The assertion "this is behaviour-preserving" is worth nothing on its own. What
is worth something is a mechanical check anyone can repeat: diff each touched
file with the moved code excised and confirm nothing else changed, and — for
the nine controllers — write the spec that pins all nine messages **first**,
run it against unmodified source, and only then refactor. Sixteen passing
before the change is what makes sixteen passing after it evidence.

## An assertion that holds for a reason other than the one it names

`footerRect.y > headerRect.y` reads like a header/footer regression guard. On
a one-page document it is page geometry: it holds even if every header
resolved onto page 1, which is the regression it looks like it catches. The
case that bites is two pages and the page-2 header, where the active page
index has to reach the rect.

Two more from the same review. `expect(className).not.toContain("destructive")`
passes on an empty class list — a negative assertion needs its positive twin.
And `height > 0` was passing at ~1e-14, because jsdom answers every
`getBoundingClientRect` with zeros and the editor's scale factor collapses;
stubbing a real viewport turned the numbers into document pixels you can check
against a page.

Same shape as the `readBoundedInteger` lesson above, from the other direction:
there, a loose bound could not fail; here, a true statement fails for reasons
unrelated to the change. Ask what the assertion would look like if the fix
were reverted — if it still passes, it documents rather than guards, and the
comment should say so (see the `insertLink` test, kept and relabelled).

## A measured absence is weaker than a derivation

The `--warning` token needs two values, and the first justification was an
empirical sweep: "at L=0.58 light reaches 4.54 while dark has fallen to 4.38".
True, and it invites the next person to try a different hue.

The real statement is stronger and shorter. WCAG contrast is
`(Yhi + 0.05) / (Ylo + 0.05)` over relative luminance alone, so hue and chroma
enter only through `Y`. With backgrounds at `Y = 1` and `Y ≈ 0.00279`, the
worse of the two ratios peaks where they cross —
`(Y + 0.05)² = 1.05 × 0.05279` — at **4.46:1**. Under the floor, for every
colour that exists.

When a comment says "we looked and did not find one", check whether the thing
is impossible. If it is, say that instead: the claim then survives the person
who has a better idea.

## Working in a checkout another session controls

The branch was switched to `main` under this work twice, once mid-push, and an
earlier commit swept another session's staged files in because `git commit`
without a pathspec commits the whole index. `git commit --only <paths>` is the
habit — but note it re-stages a path that exists in the working tree, so it
cannot carry a `git rm --cached` deletion. Verify the index immediately before
committing, and prefer a dedicated worktree when a checkout is shared.
