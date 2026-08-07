# A ceiling on the CI jobs, and a lane that ends instead of hanging

Two additive changes after **run `31073290840`** hung `verify-self` for 31.5 minutes
on 2026-08-06 and stopped only because a human cancelled it.

## The problem

`.github/workflows/ci.yml` sets **no `timeout-minutes` on any of its three jobs**, so
each inherits GitHub's default ceiling of **360 minutes**. The incident run was
cancelled by hand at 31.5 minutes; uncancelled it had five and a half more hours of
runner time available to it.

That omission is against the grain of this repository. Measured at `f2aabace6`:

| | |
|---|---|
| Workflows setting `timeout-minutes` | **12 of 15**, 32 occurrences |
| Workflows without it | `ci.yml`, `publish-ghpage.yml`, `npm-publish.yml` |
| Values already in use | 5 · 10 · 15 · 20 · 30 · 40 · 45 · 90 |

`agent-implement.yml` calls its 90 a *"hard cost/time ceiling"*. `ci.yml` is the
busiest workflow in the repository and is the only one of the three omissions that
has already demonstrated the failure the ceiling exists for.

### What the incident log actually shows

Run `31073290840`, branch `harness/eval-replay-runner`, head `94f8063a5`, read
directly:

- The lane started at `05:09:54.62` and printed TAP `ok 1` … **`ok 305`**.
- Its **last output was `05:09:56.88` — 2.3 seconds in.** Then 31 minutes of
  silence, then `##[error]The operation was canceled` at `05:40:58`.
- **No `1..N` plan line and no `# tests` / `# pass` summary was ever printed.**
- At teardown GitHub reported **six orphan processes**: `node`, `sh`, `node`, `sh`,
  `node`, `node`.

**The suite did not complete.** Checked out at `94f8063a5` and run locally, the same
lane prints **1180** top-level `ok` lines and a `# tests 1180` summary. CI printed
305 of them — **875 tests never reported.** The runner stalled a quarter of the way
through and stayed there.

That matters because it rules out the tidy reading. This was not "the suite finished
and the process would not exit"; something stopped mid-run. The log does not say
which of two mechanisms it was, and the change that caused it has been reverted, so
it never will. The two candidates are:

1. a test that **hung while running** — its file's process is alive and busy; or
2. a test file whose tests all **finished**, with a child process it spawned keeping
   that file's process alive, so the runner never learns those results.

The `node → sh → node` shape of the orphan list fits (2), and the truncated output
fits (1). Both flags ship because the evidence does not choose between them.

## The change

- [x] **`timeout-minutes` on all three `ci.yml` jobs.** Values below.
- [x] **`--test-timeout=60000` and `--test-force-exit` on the `agent:tests` lane**,
      both placed **before** `--test`.
- [x] **Each lane runs in its own process group, and is reaped when it ends.**
      Added in review: `--test-force-exit` ends the *runner* while a child a test
      spawned is still alive, so without this the orphan outlives the lane and runs
      alongside every later lane and the coverage steps after them. Ctrl-C is
      forwarded by hand, because a detached lane no longer sits in the terminal's
      foreground process group.

### Sizing `timeout-minutes`

Measured over the **198 completed `ci.yml` runs** from 2026-07-31 to 2026-08-06
(**195 job records per job, 188 of them successful**) — not one run:

| job | median | p95 | p99 | max (successful) | chosen | multiple |
|---|---|---|---|---|---|---|
| `verify-self` | 8.6 min | 9.1 | 9.3 | **9.3** | **20** | 2.2× |
| `verify-browser` | 6.5 min | 7.6 | 8.9 | **9.3** | **20** | 2.2× |
| `verify-integration` | 2.8 min | 3.0 | 3.6 | **4.4** | **10** | 2.3× |

The rule is **≥2× the worst run observed, rounded up to a value already in this
repository's vocabulary.** Two things make that margin comfortable rather than tight:
`verify-self`'s whole distribution is under a minute wide (median 8.6 → max 9.3), so
the headroom is enormous relative to the variance it must absorb; and the only
observation above 12 minutes in the entire window is the incident itself, at 31.6.

**Why not looser.** 30 would have stopped the incident at 30 minutes against the 31.5
it actually cost — a ceiling that expensive is barely a ceiling. **Why not tighter.**
A `timeout-minutes` trip fails the job, and a spurious red on a healthy run is worse
than the hang it guards, so nothing here is sized to the median.

