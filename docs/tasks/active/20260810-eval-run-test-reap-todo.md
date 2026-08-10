# Reap the processes `eval/run.test.mjs` spawns, and what measuring the CI failure ruled out

**Built at** `eee2a9ed4` (`main`, 2026-08-10). Measured on `ubuntu-latest` /
node 22.x, 100 lane iterations across two throwaway runs on a fork.

## Problem

`eval/run.test.mjs` drives the stub panel's `hang` + `spawnGrandchild` fixture,
which starts a process that **ignores SIGTERM** and holds a `setInterval` open
forever. The file asserted on the returned promise and then walked away: it had
no `after`, no `afterEach`, no `kill` of any kind, and it never read the
`stub-pids.json` that `stub-panel.mjs` writes for exactly this purpose. PR 6's
handoff flagged the missing cleanup; #716 added the fixture without adding it.

Measured cost of that: eight orphan SIGTERM-ignoring node processes accumulated
on one developer machine over ~20 local lane runs, one per run that exercised
the fixture. On a runner `reapLaneGroup` sweeps them after the lane, which is
why this has never shown up as a CI symptom.

## Goal

The file reaps what it spawns. Nothing about the CI failure below depends on
this being true, and it is worth doing anyway — that is the whole claim.

## Approach

- [x] `stubPids`, a file-scoped set, filled from the path `run.mjs` **prints**
      for a kept scratch directory, parsed out of the logs `runCli` already
      captures. Not by scanning `tmpdir()` for `eval-item-*`: sibling test files
      run concurrently and own scratch directories of their own, so a scan would
      reap a stub another file is still legitimately timing out against.
- [x] `after`, not `afterEach` — a per-test reap would kill a stub a later test
      is still timing out against and change what the timeout tests measure.
- [x] Group kill then bare pid, each in its own `try`, both tolerating `ESRCH`.
      SIGKILL, because SIGTERM is precisely what the fixture ignores.
- [x] `isReapablePid` refuses anything that is not an integer `> 1`. **`kill(-0)`
      signals the caller's own process group** — under the lane that is the test
      runner and every sibling file.

## Where the pids file actually is — corrected while building

The obvious implementation scans the store root. It finds nothing: `run.mjs`
creates the item's scratch directory with
`mkdtempSync(path.join(tmpdir(), "eval-item-"))` — **outside** the store — and
deletes it itself. A first version of this change scanned `root`, passed four
tests written against the reaper in isolation, and reaped nothing. The test that
caught it is the one that asserts the *wiring* rather than the reaper, and the
mutation that removes the wiring survived until it existed.

What makes the reap possible without touching a non-test file: a **failed** item's
scratch directory is deliberately kept, and its path printed — a hang is a failed
item.

## What the measurement ruled out, and why this PR claims nothing about CI

`agent:tests` fails on `main` roughly 30% of the time with
`Unable to deserialize cloned data`, always on `eval/run.test.mjs`, always as
`uncaughtException` inside the runner's own `#processRawBuffer`. This change was
proposed as the fix for it. It is not, and the arms say so:

| arm | what ran, ×20 | deserialize failures |
|---|---|---|
| A | `eval/run.test.mjs` **alone** | **0 / 20** |
| B | full glob (round 1) | 5 / 20 |
| B2 | full glob (round 2, control) | 6 / 20 |
| C | full glob, **grandchild removed entirely** | **5 / 20** |
| D | full glob, **with this reaper** | 2 / 20 |

- **C vs B2: p = 1.000** (Fisher exact). Deleting the SIGTERM-ignoring
  grandchild changes the failure rate not at all, so the grandchild is not the
  mechanism and reaping it cannot be the fix.
- **D vs pooled baseline (11/40): p = 0.19.** Consistent with chance. Claiming
  the reaper helps would need ~80 iterations per arm, and would still be a claim
  with no mechanism behind it.
- **A: 0/20** localises the fault to concurrency between test files, not to
  anything inside `run.test.mjs`.

Also ruled out, each with the measurement: node version (22.20.0 locally, 8/8
clean), raw `process.stdout.write` from `run.mjs` (node wraps it — the ticker
line arrives as a `#` diagnostic), any other `stdio: "inherit"` spawn under
`eval/`, and `--test-timeout` firing (`cancelled 0` in every failing run,
6.4s lane).

## Still open — not this PR

- [ ] **The deserialize failure is unexplained.** Surviving lead: the failing
      iterations report 1528–1541 tests where a green one reports 1543, so
      results are lost alongside the corruption. Next probe would bisect the
      glob to find which *concurrent* file's presence is required.
- [ ] Counts quoted from `agent:tests` between #692 (07 Aug 07:14Z) and #750
      (10 Aug 05:18Z) ran under `--test-force-exit` and could be short by up to
      58 tests. #752's 1468 → 1477 baseline is worth re-measuring.
