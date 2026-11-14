# Move the Agent Arms out of scripts/agent — Lessons

- Look for imports in both directions before a move. One core module
  (`pick-fix-credential.mjs`) imported an arm, and the jobs run it from a
  staged copy of `scripts/agent` alone, so the move would have broken it only
  in CI, never in a local checkout.
- `createRequire(...).resolve` is not "resolve the way `import` does". It
  reads the `require` condition, and for zod that is the CommonJS build: a
  second module instance beside the one the SDK imports. Resolving from
  another directory with ESM conditions needs the `exports` walk done by
  hand, checked against Node's own resolver.
- A guard keyed on a path pattern (`node scripts/agent/x.mjs`) silently stops
  covering code that moves to a sibling directory. Widen the pattern in the
  same change, and prove it with a mutation.
- Renaming a workflow out of a glob also takes it out of every guard that
  enumerates that glob. Name it in the guard's list explicitly.
- A cross-check by example proves the cases it lists. Two copies of a list
  are kept alike by comparing the lists, not their verdicts on samples.
- Before re-implementing a resolver, look for a way to ask the real one.
  `module.registerHooks` lets one call be resolved from another directory
  with every rule of the running Node.
- A test that skips where CI runs it proves nothing in CI. Fixtures that
  need no install can carry the same claim.
