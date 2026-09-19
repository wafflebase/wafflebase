# Recover from a failed code-split chunk load

Sentry `WAFFLEBASE-2` — `TypeError: Importing a module script failed.`

## What happened

Two events, four seconds apart, from one session: Chrome Mobile iOS 153 on
iOS 26.6.1, Korea, release `0.6.12`, production, at
`https://wafflebase.io/w/jiyu`. No stack trace — that message is WebKit's for
a `import()` that never resolved. It reached the root `ErrorBoundary` in
`main.tsx`, so the user got the full-screen `AppCrashFallback`.

## It was not a stale deploy

Checked first, because a deploy that removes the chunks a cached `index.html`
still names produces exactly this message:

- gh-pages deploys were `02:17 UTC` (`0.6.12`, 043333320) and `12:45 UTC`
  (9c137ad0b). The error is at `16:33 UTC` — 3h48m after the later one, so
  nothing was in flight.
- Diffing the two deploys' manifests: of 363 entries only **4** changed, all
  of them VitePress docs-site assets. All 285 `assets/*` application chunks
  are byte-identical between the builds, so every chunk the user's
  `index.html` named still existed.
- `publish-ghpage.yml` keeps `KEEP_COUNT=3` manifests' worth of assets, and
  `0.6.12`'s manifest is one of the three retained.
- Live spot check: `index.html`, `assets/index-*.js`, `assets/vendor-react-*.js`
  all answer `200` with `content-type: application/javascript`.

So the bytes were there and the fetch failed anyway — a transient failure on a
mobile connection. `/w/jiyu` mounts two lazy components under one `Suspense`
(`Layout` and `WorkspaceDocuments`, `App.tsx`), which matches two events four
seconds apart.

## The actual defect

The frontend has **no recovery for a failed dynamic import**. There is no
retry, no route-level boundary, and no reload path. One failed chunk fetch on
a flaky connection takes the whole application to a crash screen, and a real
stale-deploy failure would be indistinguishable from it.

## Plan

- [x] Confirm the diagnosis against Sentry, the gh-pages manifests and the
      live site (above)
- [x] `src/lib/lazy-with-retry.ts` — `isChunkLoadError()` + `loadWithRetry()`
      + `lazyWithRetry()`
  - [x] Only chunk-**load** errors are recovered. A module that throws while
        evaluating is a real bug: rethrow it unchanged, no retry, no reload.
  - [x] One in-place retry after a short delay.
  - [x] Then one full reload, so a genuinely stale `index.html` is replaced.
        Guarded by a timestamp in `sessionStorage` so it can never loop, and
        skipped when `navigator.onLine === false` (a reload would land on the
        browser's offline page).
  - [x] Report to Sentry before reloading, tagged as recovered — otherwise
        recovery would delete the only signal we have that this happens.
- [x] Unit tests for the helper (all branches, injected clock/storage/reload)
- [x] Use it at every `lazy()` call site in `src/`
- [x] `AppCrashFallback` says something accurate when the cause was a chunk
      load rather than a render throw
- [x] `pnpm verify:fast`
- [x] Self review (`/self-review`), then PR

## Review

Landed as `lazyWithRetry`, a drop-in for `React.lazy` used at all 56 call
sites across the 12 files in `packages/frontend/src` that code-split. The
recovery ladder is: retry once in place, then reload once per 10 minutes per
tab, then give up and show a fallback that names the cause.

Three decisions worth keeping in mind:

- **Narrow trigger.** `isChunkLoadError()` matches only the four known
  loader messages (WebKit, Chrome, Firefox, Vite's CSS preload). Anything
  else propagates untouched on the first throw. Widening this to "any error
  from a lazy importer" would make a genuine crash inside a route module
  reload the page instead of reporting it.
- **The reload is rate-limited, not one-shot.** A `sessionStorage`
  timestamp with a 10-minute window. A one-shot flag would leave a
  long-lived tab permanently without recovery; no guard at all would loop a
  device that is simply offline. Storage access is wrapped — Safari private
  mode throws on `sessionStorage` — and a throw means "do not reload",
  which fails toward the fallback rather than toward a loop.
- **The reload defers to unsaved work.** A reload the app initiates itself
  can discard edits still in the Yorkie change queue, and `beforeunload` is
  not a backstop on iOS — the platform the report came from. `lib/unsaved-work.ts`
  is the seam: `SyncStatusChip` registers the same `hasUnsentEdits` probe it
  already uses for `beforeunload` and in-app navigation, and `canReload`
  declines while it answers yes. The user keeps the page, the work, and a
  button that reloads on their own say-so.

### Test plan

- `pnpm --filter @wafflebase/frontend test` — `src/lib/lazy-with-retry.test.ts`
  (recovery ladder, every `canReload` guard, and `browserEnv` itself),
  `src/lib/unsaved-work.test.ts`, and a third case in
  `tests/app-crash-fallback.test.tsx`
- `pnpm verify:fast`
