# @wafflebase/debug-report

Framework-agnostic core for reporting a defect from the running screen: press a
hotkey, point at what is wrong, say it in one sentence, collect a few, hand them
over once. An agent drafts the issue text and proposes how the batch splits into
PRs; the reporter confirms; the pipeline verifies and lands it.

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

## What is not here

- **No React.** The overlay, the preview panel and the engine locators are the
  host's, and are added on top of this package rather than inside it.
- **No `dist`.** The package exports `./src/index.ts` and reaches consumers as
  source, the way `@wafflebase/design-editor` does, so it is not registered in
  `scripts/verify-dts-entries.mjs` (that gate checks the declaration graph of
  packages that publish a build).
- **No network, no model key.** Both are the host's, behind `HostAdapter`.

```bash
pnpm --filter @wafflebase/debug-report test
pnpm --filter @wafflebase/debug-report typecheck
```
