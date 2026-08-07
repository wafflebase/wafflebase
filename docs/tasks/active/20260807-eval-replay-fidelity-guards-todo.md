# Replay fidelity and spend guards for `scripts/agent/eval/run.mjs`

*Plan PR 6. Follows #682 (the replay runner), #687 (`localization_scope`), #692 (the
`agent:tests` lane's timeout flags and `reapLaneGroup`). Free: every test drives
`adapters/stub-panel.mjs` and a fixture git repo, and no replay against the real panel
has been run.*

## The problem

Two independent things were wrong, and both were invisible in the output.

**1. The replayed gate was not the shipped gate.** Since #668 the panel routes blocking
findings through a **novelty lane** decided by `git blame` against `--base-sha`.
`materializeRepoAt` built the review tree with `git archive`, which produces a tree with
**no `.git`**, so nothing could pass `--base-sha` — the adapter's own docblock said so,
deliberately — and every replay printed `novelty gate: OFF (no --base-sha)`.

Be precise about the consequence, because the loose version is false. Findings **did**
carry a lane: `routeFinding` returns `blocking` when novelty is `unknown`, so every
replayed finding was labelled `blocking`, which looks like a correct answer. What could
not occur was the **demotion** — `lane: "backlog"` needs an origin of `relocated`, which
needs a blame of a tree that has a `.git`. So a replay did not merely lack information.
**It answered the gate's question wrong, in the direction that reads as normal, on every
relocated finding in the corpus.** Left alone this surfaces *after* the paid run, as an
unexplainable difference between replayed and live captures.

**2. A replay could run away.** Measured evidence, not a worry:

- the **#521 pilot billed $44 for roughly one usable data point**. A diff-only replay
  over-flags, which explodes verifier fan-out; nothing capped it and nobody was watching.
- `runAgent` had **no timeout of any kind**. `child.on("error", …)` resolved the promise
  and never killed the child.
- `--require-repo-context` — the guard the $44 postmortem produced — was **opt-in**,
  because the tree the runner could build was an archive and the guard was therefore not
  satisfiable.

And a third thing, measured while building and reported below: **the review commit is
routinely not present locally**, and that degraded silently into a diff-only replay.

## The change

| | |
|---|---|
| `materializeRepoAt` | `git archive` → a real **linked git worktree**, `--detach`, at `review_commit`. Same `{path, files, error}` shape |
| `runAgent` | passes `--base-sha` from the item's frozen `review_base`; gains `timeoutMs` and a **process-group** kill |
| `resolveRunOptions` | `--require-repo-context` **default ON**; `--no-require-repo-context` added; `--panel-timeout` added (defaults to 45 min, cannot be disabled); `--max-cost-usd` added and **required**, with `--no-cost-cap` as the explicit unbounded answer; three flag contradictions became usage errors |
| `adapters/panel.mjs` | #713's "what is inert today" docblock, and the README paragraph mirroring it, updated: `lane: "backlog"` is what this PR makes occur |
| `run.mjs` loop | three **pre-spawn**, zero-cost refusals; a per-run cost cap; worktree teardown |
| `ITEM_REASONS` | `+ panel-timeout`, `+ no-base-sha`, `+ base-unresolved`. None fatal — see below |
| `RUN_STATUSES` | new closed vocabulary, `+ capped` |
| `countFiles` | excludes git's own bookkeeping |
| `stub-panel.mjs` | `hang` and `spawnGrandchild` modes, and it writes `stub-pids.json` |

### The five decisions

**1. The worktree's lifetime is the run, and its root is per-process.**
`mkdtemp(tmpdir()/eval-worktrees-)`, keyed by commit inside, deregistered and deleted in
`cleanupRepoCache` after the final `putRun`.

The shared `tmpdir()/eval-repo-cache/<commit>` this replaces had a documented race —
`rmSync`-then-rebuild, so a concurrent reader could see a half-built tree. A
staging-plus-rename fix for it was written during PR 5 and **reverted after breaking CI
twice**. A per-process root does not fix that race, it **removes it**: nothing outside
this run can address the path at all.

