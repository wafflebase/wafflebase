# Lessons — chunk load recovery

## Diagnose the deploy before blaming the deploy

`Importing a module script failed.` reads like a stale deploy, and the first
instinct was to treat it as one. It was not. What settled it was not reasoning
about the deploy pipeline but diffing the two `gh-pages` manifests that
bracket the error's timestamp: 363 entries, 4 of them changed, all 4 belonging
to the VitePress docs site. Every application chunk was byte-identical across
the builds, so nothing the user's `index.html` named had gone missing.

The general rule: this repo records exactly what it published, in
`.manifests/*.txt` on `gh-pages`. A claim about what a client could or could
not fetch at a given moment is checkable against that file. Reasoning from the
workflow's retention policy would have reached the same answer more slowly and
with less confidence — `KEEP_COUNT=3` tells you how many builds are retained,
not whether this build's chunks were among them.

## Never run prettier across a glob in this repo

`npx prettier --write "packages/frontend/src/app/**/*.tsx"` reformatted **169
files** and produced a 7,710-line diff for a change that touches 18. The repo's
committed source is double-quoted; `.prettierrc` says `singleQuote: true`.
Prettier is therefore *not* the enforced style here — `frontend lint` is eslint
only, and no verify lane runs prettier. Running it "to tidy up" rewrites
everything it is pointed at.

Recovering was cheap only because the new files were untracked, so
`git checkout -- packages/frontend` reverted the damage without touching them.

**Rule:** match the style of the file you are editing by hand. If a formatter
must run, scope it to the specific files the change already touches, and diff
the result before staging. Better: check whether the repo enforces the
formatter at all before reaching for it.

## `React.lazy`'s `any` is not laziness

`lazyWithRetry<T extends ComponentType<never>>` typechecks at the definition
and fails at every call site. Props are contravariant, so `ComponentType<never>`
does accept each concrete component type — but the returned
`LazyExoticComponent<T>` will not then unify with what the JSX expects.
React's own signature uses `ComponentType<any>` for exactly this reason. A
wrapper around a typed API should copy that API's constraint rather than
invent a stricter-looking one.

## A vacuous assertion looks exactly like a passing one

The first version of the "left deliberately pending" test raced the promise
against `Promise.resolve().then(...)` and asserted the race returned
`"pending"`. That holds for **every** outcome: `loadWithRetry` needs many more
microtasks than one, so the tick always wins, and the test would have passed
just as happily if the code rejected. Round 1's test-adequacy lens caught it.

An assertion that something has *not* happened needs the queue drained first
and a settlement flag checked after — not a race, whose loser is
indistinguishable from a promise that will never settle.

## "Deliberately pending" needs an escape hatch

Returning `new Promise(() => {})` after `reload()` is right for the moment the
document is being replaced, and wrong for every case where the reload does not
take. There is no callback for "the navigation happened", so the honest shape
is a bounded wait: hold the Suspense fallback for a grace window, and if the
wait ever *finishes*, the reload failed — fall through and render the boundary.
A promise that can never settle is a hang, however well commented.

## A self-initiated reload is not covered by `beforeunload`

The unsaved-work guard in `SyncStatusChip` was built for the user closing the
tab. `lazyWithRetry`'s reload is the app closing it, and on iOS — the platform
the report came from — `beforeunload` is routinely ignored outright. Any new
code path that discards the document has to ask the same question the guard
asks, which is why `lib/unsaved-work.ts` exists as a seam rather than the
reload just trusting the browser to prompt.

## A new import can reach further than its package

Adding `import * as Sentry from "@sentry/react"` to a module that every route
imports pulled Sentry into **design-sandbox's** scene graph, where it was
previously only in `main.tsx` — which no scene mounts. The consequence is the
mid-session "new dependencies optimized, reloading" that
`optimizeDeps.include` exists to prevent. Worth checking
`packages/design-sandbox/scenes.config.json` when adding a dependency edge to
anything under `packages/frontend/src/app/*-detail.tsx`.

## Review rounds

- **Round 1** (correctness, tests): 7 blocking findings across docs,
  correctness, test-adequacy and blast-radius. All 7 verified against the code
  and accepted — none disputed. Fixed: the doc's call-site count (39 → 56); a
  `report()` throw cancelling the reload after its budget was spent; the
  never-settling promise (now a bounded `RELOAD_GRACE_MS` wait); the vacuous
  pending assertion; `browserEnv` having no test at all; `@sentry/react`
  missing from design-sandbox's `optimizeDeps.include`; and the reload
  discarding unsent edits (new `lib/unsaved-work.ts` probe).
  `pnpm verify:fast` green.
- **Round 2** (design fit, blast radius): _pending._