`verify-integration` gets 10 rather than 20 because it is genuinely a third the
length, and a ceiling that could never bind is not a ceiling. Its Postgres service
and Yorkie container are inside the measured 4.4; the existing wait-for-port step
gives up after 30 s, so a stalled Yorkie already fails with a diagnosis long before
this.

### Sizing `--test-timeout`

`60000` ms, against these measurements:

- The whole `agent:tests` lane is **3.5 s in CI — 0.9%** of `verify-self`'s 412.3 s
  of lane time (`harness-reports/summary.json`, run `31075829558`). It is not the
  long pole; `verify:fast` is, at 297.8 s and **72.2%**.
- The **slowest single test** anywhere in the lane is **7.7 s**, measured on the
  slowest machine available (macOS, node 24, cold subprocess spawns — the same suite
  takes 3.5 s on a CI runner). It is a test that spawns the CLI as a child process.

So 60 s is **~8× the slowest legitimate test** and **~17× the entire lane**. That is
deliberately loose. A flaky timeout would be worse than the problem it fixes, and the
cost of the looseness is bounded: a genuinely hung test costs 60 s before it names
itself, inside a 20-minute job ceiling.

`--test-force-exit` takes no number.

### The flag placement, and why it is load-bearing

`eval/test-lane.test.mjs` reads the lane's command string back out of
`verify-self.mjs` and extracts glob patterns with:

```js
const args = /--test\s+(.+)$/.exec(cmd);
return args[1].split(/\s+/).map((p) => p.replace(/^['"]|['"]$/g, "")).filter(Boolean);
```

Everything after `--test ` is a pattern. Both arrangements were built and the
extractor run against each:

| arrangement | patterns extracted |
|---|---|
| `node --test-timeout=60000 --test-force-exit --test '**/*.test.mjs'` | `["**/*.test.mjs"]` |
| `node --test --test-timeout=60000 --test-force-exit '**/*.test.mjs'` | `["--test-timeout=60000","--test-force-exit","**/*.test.mjs"]` |

`--test` inside `--test-timeout` is not followed by whitespace, so the regex skips
past it and the chosen arrangement leaves the captured group byte-identical. Node
does not care about flag order; that extractor does.

## Corrected while building

**Three of the facts I was handed were wrong, one of them centrally — and two more
were my own, both caught in review.**

1. **"The suite completed and the process would not exit."** It did not complete —
   305 of 1180 tests, output stopping 2.3 s in. Everything downstream of that reading
   changes: `--test-timeout` is *not* obviously irrelevant to this incident, and
   `--test-force-exit` cannot be sold as the flag that addresses it. Neither can be
   claimed. Both ship because the log does not discriminate.
2. **`verify-browser` is not a 2–3 minute job.** It is 6.5 min median, 9.3 max —
   the same order as `verify-self`, and the widest spread of the three (+43% median
   to max, because it builds and runs a Playwright image). A timeout sized from the
   figure I was given would have been near-certain to trip.
3. **The set of `timeout-minutes` values in use includes 20 and 30**, which the
   handoff's list omitted. That is what let both chosen values come from the existing
   vocabulary instead of inventing a number.

**4. And my own claim about `--test-force-exit` was too strong** — caught in review
on #692, then measured. "The lane exits rather than hanging when a test leaks a
child" holds only when the leaked child does **not** hold the runner's stdout.
Spawned with `stdio: "inherit"`, the child keeps the test file's pipe open, the
runner never learns those tests finished, and `--test-force-exit` — which fires
"once all known tests have finished" — never fires. The runner does not exit at
all:

| leaked child | with both flags shipped |
|---|---|
| `stdio: "ignore"` | runner exits, lane returns in 0.8 s, orphan survives |
| `stdio: "inherit"` | runner **never exits**; lane still blocked at 25 s |

Both rows are the reason for the second half of this change. The first row is what
`reapLaneGroup` fixes: the lane returns, verify-self carries on into the build and
coverage lanes, and the orphan runs alongside them. The second row nothing here
fixes, and the doc now says so instead of implying otherwise — `timeout-minutes` is
the only bound on it, which is precisely why this PR is both halves.

**5. And the first version of the reap was in the wrong handler** — caught in the
next round of review on #692. It hung off `close`, which waits for the lane's
stdout and stderr to close; an orphan holding those pipes therefore prevented the
very cleanup meant to kill it. Reproduced before fixing: a lane that exits after
backgrounding a pipe-holding child left the orphan alive and the runner blocked
past 20 s, never reaching the next lane. So the reap covered the case where it was
optional and missed the case where it was load-bearing. It now hangs off `exit`,
and `close` only drains and resolves. Two review rounds, two versions of the same
mistake — assuming the process tree behaves the way the tidy story says.