What changed is that cleanup is no longer "delete a directory". A worktree is
**registered in the source repository's `.git`**, so a leaked one is administrative state
in somebody's working clone. This machine's clone has **eight** linked worktrees
belonging to real branches, two of them nested inside the repository directory — so
`git worktree remove` is only ever pointed at a path under our own `mkdtemp` root, and
**`git worktree prune` is never called**: it deregisters by reachability rather than by
ownership.

The cost of per-run lifetime is that K=3 replicates, being three run ids and three
processes, build the tree three times. Measured: **~44 MB and ~0.2 s** per worktree
against this repository. Seven items at K=3 is ~1 GB of transient disk for the pilot,
and correctness that needs no cross-process reasoning. Within one run, two items at one
commit still share one worktree, and the gate only ever reads it.

Hooks are disabled for the checkout (`-c core.hooksPath=<root>/no-hooks`). `git archive`
ran no hooks; `git worktree add` runs `post-checkout`, so the change would otherwise have
started executing hook scripts out of the repository under review on every item.

**2. A missing review commit is REFUSED, with the exact fetch, and the runner does not
fetch it itself.** Four reasons:

- The corpus item records no remote. A fetch would have to guess `origin`, and a wrong
  guess fails late, after the guess has been made silently.
- `extract-corpus.mjs` already owns this fetch, and it is the module that knows the PR
  number. Two code paths doing one fetch is how they drift.
- The runner's own precedent for a planning error is to refuse and record nothing:
  *"Absent from the corpus is a planning error, not an observation."*
- The refusal is **free** and happens before any spawn. A wrong fetch costs a whole run
  of wrong-fidelity replays.

So `materializeRepoAt` asks `git cat-file -e <commit>^{commit}` **first**, and the error
carries the command:
`git -C <repoSource> fetch origin refs/pull/<n>/head:refs/eval/pr/<n>`, built from the
item's own `source_pr`. **A refusal a reader cannot act on is a refusal that gets worked
around by turning the guard off.**

**3. `--no-repo-context` overrides the default; contradicting an EXPLICIT flag is a usage
error.** The rule, stated once: *a default may be overridden silently, an explicit flag
may not be contradicted.*

- `--no-repo-context` alone → diff-only, guard off. Not a conflict: it removes the
  subject, since there is no tree to require.
- `--require-repo-context` **with** `--no-repo-context` → **exit 2**, naming the pair.
- `--require-repo-context` with `--no-require-repo-context` → **exit 2**.
- `--require-repo-context` alone → fine. Saying the default out loud is allowed.

`--no-require-repo-context` is the escape hatch the flip would otherwise remove: try for
a tree, degrade to diff-only per item. Such a run **can hold items of two different
fidelities**, and pooling those is averaging two reviewers, so it is recorded rather than
inferred: `run.json`'s `repo_context` gains a third value, `tree-optional`.

**4. The cap bounds the RUN; only the timeout bounds an item, and it bounds time.**
This is the decision that most needed stating honestly, because it bounds what the PR
body may claim.

`sumExecutions` reads `review-execution.json`, which the panel writes **as it exits**.
There is therefore no moment during an item at which the runner knows what it is
spending. So:

- `--max-cost-usd` is checked **before each spawn**, against spend recomputed from the
  **stored envelopes**. It can stop the next item and can never stop the current one.
  Seeding from the store is what makes a resumed run resume its *budget* — a
  per-invocation budget would let three resumes of a $0.40 run spend $1.26 while each
  reported staying inside the cap.
- `--panel-timeout` is the only per-item bound, and it bounds **time, not dollars**. It
  has a default and cannot be switched off, so no invocation of this CLI spawns a panel
  with no upper bound on how long it may run.
- `--max-cost-usd` has **no default and is required**, with `--no-cost-cap` as the
  explicit way to run unbounded. The absence is still said out loud at run start, for
  the same reason the gate's OFF line is — but it can no longer be an absent-minded
  absence, so the line names the flag that produced it.

