# Lessons — Sentry error tracking

## Do not run `prettier --write` on frontend files

The root `.prettierrc` sets `singleQuote: true`, but `packages/frontend`
source is written with **double** quotes — prettier is not what formats it
(eslint is). Running `pnpm --filter @wafflebase/frontend exec prettier --write`
on four files reflowed `App.tsx` (256 lines) and `vite.config.ts` (233 lines)
into a diff that had nothing to do with the task.

Rule: in this repo, format frontend code by matching the surrounding file by
hand, or run `eslint --fix`. Prettier is the backend's formatter. And check
`git diff --stat` after any formatting command — the damage is invisible in a
lint summary, which passed.

Recovery was `git checkout HEAD -- <paths>` and re-applying the edits, per
`feedback_avoid_stash_for_temporary_revert`.

## A large re-indent is a signal to move the code, not to re-indent

Wrapping `App.tsx`'s tree in an error boundary meant re-indenting ~90 lines.
Moving the boundary up to `main.tsx` instead made it a 3-line change **and a
better design** — `ThemeProvider` writes its class onto
`document.documentElement`, so the fallback is themed from outside `App`, and
a throw inside the provider tree is now caught too.

When a change forces a big mechanical diff, check whether a different
placement gets the same behavior for free.

## `??` is the wrong operator for a GitHub Actions `vars.*`

Actions passes an **unset** `vars.X` through as the empty string, not as an
absent variable. `process.env.SENTRY_ORG ?? "wafflebase"` therefore keeps
`""`, and the uploader would be handed `org: ""`. Use `||` for anything
sourced from a workflow `env:` block.

## Checking the CORS allow-list before writing the frontend saved a production break

`enableCors` in `packages/backend/src/main.ts` uses an explicit
`allowedHeaders` list. Turning on distributed tracing makes the browser attach
`sentry-trace`/`baggage` to every backend call, and a preflight that does not
list them **fails the request** — it does not merely drop the trace. Reading
the CORS config before wiring `tracePropagationTargets` is what caught it.

Generalization: before enabling anything that adds headers to cross-origin
requests, read the server's allow-list.

## An empty string in `tracePropagationTargets` is a leak, not a no-op

`backendOrigin()` returns `""` on a same-origin deployment. Sentry matches
those entries as substrings, and every URL contains `""` — so `[""]` attaches
trace headers to third-party hosts. Omitting the option is correct; the SDK
default is same-origin plus localhost.

Pattern worth remembering: a "match this list" API given an empty string
usually means *match everything*, not *match nothing*.

## Verify the conditional path you did not take

`SENTRY_AUTH_TOKEN` gates source maps. Testing only the unset path would have
proved half of it. Running the build once with a dummy token showed three
things worth knowing: the plugin activates, the build **still succeeds** on a
401 (so an expired token degrades silently), and the maps are deleted from
`dist` even when the upload fails (so a bad token leaks no source). Two of
those became comments in `vite.config.ts`.

## Backend lint is not reachable through its own script

`pnpm --filter @wafflebase/backend lint` fails with "No files matching the
pattern `{src,apps,libs,test}/**/*.ts`" — `apps/` and `libs/` do not exist.
Lint backend changes with `pnpm exec eslint "src/**/*.ts"` from the package
directory, and compare the reported line numbers against your own diff, since
the baseline is not clean (pre-existing `no-unsafe-*` in `app.module.ts` and
`main.ts`). This confirms `project_verify_fast_gate_gaps`.

Also: an `eslint-disable-next-line` naming a rule that is not configured is
itself an **error** ("Definition for rule 'import/order' was not found").
Check the rule exists before disabling it.

## Read the vendor's code before writing a comment about its behavior

`app.module.ts` originally carried a confident comment saying
`SentryGlobalFilter` "deliberately does not report `HttpException`s — the 404s
and 403s this codebase throws for ordinary refusals are decisions, not
failures." Half true, and the wrong half was load-bearing.

