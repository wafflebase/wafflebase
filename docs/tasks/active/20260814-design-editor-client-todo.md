# design-editor client (PR 9a)

Part of #700. Follows 8c (#839). Adds the browser half of the plugin:
`@wafflebase/design-editor/client`.

## Scope

| File | Origin |
| --- | --- |
| `src/client/bridge.ts` | rewrite of the prototype's `mutate.ts` |
| `src/client/states.ts` | port, unchanged |
| `src/client/property-labels.ts` | port, unchanged |
| `src/base.ts` | `BASE` moved out of `plugin/shell.ts` |

`bridge.ts` is a rewrite, not a port. The prototype called `/__design-sdk/*` and four
routes the shipped bridge does not have: `/introspect` (now `/tokens`), `/history`
(now `/transactions`), `/metadata` and `/scene-preview` (scene runtime, PR 10). It
also redeclared the intent and result types the server owns; the client imports them.

`BASE` moved because the client needs it and `plugin/shell.ts` imports `node:fs`.

## Deferred, with reasons

| File | Why not here |
| --- | --- |
| `candidates.ts` | needs React, which this package does not depend on, and has no consumer until PR 10 |
| `toast.tsx` | the design doc's own table files it under Shell UI, not Bridge client |
| `registry.tsx` | hardcodes wafflebase's `Button`/`Badge` via `@/components/ui/*` — a consumer artifact, like `providers.tsx` in 8c |

## Done when

- [ ] `/client` export subpath, no `node:` reachable from it
- [ ] tests for the client's failure paths and the state parser
- [ ] client verified against a live dev server, not only mocks
- [ ] design doc §8 row + the three scope corrections recorded