**The cap defaulted to off in the first draft, and that was the wrong call.** The
reasoning was that a cap chosen for someone silently truncates a legitimate run, which
is true. It is still the wrong trade, and the review that caught it named the reason:
the guard exists *because of* #521 — $44 for roughly one usable data point, nothing
capped, nobody watching — and the operator who forgets a flag is precisely the operator
in that postmortem. A guard that only works when you remember it does not guard against
forgetting.

The asymmetry decides it. A truncated run is recoverable: raise the cap, resume the same
`--run-id`, pay for nothing twice — the budget seeding above is what makes that true.
Money already spent is not recoverable at all. So this follows `--root`'s rule from
#675, which is the same shape: an **irreversible** default is not a convenience. The
unbounded run stays available and stops being the thing you get by omission.

`--no-cost-cap` is a **negation with nothing to negate**, unlike
`--no-require-repo-context` — there is no default for it to turn off, and it exists so
that a reviewer scanning a command line finds either a number or an explicit refusal of
one, never silence. Passing it together with `--max-cost-usd` is a usage error on the
same rule as the repo-context pair: two stated intentions, resolved silently in neither
direction.

**Where a cap is recorded: at the run, not as an `ITEM_REASONS` entry.** The runner
already refuses to store an envelope for an item it never attempted, and an item skipped
by a cap was never replayed. But `aborted` was the wrong home for it, so `RUN_STATUSES`
is now a declared, closed list and `capped` is a fourth member. The argument is the
project's own lesson six, one level up: `aborted` means *a misconfiguration was detected,
nothing here is poolable, fix something*; `capped` means *the run did what it was told,
its stored items are real verdicts, raise the cap and resume the same run id*. Folding
both into `aborted` with the difference in free-text `notes` is exactly what the
item-level closed vocabulary exists to prevent one level down. `run.json.status` is **not
validated by the store** — `validateRunEnvelope` checks item envelopes only — so the
vocabulary is owned in `run.mjs` and pinned by a test that reads the source.

**5. The base sha comes from the item, and an unusable one REFUSES rather than falling
back.** `meta.review_base`, never a flag: a base is a property of the pull request being
replayed, and one supplied per run would be wrong for six items out of seven.

The fail direction is the whole point. Falling back to "pass no `--base-sha`" is a silent
return to the gate-off replay this PR exists to end, and **`gate-degraded` cannot catch
it** — that fires on a base that was *passed* and did not take. With nothing passed there
is nothing to disagree with, so the run would look clean forever. Two reasons, two
remedies, both refusing before the spawn for zero cost:

- `no-base-sha` — the item carries no usable `review_base`. Remedy: re-freeze the item.
- `base-unresolved` — it carries one and the materialised tree does not have it. Remedy:
  `git fetch --unshallow`.

The second is the valuable one and it is aimed squarely at **PR 22**: a shallow clone —
CI's default checkout — has `review_commit` and not its base. Without this, the first CI
lane run is a *paid* abort at item 1; with it, it is a free refusal that names `--depth`.

**None of the three pre-spawn refusals is fatal**, and the test for `FATAL_REASONS` is
now written down: not *"would the next item fail the same way"* but **"would the next
item cost money before failing the same way."** All three are run-wide in practice — a
shallow clone breaks every item's base — and a run of seven free refusals costs nothing
and names seven remedies instead of one. `no-repo-context` set that precedent in #682;
these follow it rather than inventing a second rule.

### The kill, which is not `child.kill()`

**The technique is #692's, not a re-derivation.** `reapLaneGroup` in
`scripts/verify-self.mjs` already established it for this repo and this incident: spawn
`detached` so the child is its own process-group **leader**, signal the negative pid,
tolerate `ESRCH`. Its docblock records the mutation result — *"dropping `detached` leaves
the orphan running"* — and this PR's own M4c reproduces it one level down.

Measured here, with a stub whose grandchild installs a SIGTERM handler and ignores it:

