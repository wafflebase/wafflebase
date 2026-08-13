---
title: eval scoring lane
target-version: 0.2.0
---

# The free scoring lane — `eval-score.yml` and `score-all.mjs`

## The problem

The eval store holds 21 replay envelopes and five merged scorers can read them, but the
sequence that turns those envelopes into a report existed only as a shell script on one
laptop. Two consequences, and the second is the one that matters:

1. **Nobody else can re-run it.** The scorers are merged and documented; the *order*, the
   five different ways they name a replicate, and the six `--persist` calls that file
   their payloads were not written down anywhere a second person could execute.
2. **Every degradation in that sequence is silent.** Measured while building this, on the
   real modules:

   | what goes wrong | what the laptop script did | what it looks like afterwards |
   |---|---|---|
   | a CodeRabbit endpoint 403s or 429s | logged one line, scored on | a complete, plausible, **smaller** arm |
   | an opt-in scorer flag is renamed | nothing at all — `parseArgs` drops unknown flags | a payload with an empty half and a reason string |
   | a scorer exits non-zero mid-sequence | later steps ran anyway | four scores filed out of five |
   | the render finds a score missing | printed a section reading "not computed" | a report quotable as the whole comparison |

   None of those four produce a non-zero exit code, and three of them file a number into
   permanent history that reads exactly like a correct one.

`report.mjs` deliberately carries no `generated_at`, so two renders of one dataset are
byte-identical — which makes a re-score diffable, and makes "nothing changed" the ordinary
outcome of an automated pass rather than a failure.

## The change

**`scripts/agent/eval/score-all.mjs`** — the six steps as one command, and the assertions
around them:

- fans one comma-separated `--runs` out to the five scorers' three different conventions
  (`--run` singular for `volume-mix.mjs`, which does not aggregate; `--runs` for
  `cost-latency.mjs`, because `runs/` is never globbed; repeatable `--run-id` for the other
  three);
- **preflights the API budget** off a real response's `X-RateLimit-*` headers and refuses
  rather than meeting the limit half way through;
- **refuses on any degradation marker** in a scorer's stderr — the adapter's own
  "absent, not empty" lines, turned from a log into a failure;
- **probes each opt-in capability flag out of the scorer's own usage text** and attaches an
  obligation to both outcomes;
- **asserts the panel latency figure is present** in the `cost-latency-v1` payload, by
  shape and never by value;
- reads each filed score back through `getScore`, so a filing the renderer cannot find is
  a failure rather than a log line;
- propagates `report.mjs`'s exit code, which is already non-zero when a section's input is
  absent;
- emits the **explicit path list** the commit step stages.

**`.github/workflows/eval-score.yml`** — `workflow_dispatch` plus a weekly schedule, one
job, `permissions: {}` at the top with four job-level *read* scopes, and a commit step that
stages by explicit path, checks the staged set back against that list, reports an empty diff
as success, and stops before the commit on a dry run.

**`scripts/agent/eval/score-all.test.mjs`** — 38 tests, all of them about a refusal or a
coupling.

### The judgement call: a committed script, not inline workflow steps

The sequence could have been six `run:` blocks. Three reasons it is a module:

- **The assertions above need tests.** `scripts/agent/**` has a test lane; a `run:` block
  has none. An untested assertion is decoration, and the whole value of this PR is the
  assertions rather than the sequence.
- **It has to be runnable on a laptop.** A lane whose steps exist only inside a workflow
  file is reproducible by GitHub and by nobody else.
- **The repository already made this split.** `eval-replay.yml` keeps its YAML thin and
  puts its preflight in a tested `replay-plan.mjs`. Following that costs nothing.

## Corrected while building