`isExpectedError()` in `@sentry/nestjs/build/cjs/helpers.js` never reads the
status code. It returns true for anything with
`getStatus`/`getResponse`/`initMessage` — every `HttpException`, 500s
included. This backend throws 5xx `HttpException`s at seven sites (Miro
unreachable, DuckDB unavailable, Yorkie unreachable, database down), so the
stock filter would have hidden precisely the failures the feature was added to
surface, while still faithfully reporting an unhandled `TypeError`. Nothing
would have looked broken; Sentry would just have been quiet.

The comment was written from what the behavior *ought* to be. The fix
(`SentryServerErrorFilter`) came from reading the installed package. When a
comment asserts what a dependency does, open the dependency.

## A review finding deserves verification, not deference

Both real findings this round came from review agents, and both were checked
against the actual source before acting — the SDK helper for the filter claim,
`git grep` for the "seven 5xx sites" number. Two other agents' findings were
correct as stated; a third produced only non-findings. Treat a finding as a
lead.

## Initialization that runs before the error boundary must not throw

`initSentry()` is called at module top level in `main.tsx`, before
`createRoot().render()`. That is the right place for *capturing* early errors
and the worst place to *raise* one: the error boundary added in the same commit
does not exist yet, so a throw there produces the blank page the boundary was
added to prevent — strictly worse than before the feature.

Generalization: any bootstrap code that runs above the UI's own safety net
should swallow its own failures. The tool being unavailable has to cost less
than the tool being present.

---

## Postscript: this task took wafflebase.io down

Appended after the fact. The CORS trap below was found *and then argued away*,
and the argument was wrong in a way worth keeping.

`docs/design/observability.md` and the PR body both said the new-frontend /
old-backend combination was defused because "the frontend attaches nothing
until an operator sets `VITE_SENTRY_DSN`, by which point the backend change has
shipped." True of every clause but the last, which was **assumed, never
checked**.

The two halves do not ship together. The frontend publishes on every merge to
`main`; the backend is pinned to a release tag in a manifest in another
repository, rolled out by a human. Worse, the operator instruction I wrote told
them to set `VITE_SENTRY_DSN` first. So the ordering ran exactly backwards: the
frontend attached `sentry-trace`/`baggage` to a backend that allow-listed
neither, the preflight failed every credentialed call including `/auth/me`, and
nobody could sign in. Nothing reached the backend log — the browser blocks the
request before sending it.

**The lesson is not "check CORS."** That part was done. It is:

> A feature flag defuses a deploy-ordering hazard only when the ordering is
> actually enforced. Here nothing enforced it — the claim was a prediction
> about which human would do what, first, dressed up as a design property.

When a change alters a request *contract* across the two halves — headers,
CORS, a protocol version — the question to answer is not "is it off by
default?" but "what makes backend-first true?" If the answer is a sentence in a
document, it is not true.

Two smaller things from the same incident:

- **Verify against the artifact, not the source.** Reading the Dockerfile to
  conclude the release fallback works was the same move that produced the
  original error. Running `yorkieteam/wafflebase:v0.6.12` with `SENTRY_RELEASE`
  unset and watching it print `0.6.12` is what made it a fact. Same for the
  source maps: the CI log said "Successfully uploaded", and fetching a deployed
  chunk's `.map` and getting a 404 is what proved the other half.
- **An operator instruction is part of the change.** "Set `VITE_SENTRY_DSN`"
  read as a setup step; it was actually the trigger that armed the hazard. Steps
  handed to a human need the same ordering scrutiny as code.

### Self-review rounds (follow-up branch `fix/sentry-sourcemap-hidden-and-deploy-ordering-doc`)

- **Round 1 — clean, loop stopped.** All six lenses passed with no blocking
  findings.
- Two false starts worth recording, because neither is a review result and both
  look like one in the log:
  - The first invocation reviewed an **empty diff** and failed closed. The work
    was still uncommitted; `spec-to-pr.mjs review` diffs committed work against
    `origin/main`. Commit before reviewing.
  - The second returned `[major]` on **all six** lenses with the same body:
    `Cannot find package '@anthropic-ai/claude-agent-sdk'`. That is the SDK
    missing from `scripts/agent/node_modules`, not a finding — and checking
    `[ -d node_modules ]` said "deps present" because the directory existed
    while the package did not. Run `npm ci` in `scripts/agent` and check for
    the package itself. Six identical majors citing no file is the shape of a
    broken runner, never of a real review.