| Technique | Child | Grandchild |
|---|---|---|
| `child.kill("SIGTERM")`, then `child.kill("SIGKILL")` | dies | **survives both** |
| `detached` + `process.kill(-pid, "SIGTERM")` | dies | survives |
| … + `process.kill(-pid, "SIGKILL")` after a grace | dies | **dies** |

The second SIGKILL in row one goes to a pid that is already reaped, so it does nothing.
That is the **six orphan processes at teardown** from #682's hang, and it is not
hypothetical for the real panel: the Agent SDK's `query()` starts its own subprocess per
lens. **`spawn`'s own `timeout` option is insufficient for the same reason** — it signals
the child only.

**One deliberate difference from `reapLaneGroup`, and it is the SIGTERM.** That function
reaps a lane that has **already exited**, so it goes straight to SIGKILL and cannot lose
anything. This kills a **live** panel mid-review, which may hold buffered stdout —
including the `novelty gate:` line the entire gate assertion reads — and lens output
already written. So SIGTERM first, SIGKILL after `KILL_GRACE_MS`. The escalation is not
optional: only the group SIGKILL ends a grandchild that ignores SIGTERM, which is
ordinary behaviour for a CLI that wants to flush.

Two consequences handled rather than discovered:

- **The promise is resolved by our timer, not by `close`.** `close` waits for every
  holder of the child's stdio pipes, and a grandchild inherited those fds — so waiting
  for `close` on a hung panel is exactly how the promise stays pending *while the tree is
  still alive*. Both halves of the #682 hang, from one cause. `verify-self.mjs` measured
  the same thing one level up, which is why it reaps on `exit` rather than `close`.
- **`detached` breaks Ctrl-C.** The child is no longer in the terminal's foreground
  process group, so SIGINT reaches the runner and not the panel — which would leave a
  model spending money after the operator thought they had stopped it. `runAgent`
  forwards, like `liveLaneGroups` does; it re-raises rather than calling `process.exit`,
  because this is a library and a hard exit would take a test process with it.

## Corrected while building

**The prompt's decision 5 was half already solved, and I found out by writing a test that
could not fail.** `validateCorpusItem` **already** refuses a `review_base` that is not 40
hex at the store's **write** path — and its message already names PR 6. So `putCorpusItem`
would have thrown before the runner ever saw a bad one, and my first `no-base-sha` test
threw from the fixture rather than from the code under test.

The guard is still live and still worth having, because `getCorpusItemInput` **does not
re-validate what it reads**, and the corpus is a *separate, hand-committed repository*.
So the runner's guard is a **read-path backstop for a write-path invariant** — this
project's lesson seven as a design rule rather than a postmortem: *a validator only guards
the door it stands in.* The test now writes `meta.json` by hand, which is the real
scenario, and says so.

**The worktree's `.git` pointer nearly made `--require-repo-context` permanently inert.**
A linked worktree's `.git` is a **file**, and `countFiles` counted every file. So an
**empty checkout would have reported `files: 1`**, and the guard fires on
`contextFiles === 0`. Configured, on, and never able to fire again — *satisfiable without
being satisfied*, arriving via a line nobody would look at twice. `countFiles` now
excludes anything under `.git`, and a test asserts the count is the commit's own.

**A race in the kill that only appears under load, and it inverted a fact.** A panel with
no SIGTERM handler dies on the *first* signal, so `close` fires during the kill grace —
and my first version let that path resolve as an ordinary exit. A panel we deliberately
killed would have been recorded as one that finished by itself: *"we stopped it"*
laundered into *"it crashed"*, which is precisely the distinction `panel-timeout` exists
to keep. It **passed in isolation and failed in the full lane**, because what usually
delays `close` past the grace is the grandchild holding the pipes. Fixed with a
`killedByTimeout` flag every settle path reads — and with a SIGKILL on the way out of
that path, because clearing the pending grace timer would otherwise leave the grandchild
alive: *the orphan, produced by the very code meant to prevent it.*

**`git worktree add` runs `post-checkout`; `git archive` ran nothing.** Not a bug found,
a regression avoided — but only because the difference was checked rather than assumed.

