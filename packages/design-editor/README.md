# @wafflebase/design-editor

Dev-only design-system editor: a Vite plugin that renders a project's **real**
routes and writes edits back into its JSX and design-token source. It is a
development tool, never bundled into a production build and never shipped to
users.

The package is deliberately generic — it holds no wafflebase-specific
knowledge. Everything project-shaped (the four-file `@wafflebase/core` token
pipeline, route discovery) reaches it through configuration and a
`TokenAdapter` seam.

## Status

Partially built: the server side is complete, the editor UI is not.

**The mutation core** — reads and writes source, and is the published API the
rest depends on:

| Module | Role |
|--------|------|
| `src/server/jsx-nodes.mjs` | The JSX node model shared by the three modules below |
| `src/server/extract.mjs` | Reads component/token metadata out of source |
| `src/server/inject.mjs` | Writes an edit back into JSX or token source |
| `src/server/stamp.mjs` | Stamps rendered elements so a browser selection maps to a source node |
| `src/types.ts` | The `design-metadata.json` shape the editor reads (it never re-parses source in the browser) |

**The plugin** — `designEditor(options)` over a configurable root:

| Module | Role |
|--------|------|
| `src/plugin/index.ts` | The entry point and whole public surface; returns an array of Vite plugins |
| `src/plugin/options.ts` | The configuration surface: `root`, `scenes`, `providers`, `opaqueRoots`, `tokens` |
| `src/plugin/paths.ts` | The write boundary — every browser-supplied path resolves or is refused here |
| `src/plugin/bridge.ts` | The HTTP endpoints (`serve` only; a build-time counterpart would edit a repo from CI) |
| `src/plugin/frame.ts`, `scene-patch.ts` | The `?wbFrame=` module-id machinery and staged-plan patching |
| `src/plugin/scenes.ts`, `shell.ts`, `safelist.ts`, `tracked.ts`, `transactions.ts` | Scene registry, prebuilt-shell middleware, Tailwind candidate registry, external-change tracking, undo/redo |
| `src/plugin/tokens.ts` | Wire ⇄ `TokenAdapter` translation, and the CSS-regen gate |

**The token seam** — how a project's own token pipeline plugs in:

| Module | Role |
|--------|------|
| `src/tokens/adapter.ts` | The `TokenAdapter` contract. Imports nothing from `src/plugin/`, so an adapter is written against the contract rather than the bridge's request shape |
| `src/tokens/css-variables.ts` | `cssVariables()` — the default adapter, for tokens kept as CSS custom properties in one stylesheet. Covers the shadcn case |
| `src/tokens/css-decls.ts` | Reading and writing `:root` / `.dark` declarations |

Not yet here: the three-pane editor shell and the scene runtime, both of which
PRs 10–12 build. The second implementation of the token seam does now exist —
[`packages/design-sandbox`](../design-sandbox/README.md) holds wafflebase's own
four-file `@wafflebase/core` adapter, and is the first consumer of this package.

## Usage

Wired up for real in [`packages/design-sandbox/vite.config.ts`](../design-sandbox/vite.config.ts),
which is the shape a consumer writes:

```ts
// consumer's vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { designEditor, cssVariables } from '@wafflebase/design-editor';

export default defineConfig({
  plugins: [
    react(),
    designEditor({
      root: process.cwd(),              // the write boundary
      scenes: 'design/scenes.json',     // which routes are editable
      providers: 'design/providers.tsx',
      tokens: cssVariables({ stylesheet: 'src/index.css' }),
    }),
  ],
});
```

Paths are root-relative and written without a leading `./`, which is the form the
plugin compares against internally. `cssVariables` normalises `./src/index.css` for
you; the other options are resolved against `root` either way.

Omit `tokens` and the token endpoints report `adapter: null` rather than failing —
the layout half needs only React, Vite and JSX.

### The one optional peer: reporting a defect from a scene

The scene frame can host `@wafflebase/debug-report` — press `Mod+Shift+Y` inside a
scene, point at what is wrong, say it in one sentence. Add both halves to arm it:
`debugReportPlugin({ repoRoot })` in the same `vite.config.ts`, and
`VITE_WB_DEBUG_REPORT=1` in the environment the dev server starts in.

Neither is required. `@wafflebase/debug-report` is an **optional** peer, and
`src/scenes/debug-report.tsx` reaches the mount through `React.lazy`, so a frame
that was not armed never resolves the specifier — a project that does not install
the reporter is unaffected rather than broken at frame load.

The editor shell at `/__design-editor/` is not built yet, so it 404s with a
"was the package built?" message. The bridge underneath it works:
`/__design-editor/api/{health,tokens,preview-tokens,mutate,validate,commit,undo,redo}`.

### Consuming it from source, and why that needs a build before publishing

`exports` points at **TypeScript source**, because the package is `private: true`
with no build step. That works for a Vite config or vitest, and it took two
findings to get there — both worth knowing before changing an import in this
package:

- **Relative imports carry explicit `.ts` extensions.** A Vite config that
  imports this package is handed to Node as TypeScript (a pnpm workspace link
  resolves inside `node_modules`, so the config bundler externalizes it and
  Node's own type stripping loads the `.ts`). Node ESM requires real extensions,
  so extensionless `./options` made the consumer's dev server fail to start
  outright. Hence `allowImportingTsExtensions` in `tsconfig.json` — and a
  TypeScript consumer inherits that flag while consumption is source-based.
- **`--configLoader runner` is not the alternative.** It loads the config and
  then closes the module runner, so every deferred dynamic import in
  config-loaded code fails at request time — including this package's own lazy
  `import('../server/inject.mjs')`. Measured: `/health` answered while `/tokens`
  and `/mutate` both returned `Vite module runner has been closed`.

Publishing needs `dist/` with `.js` specifiers, which also drops the
`allowImportingTsExtensions` requirement from consumers. `allowImportingTsExtensions`
forbids emit, so that build must be a bundler (esbuild/tsup/rollup, all of which
resolve `.ts` specifiers) rather than a bare `tsc` emit.

## Development

```bash
pnpm --filter @wafflebase/design-editor typecheck
pnpm --filter @wafflebase/design-editor test
```

## Further Reading

- [design-editor-local-plugin.md](../../docs/design/design-editor/design-editor-local-plugin.md)
  — **start here.** The local-plugin pivot, the package boundary, the support
  matrix, and the PR rollout order.
- [design-editor-engine.md](../../docs/design/design-editor/design-editor-engine.md)
  — the mutation bridge, AST mutator, and Vite integration these modules
  implement.
- [design-editor-sandbox-recipe.md](../../docs/design/design-editor/design-editor-sandbox-recipe.md)
  — the editor UI those types serve.