**And the described trap is real but not test-enforced.** Putting the flags after
`--test` does corrupt the extracted pattern list — but `eval/test-lane.test.mjs`
still **passes**, because its assertions only require every eval suite to be matched
by *some* pattern; extra junk patterns fail nothing. Verified by building that
arrangement and running the test: 2 pass, 0 fail. The correct placement was kept
anyway, but "the test will catch it" is not true and should not be relied on.

## Fail directions

- **`timeout-minutes` trips on a healthy run** → the job goes red and CI reports a
  failure, which is the same signal any other CI failure produces and which
  `agent-iterate-ci.yml` already owns. It is loud and recoverable by re-running. The
  2.2× margin is what makes it unlikely, and the alternative failure — six hours of
  silent runner time — is the one with no signal at all.
- **`--test-timeout` fires on a slow-but-healthy test** → that test is cancelled and
  named, so the failure diagnoses itself rather than needing a bisect. 8× headroom
  over the slowest test measured.
- **`--test-force-exit` masks a leaked handle** → this is the real cost, and it is
  the direction chosen deliberately. The lane exits **green** on a leaked child
  rather than hanging, so a resource leak becomes invisible where it used to be
  visible-as-a-hang. Trading a 31-minute silence for a silent-but-correct pass is
  the right side of that trade for a gate that every PR waits on; it would be the
  wrong side for a leak detector, which this is not.
- **`--test-force-exit` does not fire at all** when the leaked child inherited the
  runner's stdout pipe (`stdio: "inherit"`). Then the test file's process never
  closes its pipe, the runner never learns those tests finished, and "once all
  known tests have finished" is never reached — so the lane hangs exactly as it
  does today. Measured, not assumed; see *Corrected while building*. Nothing in
  `verify-self.mjs` bounds this, and it is the reason the ceiling and the flags
  ship together rather than either alone.
- **The reap kills something a later lane needed** → it cannot: `reapLaneGroup`
  signals a lane's process group only *after* that lane's process has already
  exited, so the only members left are things the lane leaked. On a lane that
  leaks nothing the kill is an immediate `ESRCH`, swallowed, and no lane's status
  changes.
- **A leaked process outlives the whole runner** → it does not, on the paths the
  reap covers, and that is checked: a lane that orphans a child leaves nothing
  alive behind the run. (A killed orphan can still be visible to `pgrep` for a
  moment as a not-yet-reaped zombie; it holds no pipe and no CPU.) Ctrl-C is
  covered too — `detached` takes the lane out of the terminal's foreground group,
  so the signal is forwarded by hand. Both are mutation-tested below.
- **The orphan holds the lane's stdout, so the reap never runs** → this is why the
  reap hangs off `exit` rather than `close`. `close` waits for the lane's stdout
  and stderr to close, and an orphan that inherited those pipes holds them open,
  so a reap placed in `close` cannot run in the one case that most needs it. That
  is not hypothetical: with the reap in `close`, a lane that exits after
  backgrounding a pipe-holding child left the runner blocked past 15 s, never
  reaching the next lane, orphan alive. Moving it to `exit` closes those pipes,
  which is what lets `close` arrive. Tail output is unaffected — bytes already in
  the pipe are still drained after the writer dies.
- **A hang the flags do not reach** (the runner itself wedges before any test starts,
  or `verify:fast` hangs rather than `agent:tests`) → unchanged by the lane flags,
  bounded by `timeout-minutes`. That is the whole reason both halves ship together.

## Explicit non-goals

- **No `concurrency` block on `ci.yml`.** Considered and deliberately excluded.
  `agent-review-panel.yml` subscribes to this workflow's lifecycle with
  `types: [requested, completed]`, and its own concurrency group is postmortem-driven
  (#605: two panels, contradictory verdicts; #648: two fixers on one branch for 21
  minutes) with a partition pinned by `checks.test.mjs` across all four
  event/attempt combinations. Cancelling CI runs changes the event sequence that
  design consumes. It needs its own argument and its own PR.
  A `timeout-minutes` trip does **not** raise that question: it concludes the run
  `failure`, which is a conclusion the panel's `ci` job already handles (`decide()`
  returns `skip` for any non-success), not `cancelled`.
- **No timeouts on `publish-ghpage.yml` or `npm-publish.yml`.** Defensible, different
  argument, different PR.
- **No attempt to fix the original hang.** The change is reverted and gone. This makes
  the *next* one end; it does not chase this one.