**The PR 5 task doc suggested the timeout resolve with a non-zero code so `panel-exit`
would cover it.** Not taken. A killed child reports `code: null` with a signal, and
filing a runaway panel under the same reason as one that crashed on a large diff loses
the only fact that decides what to do next.

**My mutation harness reported two false SURVIVEDs, for the reason #692's own docblock
names.** With `--test-force-exit`, a test that never finishes is force-exited and counted
under `cancelled`, not `fail` — so a harness reading only `fail` calls that mutation
survived when the test plainly did not pass. *"`--test-force-exit` ends the run, it does
not go red."* The harness now counts both. Worth recording because any future
mutation tooling in this repo will hit it.

**The cost cap shipped default-off, and review caught it.** Recorded here rather than
quietly amended, because the reasoning that produced it was locally sound and still
wrong: I optimised for not truncating a legitimate run, and so built the guard the #521
postmortem asked for in a form that does nothing unless the operator remembers a flag —
and the operator who forgets is the one in that postmortem. `--root` already sets the
rule for this repo: an **irreversible** default is not a convenience. Now required, with
`--no-cost-cap` as the explicit unbounded answer. Full reasoning in decision 4.

**Three things review found, and all three were the same omission.** The teardown ran
on the success path only, a pre-spawn refusal kept its (empty) scratch directory, and
`materializeRepoAt` interpolated `review_commit` into a path without the sha guard
`review_base` gets. Each is a cleanup-or-validation step that the *ordinary* path
exercises and the *exceptional* one does not — which is the same shape as the kill race
above, and the reason all three are now pinned by a mutation rather than by a comment.

The third is the one worth stating plainly: `dest` is handed to `git worktree remove`
and to `rmSync(..., { recursive: true })`, and the entire safety argument for that
teardown is that it only ever addresses paths under this run's own `mkdtemp` root. A
`..` in `review_commit` breaks precisely that argument. `validateCorpusItem` already
refuses it at the store's write path — this is the read-path backstop, and the reasoning
is the one already written down for `review_base`: *a validator only guards the door it
stands in.*

**#713 landed a docblock this PR falsifies, and updating it is part of the change.**
`adapters/panel.mjs` says the lane-aware path is inert *"until the fidelity PR gives the
panel a real worktree and a `--base-sha`"* — this is that PR, so the claim and the
README paragraph mirroring it now describe what actually holds: `lane: "backlog"` occurs,
and envelopes stored earlier still read gate-off, which is why `panel.gate_state` rides
on every record. Leaving a true-when-written comment in place after making it false is
how a codebase stops being readable.

## Fail directions

| Part | On failure | Why that is the safe way |
|---|---|---|
| `materializeRepoAt`, commit absent | `{path: null, files: 0, error}` naming the `git fetch` | free, before any spawn; a silent 0-file checkout is how the pilot billed $44 |
| `materializeRepoAt`, `worktree add` fails | same shape, git's own stderr, and the partial worktree is **deregistered** | leaving a registered entry puts state in someone else's clone |
| `removeWorktreeAt` / `cleanupRepoCache` | swallow and continue; the directory goes regardless | a cleanup path runs after the useful work is stored; a stale entry is not worth losing a result over |
| no tree and `--require-repo-context` | `no-repo-context`, zero cost, run continues | the tree is what makes the gate and the verifier honest |
| no usable `review_base` | `no-base-sha`, zero cost, run continues | falling back to no base is the silent gate-off replay, and nothing downstream could see it |
| base does not resolve in the tree | `base-unresolved`, zero cost, run continues | the same question `gate-degraded` asks, asked before the money |
| base passed and the panel still says OFF | `gate-degraded`, **run aborts** | unchanged from #682, and now reachable for the first time |
| panel never exits | group killed SIGTERM→SIGKILL, `panel-timeout`, run continues | one item's cost is spent either way; a run of them is the cap's job |
| spend reaches `--max-cost-usd` | run stops **before** the next spawn, status `capped`, skipped items **named** | a cap that dropped items silently would make a 5-item run look like a 5-item corpus |
| no `--max-cost-usd` at all | runs, and says at start that it is unbounded | an absent guard that is announced is not a silent one |
| `--panel-timeout 0` | **exit 2**, naming why there is no off switch | a tool that spawns model calls with no ceiling is the state this PR ends |
| two contradicting repo-context flags | **exit 2**, naming the pair | resolving two stated intentions silently measures something nobody asked for |

