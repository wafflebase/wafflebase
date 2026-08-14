# Lint the agent control plane

Follow-up to the #657 review. The panel found an undeclared identifier; this
closes the class.

## The gap

`verify:fast` lints `packages/frontend` and nothing else. `scripts/**` — ~30
modules that decide whether a PR may merge — had **no static analysis at all**.
The only check between a typo and `main` was `node --test`, over whatever paths a
test happens to reach.

#657 shipped `retryAt`, an undeclared identifier on the round-cap page path. No
test exercises that page, so **CI was green** and the guard would have thrown a
`ReferenceError` exactly when it was meant to latch a PR. The review panel caught
it — the expensive way to catch a typo.

## The change

- [x] `eslint.config.mjs` at the repo root, scoped to `scripts/**/*.mjs`.
- [x] `js.configs.recommended` + Node globals; `no-unused-vars` re-configured to
      honour the codebase's `^_` "positional parameter" convention.
- [x] `lint:scripts` wired **first** in `verify:fast`, so a typo fails in ~1s
      instead of after the build chain.
- [x] `eslint` / `@eslint/js` / `globals` as **root devDependencies**, matching the
      versions `packages/frontend` already pins.
- [x] Ten pre-existing violations fixed (below).
- [x] `pnpm verify:self` green (11/11); 655 agent tests.

## Three shape decisions

**`js.configs.recommended`, not a hand-picked list.** The whole directory produced
ten violations against the full baseline. A curated subset has to justify each
omission, and the omissions are where the next silent bug lives.

**Rooted at the top level, not in `scripts/agent/`.** That directory is an
npm-managed island: the `deps` job `npm ci`s it and uploads the tree as an artifact
on *every* panel run. Adding a linter there would bloat that artifact for a check
that never runs in that job.

**Declared, not borrowed.** ESLint 9 was already resolvable via pnpm hoisting from
`packages/frontend` — but `globals` was not, and hoisting is not a contract. The
failure mode of relying on it is this lint silently not running, which is the exact
shape of the gap being closed.

## The violations

Eight dead bindings and two redundant regex escapes — all pre-existing:

| file | what |
|---|---|
| `hunt.mjs` | unused `readdirSync`, unused `HUNT_WORKSPACE_VAR`, unused `probeCount` |
| `hunt.test.mjs`, `hunt-corpus.test.mjs` | unused `readFileSync` imports |
| `prior-findings.test.mjs` | unused `isCheckRuns` |
| `review-panel.test.mjs` | literal 4-space run in a regex → `{4}` |
| `hunt-probe.mjs` | `\/` inside a character class |
| `scripts/verify-entropy.mjs` | `\-` at the end of a character class |

Both regex edits were checked for behavioural identity before changing them — one
is a shell-argument allowlist and the other is the doc-staleness matcher, so
"looks equivalent" was not good enough.

## The config lints itself

`scripts/agent/lint-config.test.mjs` asserts on the **resolved** rule set.

Not belt-and-braces: the first version of the config spread
`js.configs.recommended` and then set `rules` for one override — which **replaced**
the recommended set and left `no-undef` disabled. `eslint scripts` still exited 0.
Caught by re-introducing #657's bug and watching the lint stay green.

**A config that lints nothing reports success**, so the test checks `no-undef` is
`error` and that every upstream recommended rule survives the override — which also
means a future ESLint release adding a recommended rule is inherited rather than
quietly missed. Mutation-tested: removing the spread fails two assertions.

## Verified, not assumed

- [x] `no-undef` fires on #657's exact bug shape, reproduced on this branch:
      `215:79  error  'retryAt' is not defined  no-undef`.
- [x] `eslint scripts` exits 0 across all of `scripts/`.
- [x] All 655 agent tests still pass after the dead-code removal.

## Not in this PR

Type-checking the agent scripts (JSDoc + `tsc --checkJs`), which would catch a
different and larger class — wrong argument shapes, misspelled properties. Much
bigger blast radius; worth its own decision.
