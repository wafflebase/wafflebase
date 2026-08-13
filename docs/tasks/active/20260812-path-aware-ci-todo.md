# Path-Aware CI + Deploy Gate — Task Tracking

Design doc: [harness-engineering.md](../../design/harness-engineering.md)
(Lane Contract / CI Contract / Deploy gate sections)

Problem: every PR pays the full ~15 min suite regardless of what changed, and
`scripts/agent/**`-only PRs dominate current traffic. Filtering must happen at
job level (`if:`), not trigger level (`paths:`) — a filtered-out workflow
creates no check run at all, so a required check never reports and a merge-queue
entry waits until its status-check timeout expires.

Separately: **nothing gates deployment on CI today.** `publish-ghpage.yml` and
`docker-publish.yml` fire on `push: main` with no `needs:` / `workflow_run:`, so
they race ci.yml. A red `main` publishes. Path filtering does not weaken that
gate; it exposes that the gate is absent.

## Phase 1: The resolver, unused ✅

- [x] 1.1 `harness.config.json` — new `"ci"` key: `inert` entries + `ciConfig` globs
- [x] 1.2 `scripts/changed-areas.mjs` — base resolution per event, changed-path
      read, reverse-dependency closure over the pnpm workspace graph, fail-safe
      `full: true`, `GITHUB_OUTPUT` writer
- [x] 1.3 `scripts/test/changed-areas.test.mjs` — one case per `full: true` path,
      plus closure cases and a "new top-level directory ⇒ full" fixture
- [x] 1.4 `.github/CODEOWNERS` — own `ci.yml`, `harness.config.json`,
      `changed-areas.mjs`, `verify-self.mjs` (note: `agent-*.yml` does **not**
      match `ci.yml`, so the CI gating surface was unowned until this)
- [x] 1.5 **Unplanned:** a `scripts:tests` lane. `scripts/test/` was run by
      nothing — `agent:tests` covers only `scripts/agent/` and `verify:fast`
      reaches neither, so `verify-entropy.test.mjs` had never been executed by
      CI. Without this, the resolver's own suite would have been orphaned too.

## Phase 2: verify-self decomposition ✅

- [x] 2.1 Split `verify:fast`'s `&&` chain into per-package `LANES` entries
      (12 lanes → 27)
- [x] 2.2 Add `pkgs`/`tags`/`anyPkg` selectors + `needs` with transitive-closure
      selection, and a startup assertion that no `needs` edge points forward
- [x] 2.3 Add a `documentation:build` lane — **no CI lane built
      `packages/documentation`**; a broken VitePress build was caught only by
      `publish-ghpage.yml` at deploy time, which Phase 4 makes unacceptable
- [x] 2.4 Keep `pnpm verify:fast` working unchanged as the pre-commit gate
- [x] 2.5 `status: "filtered"`, distinct from `skip`, plus the `overall` fix
      (`some(fail)`, not `every(pass)` — the old form reports `fail` on any run
      with a filtered lane, which would have made every filtered PR red)
- [x] 2.6 `scripts/test/verify-self-lanes.test.mjs` — asserts the real lane graph
      (read via `--print-lanes`, not imported): backward `needs` edges, every
      `pkgs` entry a real package, every package covered by a lane, only the
      enumerated lanes selector-less, and that no lane is ever selected without
      its prerequisite chain

### Lane `needs` established per package, not assumed

- No engine package has tsconfig `paths`, so `@wafflebase/x` in
  sheets/docs/slides/board/cli resolves through `exports` to that package's `dist/`.
- The frontend aliases sheets/docs/notes/slides/board to `src/` in
  `vite.config.ts` and does **not** alias core — so its lanes need `core:build`
  and nothing else.
- The backend's jest `moduleNameMapper` maps every workspace import, core
  included, to `src/` — so `backend:test` needs no build. `backend:build` does.
- `notes` and `design-editor` declare no workspace dependency, so they are the
  two lanes that run against a tree with nothing built.

## Phase 3: The two heavy jobs ✅

- [x] 3.1 `changes` job in `ci.yml` calling the resolver (`fetch-depth: 0`, no
      `pnpm install` — the resolver imports only node builtins)
- [x] 3.2 `if:` gates on `verify-browser` / `verify-integration`, each stating
      `needs.verify-self.result == 'success'` explicitly
- [x] 3.3 `full-ci` label override (cannot work on `merge_group` — that payload
      carries no PR labels, same constraint `agent-iterate-ci.yml:39` works around)
