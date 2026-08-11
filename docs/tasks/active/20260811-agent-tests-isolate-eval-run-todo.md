# Run `eval/run.test.mjs` in its own process, and what 300 CI runs ruled out

**Built at** `7dbeb61ce`. All measurement on `ubuntu-latest`, node 22.x unless
stated, on a fork, free.

## Problem

Since #750 removed `--test-force-exit`, the `agent:tests` lane has been failing
intermittently with:

```
not ok N - eval/run.test.mjs
  failureType: 'uncaughtException'
  error: 'Unable to deserialize cloned data due to invalid or unsupported version.'
  #processRawBuffer (node:internal/test_runner/runner:354:20)
```

Thrown by the RUNNER, never by a test: a partial frame on the v8-serialized
channel a test file reports its results over. It always takes some of that file's
trailing tests with it, so a corrupted run also reports SHORT — 1604 or 1592
where a clean one reports 1611. It has hit #736, #742 (×2), #740 (×2), `main`
itself, and #758, whose author had nothing to do with the eval harness.

## Goal

The lane stops flaking, without hiding anything. Explicitly not "make CI green" —
`--test-force-exit` already did that, by losing up to 58 tests silently.

## What was measured

300 lane runs across five throwaway CI runs.

| arm | n | deserialize failures |
|---|---|---|
| `eval/run.test.mjs` alone | 20 | **0** |
| full glob, before #760 | 40 | 11 (27.5%) |
| full glob, grandchild deleted outright | 20 | 5 |
| full glob, after #760's reaper | 60 | 6 (10%) |
| full glob, `--test-concurrency=1` | 20 | 1 |
| full glob, **node 24** | 40 | 4 |
| **isolated, incl. the shipped lane** | **100** | **0** |

- **Isolation works: 0/100 vs 6/60, p = 0.0024.**
- **Not a node bug to wait out.** node 22 5/40 vs node 24 4/40, p = 1.000.
- **Not concurrency.** `--test-concurrency=1` still fails, and doubles the lane.
- **Not memory or the timeout.** `cancelled 0` every time, no kernel OOM line,
  10.9 GB free — and corrupted runs finish EARLY (6.7s against a 9.6s median),
  which is a process that stopped, not one that struggled.
- **#760 helped and was under-claimed.** Its PR body said the reaper does not fix
  this, which was honest at n=20; across 40 more runs it cuts 27.5% → 7.5%,
  p = 0.037. It is not sufficient on its own.

## The fix

The lane invokes `node --test` twice: everything except `eval/run.test.mjs`, then
that file alone. `find` rather than a second glob because node's `--test` has no
exclusion syntax, and an enumerated list would silently stop covering a file
added later — the exact failure `eval/test-lane.test.mjs` exists to prevent.

**This is a mitigation, not a diagnosis. Nobody knows why sharing a runner with
the rest of the suite corrupts that file's channel.** It is written so that being
wrong about the cause costs nothing: no test is skipped, no result is dropped,
and the two invocations report the same total one invocation does — 1556 + 55 =
1611 at `7dbeb61ce`, 1614 at the PR head. The figure moves with every test added;
the EQUALITY is the claim. Cost: +5s on a lane that is 0.9% of `verify-self`.

## Corrected while building

- The first version stripped `./` with `sed 's|^\./||'`. The guard test reads the
  lane out of SOURCE TEXT, so the backslash arrived still escaped for JavaScript
  and the test expanded a *different* command than CI would run — it failed, which
  is how this was caught. Fixed twice over: the lane uses `cut -c3-` (no escape at
  all), and the test now `JSON.parse`s what it reads.
- Two mutations survived the first pass and are now caught: dropping the
  `node_modules` prune (the old assertion was vacuous on a checkout that never ran
  `npm ci` in `scripts/agent`, so the test now plants a file there), and removing
  `--test-timeout` from one of the two invocations.
- **The prune itself was wrong, and review caught it.** `! -path './node_modules/*'`
  excludes only the TOP-LEVEL install, so a nested `node_modules` anywhere under
  `scripts/agent` would still have its vendored suites run — and the probe was
  planted top-level, so the guard passed anyway. Now `-type d -name node_modules
  -prune`, with probes in BOTH a top-level and a nested `node_modules`; reverting
  to the old filter is a caught mutation. On a clean checkout both forms return the
  same 57 files, so the prune drops only vendored paths.
- Coverage widened from `eval/` to all of `scripts/agent`: the first invocation now
  enumerates the whole package, so a file dropped anywhere is the silent skip this
  guard exists to prevent.

## Still open — not this PR

- [ ] **The cause is unknown.** Surviving lead: the file dies mid-stream and
      early, always this file, only when other files have run in the same
      invocation. Worth bisecting *which* other file's presence is required.
- [ ] **`extractFailureSummary` in `verify-self.mjs` names the wrong test.** It
      returns the first line matching `/\b(FAIL|ERROR|error|Error|✗|✘|FAILED)\b/`,
      so on #758 it reported `classifyResult: distinguishes verdict / api-error /
      no-output at its new home` — a test that PASSED (`ok 29`), matched on
      `api-error` in its own name, 2,600 lines before the real failure. Every
      `agent:tests` failure since #578 has carried a wrong summary. Fix is to
      parse the TAP the runner already emits.
- [ ] `STATE.md` records #760 as "closes the failure". It did not; #758 is the
      counter-example.