- **No change to what any lane runs, or to the lane list.** `eval/test-lane.test.mjs`
  is untouched — the lane keeps satisfying it as written.

## Verification

- [x] **`eval/test-lane.test.mjs` passes unmodified** — 2 tests, 2 pass, 0 fail;
      file byte-identical to `upstream/main` (`diff` clean).
- [x] **Lane green against a measured baseline.** Re-measured on the branch after
      it was updated from `main` (the suite keeps growing; the figures below
      supersede the 1118 measured at `f2aabace6`). Pre-PR lane command:
      **1331 tests, 1325 pass, 0 fail, 6 skipped.** With both flags: **1331 /
      1325 / 0 / 6.** With the flags and the reap: **1331 / 1325 / 0 / 6** —
      identical counts, and 25.5–26.1 s across the three, no measurable cost. The 6 skips are the expected pair of causes with
      no root `node_modules`: 5 from `lint-config.test.mjs` without a root
      `eslint`, 1 from the Agent SDK not being installed.
- [x] **Both flags proven, on both failure modes, in one run matching the incident's
      multi-file shape** (four healthy files, one hanging test, one file that passes
      and leaks a live child). Scaffolding removed afterwards; it is not in the diff.

  | flags | result |
  |---|---|
  | neither (today's lane) | 8 of 12 tests printed, **no summary**, still running at 45 s, orphan tree `node → node → sleep` |
  | `--test-timeout` only | names the hang, then **still running at 40 s** on the leaked child |
  | `--test-force-exit` only | **still running at 40 s** — a hung test never "finishes", so it never fires |
  | **both** | exits **1** in **10 s**, full summary, hung test named with file and line |

  The named failure, verbatim:

  ```
  ✖ hangs-mid-test: never settles (8002.124542ms)
  test at sub/hangs-mid-test.test.mjs:2:1
    'test timed out after 8000ms'
  ```

  (8000 ms as a short stand-in for the shipped 60000, so the demo runs in
  seconds. The mechanism is identical.)
- [x] **The incident reproduced**, including its process tree: `node --test` orphaned
      at `ppid=1` with two file-runner children, one holding a live `sleep`. That is
      the CI orphan list (`node`, `sh`, `node`, `sh`, `node`, `node`) minus
      `verify-self.mjs`'s own node and the `sh -c` it wraps each lane in.
- [x] **The lane reap, end to end through the real `verify-self.mjs`**, driven by
      synthetic lanes so every branch is reachable: stdout and stderr still
      captured, exit code 7 still recorded with its `failureSummary`, the lane
      after a failure still skipped, the runner still exits 1. A lane that
      orphans a child shows **1** live child during the lane and the run leaves
      nothing behind. Checked for both orphan shapes: one whose stdio is off the
      lane's pipes, and one still **holding** them — the second used to block the
      runner indefinitely and now completes, with the next lane reached and the
      failing lane's tail output still captured in its `failureSummary`.
- [x] **Mutation-tested, all three parts** — each was broken in turn and the check
      that protects it failed with the right symptom:

  | mutation | symptom |
  |---|---|
  | drop `reapLaneGroup(pid)` | orphan survives into the next lane (`sleeps-next-lane:1`) |
  | `detached: false` | orphan survives — the lane's pid is not a group id, so the signal lands on nothing |
  | drop the SIGINT/SIGTERM forwarding | Ctrl-C exits the runner and **leaves the lane running** |
  | reap from `close` instead of `exit` | runner blocks past 15 s, never reaches the next lane, orphan alive |
- [x] **The `stdio: "inherit"` case reproduced**, which is what makes the claim
      above measured rather than argued: with both flags shipped, the runner is
      still alive at 25 s and never printed a summary.
- [x] **`npx eslint scripts` exits 0**, at the lockfile-pinned `eslint@9.24.0` —
      **and exits 0 on `upstream/main` too**, so the 0 means something.
- [x] **`actionlint` 1.7.7 clean** on `ci.yml`, before and after.
- [x] **Verified from the committed tree** (`git archive <branch> | tar -x`), not a
      working copy.
- [ ] **Not verified: the values are correct for a runner slower than any observed.**
      They are 2.2–2.3× the worst of 188 successful runs over six days. A GitHub
      capacity event outside that envelope would trip them. That is the accepted
      risk of having a ceiling at all, and the reason none of the three is sized
      near the median.
- [ ] **Not verified in CI.** Everything above is local plus the API. The first real
      evidence is this PR's own `ci.yml` run.