- [x] 3.4 `ci-config-changed` label + `::warning::` in the job summary
- [x] 3.5 Render filtered lanes + reasons in the `<!-- harness-verification -->`
      comment, with `⊘` for filtered vs `⏭️` for skipped-after-failure
- [x] 3.6 **Unplanned:** gate the four coverage steps and the Codecov upload.
      Ungated, an agent-only PR would have skipped its lanes and then spent
      minutes collecting coverage for packages it never touched — most of the
      cost this change exists to remove.
- [x] 3.7 **Unplanned:** a skipped `verify-integration` never edits the PR
      comment, so the comment claimed that job was "pending" for ever. It now
      says skipped.

## Phase 4: The deploy gate ✅

- [x] 4.1 `full: true` on `push`-to-`main` (landed in 1.2; this is what makes the
      gate sound rather than ceremonial)
- [x] 4.2 `publish-ghpage.yml`: `push` → `workflow_run` on CI success, checkout
      `event.workflow_run.head_sha`, `concurrency` coalescing
- [x] 4.3 `docker-publish.yml`: same, and delete the dead
      `paths-ignore: frontend/**` (the directory is `packages/frontend/**`, so it
      never skipped anything); `release` keeps its own direct trigger and its own
      concurrency key so a release image can never be cancelled by a later merge
- [x] 4.4 **Unplanned:** four `if:` clauses per deploy job, not one.
      `workflow_run.branches` filters on the *triggering run's head branch*, and
      a fork's default branch is usually also `main` — so a fork PR opened from
      its own `main` would otherwise satisfy the trigger filter. `event ==
      'push'` also excludes `merge_group`, whose commits need never reach `main`.
- [x] 4.5 **Unplanned:** `workflow_run` supports no path filter, so
      `publish-ghpage.yml`'s live `paths-ignore: packages/backend/**` had to be
      reimplemented as a step. Preserved deliberately: only `KEEP_COUNT=3`
      deployments of hashed assets are retained, so redundant deploys shorten the
      window in which a client holding a cached `index.html` can fetch them.

## Phase 4b: Make the PR reporting actually work on fork PRs ✅

