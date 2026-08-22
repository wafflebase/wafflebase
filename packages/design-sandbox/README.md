# @wafflebase/design-sandbox

Wafflebase's own instance of the design editor. **Private, never published.**

[`@wafflebase/design-editor`](../design-editor/README.md) is the generic half — a
Vite plugin that renders a project's real routes and writes edits back into its
source. This package is the other half: everything about that editor which is
specific to *this* repository, kept here so the plugin can hold none of it.

The dependency runs one way only — `design-sandbox` → `design-editor`, never the
reverse — and nothing under `packages/frontend` imports either. That direction is
the boundary's mechanical test: the published package declares no
`@wafflebase/*` dependency, so a reversal fails `pnpm install` in a consumer
project rather than having to be caught in review.

## What is here

| File | Role |
|------|------|
| `src/tokens/core-adapter.ts` | `wafflebaseCore()` — the `TokenAdapter` for the four-file `@wafflebase/core` pipeline |
| `src/tokens/preview-worker.ts` | The warm `tsx` child that renders the variable map from patched token sources |
| `scenes.config.json` | Which of wafflebase's routes are editable, and what each needs mocked |
| `vite.config.ts` | The consumer config: `designEditor({ root, scenes, opaqueRoots, tokens })` |
| `scripts/verify-tokens.mjs` | The token pipeline against a live dev server |

`wafflebaseCore()` is the reason the `TokenAdapter` seam exists at all. Its
pipeline is the complicated one: a token lives in a TypeScript const, its value
may be an expression rather than a literal, creating one is a coordinated write
across **three** files, and the CSS the app serves is generated rather than
authored — so a preview has to run the real emitter and a save has to re-run it.
The default `cssVariables()` adapter covers the ordinary case (custom properties
in one stylesheet) in a fraction of the code.

## What is not here yet

One scene. `pdf-viewer` is `deferred` — the flag keeps its entry and its curation
notes while generating no loader for a scene that cannot mount. The other ten
render: the scene runtime (`providers.tsx`, the fixtures, the offline Yorkie shim,
the canvas seeds and the aliases that serve them) landed across PRs 11c–13.

The editor has no isolated component preview, and that is a decision rather than a
gap — see 13d in [the plan](../../docs/design/design-editor/design-editor-local-plugin.md).
A staged *class* edit previews live, like a token edit does — `POST /plan` publishes
it and the frame re-serves the patched module. See `design-editor-engine.md` §3.9 for
why it patches a module rather than pushing an override.

## Commands

```bash
pnpm --filter @wafflebase/design-sandbox typecheck
pnpm --filter @wafflebase/design-sandbox test

# The token pipeline end to end, against a real dev server.
# Writes nothing; --write adds one real save + undo and checks the tree came back.
pnpm --filter @wafflebase/design-sandbox verify:tokens
pnpm --filter @wafflebase/design-sandbox verify:tokens --write

pnpm --filter @wafflebase/design-sandbox dev   # bridge on /__design-editor/api/*
```

`typecheck` and `test` run in `pnpm verify:fast` and in `verify:self`'s
`design-sandbox:check` lane. `verify:tokens` does not: it boots a dev server and
spawns two child processes, so it is a deliberate, manual gate — the same call
the prototype's smoke scripts made.

## Further Reading

- [design-editor-local-plugin.md](../../docs/design/design-editor/design-editor-local-plugin.md)
  — §2 for the three populations and this package's place in them, §4 for why the
  `TokenAdapter` seam is shaped the way it is, §6 for the couplings that became
  configuration.
