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

## Working in a checkout another session controls

The branch was switched to `main` under this work twice, once mid-push, and an
earlier commit swept another session's staged files in because `git commit`
without a pathspec commits the whole index. `git commit --only <paths>` is the
habit — but note it re-stages a path that exists in the working tree, so it
cannot carry a `git rm --cached` deletion. Verify the index immediately before
committing, and prefer a dedicated worktree when a checkout is shared.
