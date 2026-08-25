# @wafflebase/debug-report

A dev-only overlay bug reporter any web project can install: press a hotkey,
point at what is wrong, say it in one sentence, collect a few, hand them over
once. An agent drafts the issue text and proposes how the batch splits into PRs;
the reporter confirms; the pipeline verifies and lands it.

**Install it and you get the whole reporter, not a toolkit for building one.**
The overlay, the preview panel and the two dev-server endpoints are here; what a
host supplies is its route, and — only if it has Canvas surfaces — a function
turning a point into a semantic address.

Design: [`docs/design/debug-report.md`](../../docs/design/debug-report.md).
Harness side: [`harness-engineering.md`](../../docs/design/harness-engineering.md)
Phase 32.

## What is here

| Module | Contents |
|--------|----------|
| `src/types.ts` | `DebugItem` / `Target` / `Capture` / `Bundle`, and `parseBundle` — fail-closed, because a bundle crosses into a pipeline that can create commits |
| `src/session.ts` | The session singleton: mode, items, subscriptions. No framework state, so collecting survives anything the app underneath does to its render tree |
| `src/store.ts` | Blobs in IndexedDB, metadata in `localStorage`, a budget guard that evicts the oldest capture and reports what it dropped. An item outlives its capture |
| `src/host.ts` | The `HostAdapter` interface — route, build SHA, theme, locator, `draft`, `send`. The only path to the environment |
| `src/ui/` (`./react`) | The overlay, the preview panel, capture assembly, point→target resolution, and `createDevHost`. React is an OPTIONAL peer dependency: a host that imports only `.` never loads it |
| `src/plugin/` (`./plugin`) | `debugReportPlugin` — the two dev-server endpoints, as a Vite plugin. `apply: "serve"`, so they cannot exist in a build |
| `src/testing/` (`./testing`) | Helpers for a host testing its own wiring |

## What is not here

- **No engine locators.** Only the mounted engine can say which cell a point is,
  so `locateOnCanvas` is an argument this package takes, never an import it
  makes. A host with no Canvas omits it and every canvas point becomes a region
  — the honest answer for a surface nothing can interrogate.
- **No React in the core.** `.` is framework-free; the overlay lives behind
  `./react` with React as an optional peer dependency, so a non-React host can
  use the session, the store and the parsers and draw its own UI.
- **No `dist`.** The package exports `./src/index.ts` and reaches consumers as
  source, the way `@wafflebase/design-editor` does, so it is not registered in
  `scripts/verify-dts-entries.mjs` (that gate checks the declaration graph of
  packages that publish a build).
- **No model key in the browser.** Drafting is a dev-server endpoint precisely
  so the credential is read in that process and never shipped to a page. The
  call is tool-free by construction — there is no `tools` parameter on the
  request — and `@anthropic-ai/sdk` is an optional peer: without it, drafting
  reports `not-configured` and the panel falls back to the reporter's own
  sentences with one PR per item.

## Hosts

| Host | Mount | Supplies |
|------|-------|----------|
| `packages/frontend/src/debug/` | `mount.tsx` | route anonymisation, sheet + doc canvas locators via a surface registry |

```bash
pnpm --filter @wafflebase/debug-report test
pnpm --filter @wafflebase/debug-report typecheck
```