Found while watching PR #803's first real run: the `ci-config-changed` label never
appeared. Not a bug in the label step — **the whole PR-comment path was dead for
every fork PR**, and all six most recent merged PRs (#789–#798) came from forks.

- [x] 4b.1 Move every PR write out of `ci.yml` into a new
      `.github/workflows/ci-report.yml`, triggered on `workflow_run: [CI]`
- [x] 4b.2 Mint `actions/create-github-app-token` scoped to `issues: write`,
      reusing the `AGENT_APP_ID` / `AGENT_APP_PRIVATE_KEY` App that
      `agent-summarize.yml` already uses for this exact reason
- [x] 4b.3 Carry the resolution + PR number in a `ci-context` artifact —
      `github.event.workflow_run.pull_requests` is **empty for a fork PR**
- [x] 4b.4 Read heavy-job outcomes from the run's job list, so one comment covers
      the whole run and `skipped` is distinguishable from `never wrote a file`
      (this also removes the old two-phase "⏳ pending…" dance)
- [x] 4b.5 Sanitise artifact-sourced strings: they come from a job that ran the
      PR's own code, so lane names and reasons are attacker-controlled
- [x] 4b.6 Drop `ci.yml` to `permissions: contents: read` — the least-privilege
      hardening MAINTAINING.md's merge-queue notes ask for

### Why the token could not simply be added to ci.yml

1. **Secrets are withheld from a fork's `pull_request` run**, so
   `secrets.AGENT_APP_ID` would be empty on exactly the PRs that need it. ci.yml's
   own `CODECOV_TOKEN` comment records the same constraint.
2. `verify-self` runs `pnpm verify:self` — arbitrary build/test code from the PR's
   tree. A write-capable token there is a token the author can exfiltrate.

`workflow_run` solves both: base-repo context (secrets available) and the
workflow file is taken from the default branch, not the PR. **Invariant:** the
reporter checks out no PR code and runs no `pnpm`. Adding either would hand the
token to the fork.

## Phase 4c: The filter was mostly inert, and the label lied about it ✅

Found by asking why #805 — five files, all of them inert — ran the whole suite.
The filter had been shipping the safe answer for the wrong reason, on most PRs.

- [x] 4c.1 Take **both** ends of the diff from the event payload.
      `resolveBase` → `resolveRefs`, returning `{ base, head }`; `changedPaths`
      takes that object so passing `repoRoot` where `head` belongs cannot compile
      into a silent default
- [x] 4c.2 Keep the diff three-dot. Measured, not reasoned: two-dot is *also*
      wrong (15 files on #805 vs 5), because commits the base has and the head
      lacks read as changes belonging to the PR
- [x] 4c.3 Make `ci-config-changed` track the current resolution in both
      directions — it shipped add-only, so anything that set it once kept it set
- [x] 4c.3b Resolve the base from the freshest of three sources, `payload.base.sha`
      LAST. Removing the label is worthless if the re-resolution is still wrong,
      and it was: a rebase / force-push / "Update branch" puts the branch AHEAD of
      the stale `base.sha`, which is the one case three-dot cannot absorb
- [x] 4c.4 List `packages/design-editor/**` inert, with a `designEditor` tag its
      lanes claim, and a test asserting every `ci.inert` tag is claimed by some
      lane

### Two ends, two independent kinds of drift

`actions/checkout` leaves `HEAD` at the **merge commit** for `pull_request`, and
`merge-base(base.sha, merge_commit)` is `base.sha` itself whenever the merge
already contains it — so three-dot collapses to two-dot and sweeps in whatever the
merge brought along. On top of that, `payload.base.sha` is *not* the base branch's
tip: GitHub records it at PR creation/sync while `refs/pull/N/merge` is rebuilt
against the base's current tip, so **the two ends drift apart with nobody touching
the branch**. #817 ran twice without changing and flipped:

```
02:08  head 8de60d6fd   full=false heavy=false ciConfig=false   agent, docsProse
04:48  head 637226ef1   full=true  heavy=true  ciConfig=true    "gating file changed"
```

The three `ciConfig` files it "changed" were all #821's. **Both bugs failed toward
running more CI**, which is why nine merged PRs never surfaced them: the cost was
a filter that quietly did nothing for any branch behind its base — most branches —
plus a false label on PRs that never touched CI config.

**Removing the label would have been worthless without 4c.3b.** The question that
found it: does pressing "Update branch" or rebasing actually clear the label? The
re-run happens (both are `synchronize`, and `ci.yml`'s `pull_request:` trigger has
no `types:`, so it defaults to `[opened, synchronize, reopened]`) — but the
re-resolution was still wrong. Three-dot absorbs a stale base only while the branch
is BEHIND it; a rebase puts the branch AHEAD, `merge-base(stale_base, head)`
collapses to `stale_base`, and the label gets re-applied from `main`'s own commits.
So the base is now taken from the merge ref's first parent, else
`origin/<base.ref>`, else `base.sha`. The fast-forward case is why there are two
fresh sources rather than one: a rebased branch is fast-forwardable, and a
fast-forwarded merge ref has no second parent to read.

### The inert-package trap

An inert match **short-circuits** the `packages/` classification in `classify`, so
an inert package never enters `changedPkgs`, never enters the reverse closure, and
never appears in `packages`. A lane selecting on `pkgs` alone is therefore
**unreachable**, and so is one selecting on `anyPkg` — the entry would make the
package skippable *and* untested, with the lane still present and still looking
like coverage. `documentation:build` already carried a tag for this reason;
nothing recorded why, so `design-editor:check` was one line away from silently
losing its coverage. `verify-self-lanes.test.mjs` now asserts every `ci.inert` tag
is claimed by a lane.

**The `anyPkg` half of that was caught by rebasing, not by the test.** #819 added
`packages/design-editor` to `knip.json`'s `workspaces`, which makes knip's
dead-code pass a gate a design-editor change can fail — and `verify:entropy` is
selected by `anyPkg`, which an inert package cannot reach. The tag test passed
either way, because one claimant (`design-editor:check`) satisfied it. So the tag
is now claimed by both lanes, and the rule to apply when listing any package inert
is: **enumerate every gate that can currently fail on it, and confirm each one's
route in is a tag rather than `pkgs` or `anyPkg`.** A design-editor change selects
6 of 28 lanes (its check, entropy, and entropy's four engine builds) and still
skips both heavy jobs.

## Phase 4d: Review-panel findings on the diff-base PR ✅

- [x] 4d.1 Bind `ci-context/pr-number` to the run before any write. It is written
      by a job that ran the PR's code, so on a fork it is attacker-chosen; the App
      token was aimable at any issue in the repository. The named PR's head must be
      `run.head_sha`
- [x] 4d.2 Recompute the `ci-config-changed` decision in the reporter from
      `pulls.listFiles` + `ci.ciConfig` on the **default branch**, instead of from
      `areas.ciConfig`. Two independent defects, one fix: the artifact is
      fork-controlled (a PR could delete its own warning), and `ciConfig: false` is
      ambiguous at the producer — `classify()` emits it for every fail-safe
      resolution, so it can mean "no gating file changed" OR "we never found out"
- [x] 4d.3 Hold the label, never clear it, when the globs are unreadable or the
      file list hit the API's 3000-file truncation
- [x] 4d.4 Guard the duplicated `globToRegExp` in `ci-report.yml` against drift by
      extracting it from the YAML and comparing to the module over a glob × path
      corpus
- [x] 4d.5 Cover the `push` branch of `resolveRefs`. It had none: the only push
      test asserts the push-to-`main` deploy gate, which short-circuits in
      `resolve()` before `resolveRefs` is reached
- [x] 4d.6 Make the "via the merge ref's first parent" subtest isolate source 1 by
      hiding the base branch. It passed via the `baseBranchTip` fallback — neutering
      `mergeRefBaseTip` entirely left all 61 tests green

### Two findings not acted on, with reasons

- **"`designEditor` omits `verify:doc-index`, a gate a design-editor-only change
  can fail."** It cannot. `verify-doc-index.mjs` checks one direction only — every
  directory present in `packages/` must be linked from `packages/README.md`. Nothing
  *inside* `packages/design-editor/` can fail it; verified by deleting the whole
  package, which still passes (the stale index row goes unnoticed, which is a
  separate and pre-existing gap shared with `packages/documentation`). Only *adding*
  a `packages/<name>/` can fail it, and an unknown package is unmapped ⇒ full run.
- **"The reduced-run gate is computed by code from the PR under review."** Real, and
  pre-existing — this diff does not touch `ci.yml`. `ciConfig` guards against
  mistakes, not a hostile author, because the code deciding `ciConfig` is the code
  under review. Fixing it means resolving from the base branch in the `changes`
  job — the pattern `ci-report.yml` now uses for the label. Recorded in
  `docs/design/harness-engineering.md` and Phase 5 below rather than folded in here.

## Phase 5: Deferred

- [ ] 5.0 Run the `changes` job's resolver from the **base** branch, not the PR's
      tree, so a reduced run is trustworthy against a hostile branch and not only
      an honest one. See the "cannot grade its own homework" scope note in
      `docs/design/harness-engineering.md`.

- [ ] 5.1 Tighten `verify-browser` / `verify-integration` to per-package reverse
      closure. v1 keeps `packages/**` ⇒ both, on purpose (see lessons).
- [ ] 5.2 Teach `wafflebase/agent-pipeline`'s `summarize-ci.mjs` to render
      `filtered`. Until then it is absent from that tool's counts (safe, but
      incomplete) — it cannot be changed in this repo without failing
      `pipeline-drift`.
- [ ] 5.3 Revisit `verify:entropy`'s `needs`. It declares all four engine builds
      conservatively, which makes any package change pull ~47s of builds. If knip
      does not actually need the dists, dropping them is free speed.

## Constraints discovered during planning

- **`scripts/agent/summarize-ci.mjs` must not be edited here** — because it is
  not what runs. The agent workflows execute `wafflebase/agent-pipeline` at a
  pinned commit; the copy in this repo is a mirror that only backs the
  `agent:tests` lane, so editing it would change nothing that executes and would
  register as drift in `scripts/verify-pipeline-drift.mjs` (which does not list
  `summarize-ci.` in its `STAYS` exclusions).

  Note: #798 made the `pipeline-drift` job **advisory** (`continue-on-error`)
  while the mirror still exists, so an edit would warn rather than fail. That
  removes the enforcement, not the reason — the tool that actually renders the CI
  summary lives in the other repository either way.

  So the new lane status is named `filtered` rather than reusing `skip`
  specifically so the pinned pipeline's `summarize-ci.mjs` *ignores* it instead of
  mislabeling it as "skipped because an earlier lane failed"
  (`summarize-ci.mjs:102`). Teaching it to render `filtered` is a follow-up in
  that other repo (5.2).
- **`packages/docs|slides|sheets|core` can break `verify-integration` with zero
  backend files touched** — `ci.yml` builds those four for that job, and the e2e
  set includes `docs-cli-roundtrip`, `notes-cli-roundtrip`, `slides-pptx-import`.
- **`verify-browser` never touches the backend** — `verify-browser-lanes.mjs`
  builds only core + sheets and runs Playwright; no Postgres, no Yorkie, no
  `webServer`. `packages/backend/**` → browser is not a real edge.
- **`pipeline-drift` stays ungated** — it is the correctness gate on the very
  area being sped up, and costs ~30s.