**`Number(null)` is `0`, and it defeated the most important check in the file.** Three
tests went red at once on one cause. Every absence here arrives as `null` — a header that
was not sent, a payload field a scorer left empty — and `Number.isFinite(Number(null))` is
`true`. The consequences were one misleading refusal message, one reset time printed as
`1970-01-01`, and one silent hole exactly where it mattered most: `assertCapability`
accepted `coderabbit.latency.wall_ms: null` from a scorer that *had* been passed the flag,
which is precisely the rename case the capability system exists to catch. Now `isNumber`
requires `typeof value === "number"`, and a mutation restoring the coercing form reddens
six tests.

**The obvious rate-limit preflight reads a bucket real calls do not draw from.** The first
version probed `gh api rate_limit` and reported 5000 calls of headroom on a token with
4101. Measured within one second, on this project's GitHub App user-to-server token:

```
gh api -i rate_limit             used 0    remaining 5000    <- BOTH WRONG
gh api -i user                   used 899  remaining 4101
gh api -i repos/{owner}/{repo}   used 900  remaining 4100
```

The endpoint is exempt in both directions, and — the part that makes it actively misleading
rather than merely useless — its response headers claim `X-Ratelimit-Resource: core`
anyway. There is no way to tell it from the truth except by asking something else. The
probe is now `repos/{owner}/{repo}`, which costs the same single call and additionally
proves the token can read the repository the CodeRabbit arm is about.

**Two of the flag tests passed by substring.** `--corpus` is a substring of
`--corpus-version`, so renaming the driver's flag to `--corpus` satisfied "the scorer's
source mentions this flag" while sending every scorer something none of them read.
`--scorer-id` to `--scorer` was the same. Both were found by mutation testing, and the fix
is a lookahead that makes the assertion about a flag rather than a prefix.

**One test checked the code against its own derivation.** The budget test computed
`floor = need * BUDGET_HEADROOM` from the imported constant and then asserted the code
agreed — so setting the headroom to 1 moved both sides together and the mutation survived.
It now asserts the *relationship* (`floor > need`, and a budget exactly equal to the
estimate is refused), which is what the headroom is for.