## Explicit non-goals

- **No real replay was run, and no API key was used.** Every test drives the stub panel
  and a fixture git repo; the end-to-end against a real corpus item also drives the stub.
- **No cost cap via `maxTurns`, `effort` or sample count.** Those are the *reviewer's*
  configuration, and #680 exists so that a changed reviewer changes `config_hash`. A cap
  must stop the run, never quietly downgrade the panel.
- **No CI replay lane** — `workflow_dispatch`, sharding, artifacts are PR 22.
- **No `timeout-minutes` in `ci.yml`.** #692 already did that. This is the *product* half
  of the #682 hang (a runaway replay); that was the *lane* half. Neither subsumes the
  other, and this PR does not claim to have fixed the CI hang.
- **`clusterFindings`, lens behaviour and the gate's decisions are untouched.** The
  novelty gate is read-only by its own docblock, which is why one worktree is safely
  shared.
- **Nothing is narrowed.** No finding is rebuilt from a field list anywhere.
- **No metric, no scorer, no schema.** PR 7 owns the finding record.
- **The cross-process cache race is removed rather than fixed.** No staging-plus-rename.
- **`git worktree prune` is never called**, and no path outside the run's own `mkdtemp`
  root is ever passed to `git worktree remove`.
- **`run.test.mjs`'s inability to run twice concurrently is left alone.** Pre-existing
  from #682, reproduces on `upstream/main`, harmless in CI. Now documented in the README
  so the next session does not think it broke something.

## Verification

