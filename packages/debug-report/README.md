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

Four entry points, split by what each one is allowed to reach.

| Entry | Contents |
|-------|----------|
| `.` | `DebugItem` / `Target` / `Capture` / `Bundle` + `parseBundle` (`src/types.ts`, fail-closed, because a bundle crosses into a pipeline that can create commits); the session singleton (`src/session.ts` — no framework state, so collecting survives anything the app does to its render tree); the store (`src/store.ts` — blobs in IndexedDB, metadata in `localStorage`, a budget guard that evicts the oldest capture and names what it dropped, so an item outlives its capture); and the `HostAdapter` interface (`src/host.ts`) |
| `./react` | The overlay a person aims with, the preview panel they confirm in, and `createDevHost` — the adapter that talks to the plugin below. React is a peer dependency of this entry alone |
| `./plugin` | `debugReportPlugin({ repoRoot })`: the two dev-server endpoints, as a Vite plugin. `apply: "serve"`, so they cannot exist in a build, and it runs in Node — the model credential never reaches the browser |
| `./testing` | Helpers for a host testing its own wiring |

## Hosts

A host supplies a route, and optionally a canvas locator and a theme. Nothing
else. There are two, which is what makes the `HostAdapter` seam more than an
intention:

| Host | Mount | Route | Canvas locator | Theme |
|------|-------|-------|----------------|-------|
| The wafflebase app | `packages/frontend/src/debug/mount.tsx` | the anonymised URL path | sheet + doc locators | the document's |
| The design editor's scene frame | `packages/design-editor/src/scenes/debug-report-host.tsx` | `scene:<id>/<side>` | none — a scene is DOM, so a canvas becomes a region | the frame's `?theme=` |

## What is not here

- **No engine locators.** Only the mounted engine can say which cell a point is,
  so `locateOnCanvas` is an argument this package takes, never an import it
  makes. A host with no Canvas omits it and every canvas point becomes a region
  — the honest answer for a surface nothing can interrogate.
- **No React in the core.** `.` is free of it, so a host with its own UI — or
  none — can implement `HostAdapter` against the core and load none of the
  overlay. What the core never holds is the parts only an application knows: the
  route rules and the engine locators, which arrive as arguments.
- **No `dist`.** The package exports `./src/index.ts` and reaches consumers as
  source, the way `@wafflebase/design-editor` does, so it is not registered in
  `scripts/verify-dts-entries.mjs` (that gate checks the declaration graph of
  packages that publish a build).
- **No model key in the browser.** Drafting is a dev-server endpoint precisely
  so the credential is read in that process and never shipped to a page. The
  session is granted no tools and no project config (`allowedTools: []` with
  `settingSources: []`), because its input carries DOM excerpts from whatever was
  on screen — so the worst case of a prompt injection is a draft the reporter
  rejects. `@anthropic-ai/claude-agent-sdk` is an optional peer: without it,
  drafting reports `not-configured` and the panel falls back to the reporter's
  own sentences with one PR per item. The credential is
  `CLAUDE_CODE_OAUTH_TOKEN`, pooled across `_1` … `_8` so a drained one fails
  over instead of ending the batch.

```bash
pnpm --filter @wafflebase/debug-report test
pnpm --filter @wafflebase/debug-report typecheck
```
