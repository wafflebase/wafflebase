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

Partially built. What exists today is the server-side mutation core plus the
types the editor UI consumes:

| Module | Role |
|--------|------|
| `src/server/jsx-nodes.mjs` | The JSX node model shared by the three modules below |
| `src/server/extract.mjs` | Reads component/token metadata out of source |
| `src/server/inject.mjs` | Writes an edit back into JSX or token source |
| `src/server/stamp.mjs` | Stamps rendered elements so a browser selection maps to a source node |
| `src/types.ts` | The `design-metadata.json` shape the sandbox reads (it never re-parses source in the browser) |

Not yet here: the Vite plugin entry, the `?wbFrame=` module-id transform, and
the three-pane editor shell. The package therefore declares no `exports` or
`main` — nothing imports it yet, and `pnpm verify:fast` covers it through
typecheck and its Vitest suites only.

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
