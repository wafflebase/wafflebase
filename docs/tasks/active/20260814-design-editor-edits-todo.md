# design-editor edit staging (PR 9b)

Part of #700. Follows 9a (#846). Adds `edits.ts` — the staged-edit model the
token and scene panels (PRs 10–12) are written against.

## Scope

One file: `src/client/edits.ts`, ported from the prototype's
`src/sandbox/edits.ts` (952 lines). It holds the staged-edit types, the
class/token/layout → intent translators, their inverses, and `saveDiff`.

## What the port changes, and why

| Prototype | Here |
| --- | --- |
| six intent interfaces (`ClassRewriteIntent`, …) | the shipped flat `MutateRequest` |
| `SEMANTIC_FILE` … `TYPOGRAPHY_FILE`, `FAMILY_META` | `TokenFamilyMeta[]` from `GET /tokens` |
| its own `camelToKebab` | the one in `tokens/adapter.ts` |
| `CSSProperties` | `Record<string, string>` — no React here |
| `VariantState` from `registry.tsx` | declared here; the registry is consumer code |

This closes §6's last open row: the client carries no token path.

## The defect the port found

Token value edits carried `file` and no `family`. The server ignores `file`
and defaults a missing `family` to `semantic`, so a **radius or typography
edit was planned against `semantic.ts`** — measured, both families:

```
radius     -> semantic.ts [light.lg]   located=false  property lg not found
typography -> semantic.ts [light.body] located=false  property body not found
```

Nothing is corrupted, but neither family could ever save. `toTokenIntent` now
sends `family` and no `file`.

## Done when

- [ ] no token path or naming rule compiled into client code
- [ ] every translator and inverse round-trips through `saveDiff`
- [ ] the ordering rule tested in both directions
- [ ] `family` regression covered
- [ ] §6 row and §8 row updated