**And a defect in the mutation harness itself, which had reported a caught mutation as
survived.** `String.replace` interprets `` $` `` inside a replacement *string*; one
mutation's replacement contains exactly that, so the harness wrote a file that failed to
parse and read the file-level failure as "nothing caught this". With a replacer function
the count went from 50/51 to 51/51. Worth recording because the failure direction is the
flattering one: a broken harness reports missing coverage, but a harness broken the other
way would report coverage that does not exist.

## What was MEASURED rather than assumed

**Scoring needs no git tree, no corpus commits and no `refs/eval/*`.** `eval-replay.yml`'s
header explains at length why a corpus item's commits must be fetched and why
`fetch-depth: 0` is not enough. None of it binds this lane, and that is not an inference: a
full pass ran against a store **copy with no `.git` at all**, from a **shallow checkout
carrying zero `refs/eval/*` refs**, in a tree with **no `node_modules` anywhere** — and
reproduced the laptop's eight output files byte for byte. So the checkout is the default
shallow one, there is no `npm ci`, and no ref is fetched.

**A full pass costs 175 core API calls** for the 7-item pilot at K=3 — measured off
`x-ratelimit-used`, 546 → 722 (less the probe). That is exactly `items × (K + 2) × 5`: five
endpoints per item, read once per replicate by `volume-mix.mjs` and once each by
`complementarity.mjs` and `segmentation.mjs`. `reliability.mjs` and `cost-latency.mjs` read
no API at all. The model is pinned to the measurement by a test.

**Re-scoring is byte-identical over unchanged inputs.** Two full passes produced the same
sha256 for all 9 files under `scores/` and `reports/`. The lane's own output also matched
the store's committed scores byte for byte, from an independent fresh clone.

**§4 of the report contains no latency figure today, in either state.** See below.

## 🔴 Where this PR disagrees with its own brief

The handoff asked for an assertion that the **rendered §4** carries a latency figure, on
the stated premise that without the opt-in `--coderabbit-latency` flag "§4 prints the
declared gap, which is byte-for-byte what an unmerged cost/latency scorer would print."

**Both halves are false on `main` at `ba944f3`, and the second is false in the reassuring
direction.** Measured by rendering the report twice, once with the `cost-latency-v1` score
filed and once with it removed:

| state | §4 renders |
|---|---|
| score filed (today) | 3 lines: `Cross-arm: **not measurable** — no per-review price…` |
| score absent (an unmerged scorer) | 8 lines, including `Panel: **not computed** — …the cost/latency scorer is not merged`, plus an explanatory paragraph |

So the two states are **clearly distinguishable**, not byte-identical — and `report.mjs`
already exits **1** on the second, which is a stronger guard than the one that was asked
for. What is true is that §4 renders **no latency figure in either state**:
`costLatencyFigures` deliberately unpacks only `reviewer`, `completeness` and
`payload_keys`, saying so in a comment ("this PR cannot render fields whose shape is still
in review"). Filling §4 in belongs to the renderer, not here.

The flag does not exist yet either: `cost-latency.mjs` on `main` accepts
`--coderabbit-usd-per-month` and `--coderabbit-prs-per-month` and nothing else, and its
payload declares `coderabbit_latency_ms` as a gap.

**So the assertion was built where the data actually is, and in both directions:**

- **unconditional today** — the `cost-latency-v1` payload must carry the panel's latency:
  `panel.per_item[].wall_ms.n >= 1` for every item, and a `duration_source` census counting
  at least one timed envelope. Shape and presence, never a value.
- **auto-arming** — the flag is probed out of `cost-latency.mjs`'s own usage. Present, it is
  passed and the payload must then carry a CodeRabbit latency. Absent, the payload must
  still *declare the gap*. A rename lands in the second branch, where deleting the gap on
  the theory that the metric is now measured is a refusal.

The lane prints `coderabbit-latency=declared-gap` on every run today, and a test pins that
state so it goes red the day the flag lands rather than staying quietly wrong.

## Fail directions

| when this fails | what happens | why that is the safe way |
|---|---|---|
| a CodeRabbit endpoint 403s / 429s | the pass refuses, naming the reset time, and files **nothing** | a partial arm is a smaller number nobody can tell is smaller; scoring is idempotent, so waiting costs nothing |
| the API budget is too small | refused **before** the first read | meeting the limit half way through files a short score instead of failing |
| the budget is unreadable (no `gh`, no token) | refused | an unauthenticated `gh` produces the same corpus-wide emptiness as a rate limit |
| an opt-in flag was renamed | refused, in whichever branch it lands in | the alternative is a payload with an empty half and a zero exit code |
| a scorer exits non-zero | the pass stops there; later scorers do not run | four scores of five is a report that renders as complete |
| a filed score cannot be read back | refused | the renderer would print "not computed" over a score that is sitting there |
| a section's score is missing at render | `report.mjs` exits 1 and the driver propagates it | a report with a hole must not be quotable as the whole comparison |
| the index holds a path this pass did not write | the commit step exits 1 | the fork-era `__smoke` artifact must never be committed as though this pass produced it |
| **nothing changed** | reported as success, no commit | this is the ordinary weekly outcome; a step that assumed a change would redden every Monday or file empty commits |

## Explicit non-goals

- **No new write scope on this repository.** `permissions: {}` at the top, four job-level
  read scopes, and a test asserting no `: write` appears anywhere in the file. Writes go to
  `dlgpdmsly2/wafflebase-agent-eval` through the token the replay lane and the collector
  already use.
- **Not gating, and it cannot become gating.** `workflow_dispatch` and `schedule` only, so
  the lane is attached to no commit, produces no status check, and a merge has nothing to
  block on.
- **No scorer or renderer was touched.** Three of them are owned by open PRs. This PR adds
  two files under `scripts/agent/eval/` and one workflow, and changes nothing existing.
- **It cannot dispatch a replay** and spends no money: no model call, no worktree, no
  `CLAUDE_CODE_OAUTH_TOKEN`.
- **`adjudicate.mjs` is never invoked** — it is interactive.
- **No expected benchmark figure appears in the workflow or the driver.** The only pinned
  numbers are the API-cost model and the corpus identity a schedule needs; every assertion
  about a metric is about shape and presence. A lane that asserted an overlap percentage
  would fail the day the benchmark improved.
- **The kit's `rescore-and-render.sh` is not what CI runs.** A lane depending on a file
  outside the repository is not reproducible by anyone else, which is this PR's whole point.

## Verification

Base `ba944f301403cc11d3b636e7466013805e5df062` (`main`, #826). Both trees extracted with
`git archive`, with the **same** `scripts/agent/node_modules` and root `node_modules`
symlinked into each, then measured once each — so a skip delta cannot be an environment
artefact.

- [x] **`agent:tests`, two invocations, as the lane runs them:**

  | | rest | iso (`eval/run.test.mjs`) | total | fail | skip |
  |---|---|---|---|---|---|
  | base `ba944f3` | 1868 | 56 | **1924** | 0 | 0 |
  | this branch | 1906 | 56 | **1962** | 0 | 0 |

  **+38, which is exactly this PR's new tests.** The 0 skips on both are the SDK and a
  root `eslint` being present; a tree without them reports 6.
- [x] `eslint scripts` (the lockfile-pinned 9.24.0) — **exit 0 on both trees**.
- [x] `eval/run.test.mjs` also came back **56/56 on the shared `os.tmpdir()`**, so the
      known flakiness did not appear today and both numbers agree.
- [x] **51 mutations, 51 caught by the specifically-named test, 0 survived.** Each mutation
      names the one test that must redden, so a mutation caught by some other test is
      reported as a failure of the harness rather than a success.
- [x] **The six steps run end to end against a COPY of the store**, from a fresh shallow
      clone with no `node_modules` and no `refs/eval/*`: 7 scores filed, report rendered,
      exit 0.
- [x] **The driver reproduces the laptop script byte for byte** — all 8 files `cmp`-clean.
- [x] **A second pass over unchanged data produces no diff**, and the commit step reports it
      as success: `nothing moved — … That is a successful re-score, not a no-op.`, exit 0,
      no commit created.
- [x] **The commit step was run against a real git-backed store copy**, in three states:
      unchanged (no commit, exit 0); one moved figure with the `__smoke` artifact
      **deliberately dirty** (exactly 1 file committed, `__smoke` left uncommitted); and
      `__smoke` pre-staged by something else (**exit 1**, naming the path).
- [x] `--dry-run`'s equivalent — `dry_run: yes` — staged the diff, printed it, and created
      no commit.
- [x] Verified from the **committed tree** (`git archive <branch> | tar -x`), not the
      working copy.
- [x] **The YAML parses, and its structure was read back from the parse** rather than from
      the file: triggers `[schedule, workflow_dispatch]`, top-level `permissions: {}`, job
      permissions the four reads, `timeout-minutes: 30`, `cancel-in-progress: false`, the
      four dispatch inputs, seven steps, and **no `write` scope anywhere**.
- [ ] **`actionlint` was NOT run — it is not installed on this machine** (`~/.local/bin`
      holds `claude`, `gh`, `pnpm`, `pnpx`). The parse above is PyYAML, which proves the
      file is well-formed and its keys are where they claim to be; it does **not** check
      Actions-specific semantics the way `actionlint` would — an unknown `uses` input, a bad
      `cron`, a context that cannot resolve in the scope it appears in. The 10 workflow
      tests in `score-all.test.mjs` cover the properties this PR cares about (triggers,
      permissions, no `${{ }}` in a `run:` body, every `inputs.X` declared, the staging
      paths, the dry-run gate's position, the flags it passes) and are not a substitute for
      a linter.
- [ ] **The lane has never run on GitHub.** Everything above is local: the two checkouts,
      the token, `RUNNER_TEMP` and the push are simulated. The first dispatch should be
      `dry_run: yes`.