- [x] **The `agent:tests` lane's own command**, as #692 changed it —
      `cd scripts/agent && node --test-timeout=60000 --test-force-exit --test '**/*.test.mjs'`
      — with **no `node_modules`**: **1407 tests · 1401 pass · 0 fail · 6 skip**.
      Baseline measured the same way on `upstream/main` `1f9ee8864`:
      **1382 · 1376 · 0 · 6**. Delta **+25 tests, no new skips**. The 6 are unchanged and
      pre-existing: 1 Agent SDK, 5 `lint-config` without a root workspace install.
      (Re-measured against each base this branch was rebased onto — #712/#713, then
      #714 — and again after the review round, which added 3 tests.)
- [x] Stable across **three consecutive full-lane runs**, and **no orphan processes**
      afterwards.
- [x] `eval/test-lane.test.mjs` passes — no new test files, both suites are existing ones.
- [x] `eslint scripts` (pinned `9.24.0`) exits **0**.
- [x] **`baseResolves(materialized.path, review_base) === true`**, using the real function
      from `novelty.mjs` — the exact predicate `review-panel.mjs` calls before printing
      `novelty gate: on`.
- [x] **`noveltyOf` answers `introduced`, not `unknown`**, in that tree, and attributes the
      line to the review commit. The same test extracts a `git archive` of the same commit
      and asserts **both answers are negative there** — the regression is built into the test.
- [x] **THE TRANSITION: `routeFinding` returns `backlog` in the worktree and `blocking` in
      the archive**, for the same finding, the same base and the same router, driven by a
      fixture whose review commit RELOCATES a distinctive line. That is the behaviour
      change stated at the gate's own output rather than at its log line.
- [x] **`--base-sha <review_base>` in `stub-argv.json`**, read from the child's own record.
- [x] **A timed-out panel leaves no live child**, asserted on the pids the stub wrote, not
      on the promise.
- [x] **The cap stops a run**, shown by a second item with no envelope at all.
- [x] **Replicate stability**: the same commit twice gives an identical path and count.
- [x] **A full free end-to-end** against the real frozen `pr-471` (2709 files):
      `gate.state: "on"`, `base_sha_passed: true`, `repo_context: "tree"`,
      `lane: "backlog"` intact in the payload, and the source repository's worktree count
      9 before and 9 after.
- [x] **25 mutations, 25 caught** — including all six the handoff named. Table below.
- [x] Verified from the **committed tree** (`git archive <branch> | tar -x`), not the
      working copy.

### Mutations

| # | Mutation | Caught by |
|---|---|---|
| M1 | drop `--base-sha` at the spawn | *…a gate that is ON* — "the replayed gate is still not the shipped gate" |
| M2 | return an archive tree, not a worktree | 6 tests, incl. THE FIDELITY CLAIM and THE TRANSITION |
| M3 | remove the spawn timeout | *…killed BY PROCESS GROUP* (cancelled, not failed — see above) |
| M4a | remove the kill entirely | same — "the kill left 2 process(es) alive" |
| M4b | kill the child, not the group | same — "the kill left 1 process(es) alive" |
| M4c | drop `detached` (`reapLaneGroup`'s own mutation) | same — "the kill left 2 process(es) alive" |
| M5 | restore `requireRepoContext: false` | 3 tests, incl. the `--require-repo-context` end-to-end |
| M6 | remove the cost-cap check | "a capped run is incomplete and must not report success" |
| M7 | count git's own pointer file | 3 tests, incl. the empty-checkout guard |
| M8 | delete the worktree without deregistering | "the worktree entry survived cleanup" |
| M9 | drop the commit-presence check | the fetch-remedy refusal |
| M10 | classify the timeout below the exit code | the `panel-timeout` end-to-end |
| M11 | let `close()` overwrite a fired timeout | *…killed BY PROCESS GROUP* |
| M12 | fall back to no base when `review_base` is unusable | the `no-base-sha` end-to-end |
| M13 | drop the pre-spawn `baseResolves` check | the `base-unresolved` end-to-end |
| M14 | reset the budget on every resume | the resumed-budget end-to-end |
| M15 | resolve the flag contradiction silently | "contradict each other" |
| M16 | accept `--panel-timeout 0` | "`--panel-timeout 0` was accepted" |
| M17 | report a capped run as `aborted` | 2 cost-cap end-to-ends |
| M18 | pass no base sha when the tree exists | 2 gate end-to-ends |
| M19 | make the cost cap default to off again | 2 tests, incl. *…an unbounded run has to be asked for* |
| M20 | let `--max-cost-usd` and `--no-cost-cap` coexist silently | same — "contradict each other" |
| M21 | cleanup on the success path only (undo the `try`/`finally`) | *…a throw inside the item loop still deregisters the worktree* — and only that test |
| M22 | keep the scratch dir on a pre-spawn refusal | *…a PRE-SPAWN refusal keeps no scratch directory* |
| M23 | drop the `review_commit` sha guard | *…refused BEFORE it becomes a path* — `"HEAD" was materialised` |

### Not verified, and why

- **No real panel has ever been spawned by this runner.** The subprocess contract is
  pinned against the stub; the gate's *behaviour* is pinned against the real
  `baseResolves` / `noveltyOf` / `routeFinding` in a real worktree. What remains
  unproven is the pairing: that the real panel, given this worktree and this base,
  prints `novelty gate: on` and emits a `backlog` lane. The first paid replay is the test.
- **Windows.** `detached` and `kill(-pid)` are POSIX; the code degrades to `child.kill()`
  there and nothing runs it — the same limit `reapLaneGroup` has.
- **A hard-killed run (SIGKILL to the runner) still leaks a registered worktree.** The
  teardown is a `finally`, so it survives any *throw*, but a signal that is not caught
  reaches no JavaScript at all. Recovery is `git worktree list` plus a `remove` of any
  `eval-worktrees-*` path — never `prune`, which would take a developer's own.
- **PR 22 will run this on CI's shallow checkout**, where the per-run worktree costs a
  fresh ~44 MB per item and `review_base` will not resolve until the clone is deepened.
  That is now a free, named refusal rather than a paid abort, but the lane still needs
  `fetch-depth: 0` or an explicit deepen.
