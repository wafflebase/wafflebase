# Path-scope the review lenses (#563 D1)

Deliverable 1 of #563 only. Behavior-preserving efficiency tuning: don't run a
review lens on a diff that touches nothing in its domain. No change to what the
pipeline *gates* on or to its fail-closed behavior.

## Why this is D1-only

#563 bundled three deliverables. D1 (lens scoping) is a data + test change the
autonomous agent can make. **D2 and D3 edit `.github/workflows/*.yml`, which the
agent structurally cannot push** — the App installation token has no `workflows`
scope, so any push touching those files is rejected wholesale.

The first attempt shipped all three in one PR, with D2/D3 committed as an
unapplied `.patch` file. The `design-fit` lens correctly reported the deliverable
as unimplemented on every round, the fixer had nothing it could legally do, and
the PR paged with an empty fix round. Splitting at the capability boundary is the
fix: D2/D3 moves to a separate human-pushed PR, and this one satisfies its scope
completely.

## Scope

- [x] `scripts/agent/lenses/lenses.json` — per-lens `appliesWhen` globs:
      - `correctness` → `["**"]` (always applies)
      - `security` → `["**"]` (never scope a blocking security gate away from
        root-level supply-chain/secret files: root `package.json`, lockfiles,
        `.npmrc`, `Dockerfile`)
      - `design-fit` → `["packages/**", "scripts/**", "docs/design/**"]`
      - `test-adequacy` → `["packages/**", "scripts/**"]`
- [x] `scripts/agent/review-panel.test.mjs` — cover the scoping **by reading the
      real manifest**, plus an explicit invariant test for the empty-required-set
      property.

## Design decisions

- **The test reads `lenses.json`; it does not restate it.** The first draft
  inlined the four glob sets as literals, so editing the manifest left the test
  green while the shipped behavior changed — the scoping was effectively
  untested. `test-adequacy` flagged exactly this, correctly. Verified by
  mutation: narrowing `correctness`, re-scoping `security` away from root files,
  and scoping every lens each make the suite fail.
- **The empty-required-set property is now asserted, not commented.**
  `agent-review-panel.yml` builds `required_checks` from the blocking lenses that
  *apply*, and `mark-ready.mjs` rejects an empty required set (exit 2) precisely
  because `[].every` is vacuously true — an empty set would satisfy the review
  gate with zero evidence. If every lens were narrowly scoped, a PR touching only
  an unclaimed path (`LICENSE`, `.gitignore`) would produce no required checks and
  dead-end the pipeline. The new test fails with that exact explanation.
- **`security` stays `["**"]`.** The first draft scoped it to
  `packages/**|scripts/**|.github/**`, which exempted root-level supply-chain and
  secret vectors from the blocking security gate. The panel caught it; reverted.
  Only the cheaper `design-fit` and `test-adequacy` lenses are scoped.

## Constraints (do NOT weaken)

- `correctness` stays `["**"]` + `samples: 2`.
- Fail-closed behavior, round cap + paging, trust model untouched.

## Verification

- `agent:tests` lane green (19 tests in `review-panel.test.mjs`).
- Mutation-tested: three independent manifest edits each fail the suite.
- `pnpm verify:self` green.

## Moved out of this PR

- **D2** (tighter fixer prompts) and **D3** (focused implement exploration) —
  separate PR, human-pushed, since both edit workflow YAML.
