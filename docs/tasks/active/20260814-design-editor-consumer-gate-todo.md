# design-editor consumer gate

Part of #700. The fixture-project integration lane the local-plugin doc's §8
names as "the argument" for one, and the only thing that checks the pivot's
central claim: that the plugin works in a project that is not this one.

## Scope

| Path | What |
| --- | --- |
| `fixtures/consumer/` | a foreign project — its own layout, no `@wafflebase/*` dep, no adapter |
| `scripts/verify-consumer.mjs` | boots a real dev server there, 40 checks |

Not in `verify:fast` / `verify:self` — it boots a dev server, same as
`design-sandbox`'s `verify-tokens.mjs`.

## Why a second live-server script

`verify-tokens.mjs` drives the same chain but against **wafflebase**: the one
project the prototype was written around, with an adapter we also wrote. It
cannot fail the way a stranger's install fails. This one can, and did — see
below.

## What it found immediately

Booting with `cwd` alone is not enough. `pnpm exec` runs from the nearest
package root, so vite's root became `packages/design-editor`, it found no
config, **every plugin went unloaded, and the server answered 404 to the whole
bridge while starting cleanly**. Both are now explicit — the root as `vite dev`'s
positional argument (`--root` is build-only and the CLI rejects it) plus
`--config` — and the gate asserts `health.root`.

## Done when

- [ ] the fixture uses the DEFAULT adapter, not a bespoke one
- [ ] the gate covers read, preview, mutate, refuse and undo
- [ ] `--write` restores the fixture byte-identically
- [ ] the gate is proven to fail when the fixture is broken
- [ ] §8's open gap recorded as closed
