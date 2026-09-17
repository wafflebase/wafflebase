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
