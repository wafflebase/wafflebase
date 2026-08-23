# Pin mark-ready.mjs's exit-code contract with a test (#852)

## Problem

`scripts/agent/mark-ready.mjs` communicates its whole outcome through its exit
code, and the `promote` job in `agent-review-panel.yml` branches on every value
of it:

| Code | Meaning | Consumer |
|---|---|---|
| 0 | promoted, or deliberately left as draft | `ready=true` output |
| 1 | a gate failed — "leaving as draft", job SUCCEEDS | `agent-review-panel.yml:1399` |
| 2 | tooling error | `if [ "$code" -eq 2 ]` → `exit 2` |
| 3 | gates passed but the flip-to-ready failed | `if [ "$code" -eq 3 ]` → `exit 3`, pages a human |

There is no `mark-ready.test.mjs`, so nothing pins that mapping. Codes 0 and 1
both let the job succeed, so a refactor that collapsed 1 into 0 — or renumbered
2/3 — would leave every existing test green while a PR that should have merged
sat as a draft forever.

## Approach

`mark-ready.mjs` runs its CLI at import time (`process.exit` at top level), so
a test cannot import it — the same constraint that pushed `DEFAULT_REVIEW_CHECKS`
into `checks.mjs` and `HANDOFF_MARKER` into `disclosure.mjs`. So test it as a
process: spawn `node mark-ready.mjs` with a **stub `gh`** first on `PATH` and
assert the exit code.

The stub is a small node script the test writes into a temp dir. It is driven by
a JSON config (`GH_STUB_CONFIG`): PR JSON, CI workflow runs, check runs, and a
list of argv prefixes that must fail. Every invocation is appended to
`GH_STUB_LOG`, so a test can also assert *which* `gh` calls happened — e.g. that
an exit-0 promotion really did call `pr ready`, and that a dry run did not.

No production code changes. `mark-ready.mjs` is left exactly as it is; the
point of the issue is that its current behavior is unpinned, not wrong.

Second half of the contract: the consumer. A test reads the real
`agent-review-panel.yml` promote step and asserts it still branches on 2, 3, 1
and 0, so renumbering the script without renumbering the workflow (or vice
versa) fails the lane.

## Steps

- [x] `scripts/agent/mark-ready.test.mjs`: stub-`gh` harness + one test per
      exit-code site (2 × usage/empty-checks/read-failure, 1 × gate failure,
      0 × dry-run/already-ready/promoted, 3 × flip failure).
- [x] Pin the best-effort sites: a failing label PUT or hand-off comment must
      still exit 0 (they are explicitly best-effort in the script).
- [x] Pin the workflow consumer's branch table against the real yml.
- [x] Self review + draft PR.

## Acceptance criteria (from #852)

- A `mark-ready.test.mjs` exists and pins the code→meaning mapping for all four
  exit codes, at every site that produces them (3 × `2`, 1 × `1`, 1 × `3`,
  2 × `0`).
- Collapsing 1 into 0, or renumbering 2/3, fails the test.
