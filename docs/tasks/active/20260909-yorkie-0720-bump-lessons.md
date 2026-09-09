# Lessons — Yorkie 0.7.20 bump

## A dependency bump is a bundle change, and this repo gates bundles

`verify:fast` passed and told me nothing. The failure was in `verify:self`:
`vendor-yorkie` came out at 782.51 kB against its 780 kB targeted cap. Bumping
a vendored SDK moves a number the harness watches, so the gate that matters is
`verify:self`, not `verify:fast` — and running it is not optional just because
the diff is four version strings.

Worse, the failure was invisible in the notification. The background command
was `pnpm verify:self > log 2>&1; echo "EXIT=$?"`, and the harness reported
**exit 0** — the exit status of the `echo`, not of `verify:self`, which had
written `EXIT=1` into the output. A compound command launders the status of
every part but the last. Either run the command bare, or read the captured
status rather than the notification's.

## Measure the baseline; do not reason about it

The cap's own `reason` string recorded the last measurement ("measured
~764 kB"), which made it tempting to derive the delta by subtraction across
four minor versions. That would have been wrong and unattributable. The right
number came from actually building `main`: back up the modified
`package.json`s and lockfile to the scratchpad, `git checkout HEAD --` them,
`pnpm install`, build the frontend alone, record, then copy the backups back
and reinstall. 767.43 → 782.51 kB, +15.08 kB, attributable to one release.

`harness.config.json` already carries this rule as a scar — one of its
`maxChunkCount*Reason` entries says an earlier draft "guessed the cause
without measuring and was corrected on review". The convention holds for KB
caps too.

Note the restore step used file copies, not `git stash` — see
`feedback_avoid_stash_for_temporary_revert`. `git checkout HEAD --` alone
would have destroyed the uncommitted bump.

## The pre-commit hook outlasts the default Bash timeout

`git commit` runs `verify:fast`, which takes longer than the 2-minute default,
so the commit was killed mid-hook and silently did not land. Give commits an
explicit long timeout, and check `git log` afterwards rather than assuming.

## What the release changed for us was not what it advertised

0.7.20's headline is offline persistence, and the useful finding was that we
should *not* adopt it. Reading the shipped `.d.ts` rather than the PR summary
is what surfaced the blocker: the persisted envelope is keyed by
`apiKey/clientKey/docKey`, `ClientOptions.key` "if not set, a random key is
generated", and we never set it — so a naive `store: new IndexedDbStore()`
would persist faithfully and resume nothing, silently. Fixing that by
stabilizing `clientKey` then trips the Web Locks single-active-session guard,
which fails the second tab's attach. Two tabs on one document is ordinary use
in an office suite.

The real win was the unadvertised one: #1337's duplicate-attach guard, which
matters here only because the app runs in `StrictMode` and `DocumentProvider`
detaches asynchronously.

## Bump the local Yorkie server before running the attached suites

`docker compose ps` showed the container up for five days — i.e. a `:latest`
pulled at 0.7.19. `docker compose pull yorkie && docker compose up -d yorkie`
first, then `docker compose exec yorkie yorkie version` to confirm, otherwise
the Yorkie-attached e2e suites test the new client against the old server and
prove less than they appear to.

## A blocked verification step is not a skipped one

The plan said "manual smoke in `pnpm dev`". The dev servers came up fine, but
every document route is behind GitHub OAuth, which the agent doing this work
cannot complete. Two wrong moves were available: tick the box anyway (I did,
briefly, in a bulk `- [ ]` → `- [x]` pass — never bulk-check a plan, the
boxes are a record), or drop the step and say the bump was verified.

The right move was to ask what the step was *for* and get that another way:
two real clients against the live 0.7.20 server, asserting the chip's actual
condition (`lastEditSeq <= checkpoint.getClientSeq()`), presence both ways, and
#1337's duplicate-attach rejection. That is stronger evidence for what this
bump changes than clicking would have been — and the residue that genuinely
still needs a browser (the chip's rendering) is now written down as unverified
instead of buried under a ticked box.

One trap inside the probe: it first read `event.value.change.clientSeq` and
measured `editSeq=0`, which *looked* like a real regression in the sync-status
signal. The hook reads `event.value.clientSeq`. Mirror the production reader
exactly rather than guessing an event's shape, or the probe invents its own
bug and you spend the next hour on it.
