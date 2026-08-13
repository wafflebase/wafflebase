# Visual lane: replay Google Fonts from a recorded cache

## Problem

`verify-browser` fails intermittently on every branch, `main` included. Over
the last 80 CI runs, 64 actually ran the job:

| outcome | count |
| ------- | ----- |
| success | 53    |
| failure | 11 (~17%) |

**All 11 failures are the same one**, and it is not a regression in any of the
branches that hit it:

```
[verify:visual:browser] desktop/all-sections: required webfonts never became usable: JetBrains Mono (unloaded/error)
[page-console] Failed to load resource: the server responded with a status of 404 ()
```

Which family dies is random — JetBrains Mono ×5, Fraunces ×4, Inter ×2 — as is
the profile (desktop / desktop.dark / mobile / mobile.dark). So it is not a
property of a font or of a scenario; it is the network.

`packages/frontend/index.html` fetches its three families from
`fonts.googleapis.com` at runtime, and `REQUIRED_WEB_FONTS` in
`scripts/verify-visual-browser.mjs` gates the capture on exactly those. Every
one of the ~25 capture passes therefore depends on a live GitHub-runner →
Google round trip, and a single failed `woff2` fails the job.

The `css2` stylesheet itself succeeds (the faces *are* registered — hence
`unloaded/error` rather than `no @font-face registered`); what fails is an
individual `fonts.gstatic.com` `woff2`. The existing recovery,
`refetchPass()`, re-inserts the same `<link>`, which re-uses Chromium's
negatively-cached entry for that `woff2` — which is why both refetch attempts
fail identically in every one of the 11 logs.

This is not just gate noise. In 2 of the 11 (`94323888186`, `94079200405`) the
run also reported real baseline mismatches: the missing family was painted as
the fallback serif. Loosening the gate would let those through silently.

`docs/tasks/active/20260811-visual-inter-font-race-todo.md` already names this
under "Known limitations" and defers it. It is now the *only* thing failing
this lane.

## Approach

Take the network out of the capture, without changing what the app does or
what the baselines contain.

Intercept `fonts.googleapis.com` / `fonts.gstatic.com` at the Playwright
context and serve committed fixtures:

- **Replay (default, and what CI runs).** A recorded response is fulfilled
  from disk. A URL not in the cache is aborted and reported by URL at the end
  of the run, alongside the existing webfont-failure report, with the command
  to re-record. A miss is therefore loud and deterministic instead of a
  coin-flip against Google.
- **Record (`RECORD_GOOGLE_FONT_CACHE=true`, run on demand).** Requests go to
  the network and every response is written into the fixture directory. Run it
  when `index.html`'s `css2` query changes or a scenario starts painting a new
  family.

The recorded bytes are the same bytes Google serves today, so **no baseline
needs re-recording** — this is the property that makes the change cheap.

### Rejected: self-hosting the fonts in the app

Vendoring the `woff2` into `public/fonts/` and replacing the `<link>` with
local `@font-face` would fix CI *and* production reliability *and* the
third-party request. It is a product change (bundle, deploy, first-paint
behaviour) for a CI problem, so it stays out of scope here; noted for whoever
wants it.

## Plan

- [x] Add `scripts/google-font-cache.mjs`: fixture load/store, `context.route()`
      installer, record/replay modes, miss reporting.
- [x] Wire it into `verify-visual-browser.mjs` at `browser.newContext()`.
- [x] Report cache misses with the re-record command; fail the run on a miss
      the same way `webFontFailures` does (after artifacts are written).
- [x] Refuse `visual:update` when a miss occurred, mirroring the existing
      fallback-glyph guard.
- [x] Unit-test the module: replay hit / miss / missing body, record write +
      round-trip, non-200 refusal, orphan prune.
- [x] Record the fixtures and commit them.
- [x] `pnpm verify:fast`.
- [x] `pnpm verify:browser:docker` — the lane this fixes, with the network
      still available.
- [x] Prove it offline: re-run the Docker lane with Google Fonts unreachable
      and confirm it still passes.

## Review

The cache holds **5 files, ~170 KB**: one `css2` stylesheet and one `woff2`
per family. That is the entire network surface the visual lane had — Chromium
only fetches the subset a glyph actually needs, so the ~28 faces the
stylesheet declares cost three files.

Verification, in order of what it proves:

| run | result |
| --- | ------ |
| `test:visual:browser:docker:record` | recorded 4 responses |
| `test:visual:browser:docker` (network up) | **All 220 profile targets matched** |
| same lane, `--add-host fonts.googleapis.com:0.0.0.0 --add-host fonts.gstatic.com:0.0.0.0` | **All 220 profile targets matched**, exit 0 |
| `vitest tests/visual/google-font-cache.test.ts` | 7 passed |
| `pnpm verify:fast` | pass |

The third row is the point: the lane now passes with Google Fonts
unreachable, which is the failure mode that produced all 11 sampled CI
failures. No baseline changed — `git status` shows nothing under
`tests/visual/baselines/`.

Recording in Docker was load-bearing, not caution: the `css2` body recorded
on macOS was 19156 bytes against Docker's 18891, because Google varies the
response by User-Agent.

The prune in `save()` deleted every unreferenced file, which would have eaten
the fixture directory's own `README.md` on the next record. Caught while
writing the README, fixed with an explicit keep list, and covered by the
prune test.

## Known limitations

- **The interaction and hunt-oracles lanes still reach Google Fonts.**
  Neither gates on fonts, so neither has flaked this way, but
  `verify-hunt-oracles.mjs` has a `network-fail` oracle that a Google Fonts
  failure could in principle trip. Installing the same cache there is a small
  follow-up. `scripts/capture-docs-screenshots.mjs` is in the same position.
- **The fixtures pin a font version.** `index.html` asks for a family, not a
  version; Google resolves that to `.../inter/v20/...`. When Google ships v21
  the cache keeps serving v20 until someone re-records — which is a *feature*
  for a baseline comparison (a silent upstream reflow can no longer break the
  lane) but does mean the lane's glyphs can drift from production's. Re-record
  when a baseline refresh is being done anyway.
- **Recording still needs the network, and records whatever Google serves.**
  A non-200 is refused rather than stored, but a 200 carrying a *changed*
  font would be recorded silently; the baseline comparison in the following
  run is what catches that.
- **`run-browser-tests-docker.sh` clobbers `packages/core/node_modules`.**
  Pre-existing and unrelated to this change: the script shadows
  root/sheets/frontend/backend `node_modules` with named volumes but not
  `core`'s, so the container's Linux install lands on the host mount and the
  next host `pnpm test` fails to resolve vitest. `pnpm install` restores it.
  Worth shadowing the remaining packages in a follow-up.
