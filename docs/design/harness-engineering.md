---
title: harness-engineering
target-version: 0.2.0
---

# Harness Engineering

## Summary

This document defines the harness engineering strategy for Wafflebase:
verification lanes, architectural constraints, quality gates, agent-oriented
feedback loops, and local/CI reproducibility.

The term "harness engineering" describes the practice of building tooling and
constraints that keep AI agents — and human engineers — producing reliable,
maintainable software. Where context engineering asks *what should the agent
see*, harness engineering asks *what should the system prevent, measure, and
correct*.

As of 2026-03-11, phases 1 through 20, 22, and 23 are completed, and the
agent-oriented pipeline (Phases 24–27) has since shipped: the autonomous
contribution loop, the local Spec→PR front door, Tier-1 autonomous issue
hunting, and the panel feedback corpus all live in the `.github/workflows/`
`agent-*` workflows (e.g. `.github/workflows/agent-review-panel.yml`) and under
`scripts/agent/` (e.g. `scripts/agent/review-panel.mjs`, `scripts/agent/hunt.mjs`,
`scripts/agent/harvest.mjs`). Browser
visual and interaction lanes are integrated into `verify:self` with graceful
Chromium skip. Docker-based browser testing ensures consistent font rendering
across macOS and CI (Ubuntu). Structured JSON lane reports are generated per
lane and as a summary. Dependency freshness (vulnerability + outdated package
detection) is integrated into `verify:entropy`. PR verification evidence is
automated via CI artifact upload and auto-comment on PRs. Remaining work
is the rest of Phase 21's agent observability stack (structured backend
logging, per-branch observability context) and autonomous issue-filing
(Phase 26 Tier 2).

## Principles

These five principles, adapted from
[OpenAI's harness engineering practice](https://openai.com/index/harness-engineering/),
guide how we design and evolve the Wafflebase harness.

### 1. Information Accessibility — "A Map, Not a Manual"

What agents can't see doesn't exist. Keep institutional knowledge in the
repository as structured, queryable artifacts — not in external docs or tribal
knowledge.

**How we apply this:**
- `CLAUDE.md` at repo root serves as a concise map (~100 lines) pointing to
  deeper sources of truth in `docs/design/`, `packages/*/README.md`.
- Design documents live in `docs/design/` and are cross-linked from the root.
- Task history is tracked in `docs/tasks/` with paired todo/lessons files.
- Harness policy is externalized to `harness.config.json` (versioned,
  reviewable).

### 2. Mechanical Enforcement — "Constraints Over Documentation"

Text-based guidelines drift. Enforce architectural rules programmatically so
that violation is technically impossible, not merely discouraged.

**How we apply this:**
- Frontend architecture boundaries enforced via ESLint
  (`packages/frontend/eslint.arch.config.js`): API, hooks, components, UI, and
  types layers cannot import across boundaries.
- Backend architecture boundaries enforced via ESLint
  (`packages/backend/eslint.arch.config.mjs`): controller, database, auth,
  user, and document modules are isolated.
- Zero-warning lint gate: no warning suppression, warnings are build failures.
- Frontend chunk budgets enforced mechanically
  (`scripts/verify-frontend-chunks.mjs`), not by code review.
- ANTLR generated files are `@ts-nocheck` by convention — regeneration is the
  only valid edit path.

### 3. Visual Feedback — "Give the Agent Eyes"

Agents need observable, verifiable feedback — not just pass/fail. Visual
baselines, interaction replays, and deterministic screenshots let agents (and
humans) see what changed.

**How we apply this:**
- Browser screenshot baselines via Playwright (desktop + mobile profiles).
- Screenshots are compared with a perceptual per-pixel threshold plus a small
  mismatched-pixel budget (`pixelmatch`), not byte-exact PNG equality — Chromium
  antialiasing is not bit-reproducible across CI runs, so an exact check flakes
  on a handful of sub-pixel-jitter pixels. Tunable via
  `VISUAL_PIXELMATCH_THRESHOLD` / `VISUAL_MAX_DIFF_RATIO` /
  `VISUAL_MAX_DIFF_PIXELS_FLOOR`; a `*.diff.png` is emitted on real mismatches.
- Interaction regression tests replay cell input, formula evaluation, and
  scroll behavior in a real browser.
- Canvas-based rendering makes visual regression testing essential — DOM
  diffing alone is insufficient.

### 4. Capability-First Debugging

When the harness fails or agents struggle, ask "what capability is missing in
the environment?" rather than "why is the agent broken?" Treat agent failure
as a signal to improve the harness.

**How we apply this:**
- Each completed phase has a paired lessons file
  (`docs/tasks/archive/*/lessons.md`) capturing what went wrong and what harness
  improvement fixed it.
- Flaky tests are treated as harness bugs (missing determinism), not test bugs.
- New verification lanes are added when a class of regression goes undetected.

### 5. Entropy Management — "Garbage Collection for Codebases"

Codebases accumulate entropy: dead code, inconsistent patterns, documentation
decay. The harness must include cleanup loops that detect and reduce entropy
systematically.

**How we apply this:**
- Lint warning cleanup phases (9-10) established a zero-warning baseline.
- Build chunk cleanup (phase 11) removed dead manual chunk splits.
- Task lessons files capture recurring patterns for future prevention.
- Architecture lint prevents new boundary violations from accumulating.

## Goals

- Keep verification deterministic and reproducible between local and CI.
- Fail fast on signal-quality regressions (lint noise, oversized bundles,
  visual drift).
- Make integration validation executable with one local command.
- Keep harness policy configurable and reviewable in versioned files.
- Enforce architectural boundaries mechanically, not by code review.
- Provide observable feedback loops for both human and agent workflows.

## Non-Goals

- Replace the CI provider or pipeline framework.
- Add broad test sharding/optimization before reliability goals are met.
- Introduce path-based selective execution ahead of baseline stability.
- Build custom LLM-based linters before deterministic rules are exhausted.

## Local Git Hooks

Git hooks provide local defense layers in addition to CI. All hooks live in
`.githooks/` and are activated automatically via `core.hooksPath` (set by the
`postinstall` script — no manual setup required).

### Pre-Commit Hook

Runs `pnpm verify:fast` before every commit.

- **Scope:** architecture + lint + typecheck + unit tests (~11 s).
- **Out of scope:** builds, visual regression, entropy — these are caught by
  the pre-push hook.
- **Bypass:** `git commit --no-verify` skips the hook for emergencies.

### Pre-Push Hook

Runs `pnpm verify:self` before every push.

- **Scope:** everything in `verify:fast` plus sheet/frontend/backend/cli
  builds, frontend chunk budget gate, and entropy checks (dead code, doc
  staleness, dependency freshness).
- **Out of scope:** browser and integration tests — these require Docker
  Chromium / PostgreSQL and are covered by `verify:ci` in CI.
- **Purpose:** catches build failures, broken doc refs, and dead code before
  they reach the remote — issues that are too slow for per-commit but should
  not land on a shared branch.
- **Bypass:** `git push --no-verify` skips the hook for emergencies.

## Claude Code Hooks

Claude Code hooks extend mechanical enforcement to the agent level. Where
the git pre-commit hook catches violations at commit time, Claude Code hooks
catch them at edit time — before the agent writes invalid code.

Hooks are registered in `.claude/settings.json` (team-shared, git-tracked).
Hook scripts live in `scripts/hooks/`.

| Hook | Event | Purpose |
|---|---|---|
| `scripts/hooks/guard-generated-files.sh` | PreToolUse(Edit\|Write) | Blocks editing ANTLR-generated files in `packages/sheets/antlr/` (`.g4` allowed) |
| `scripts/hooks/check-arch-boundary.sh` | PostToolUse(Write) | Runs arch lint after new files in frontend/backend (informational) |

### Adding New Hooks

1. Create a script in `scripts/hooks/` that reads JSON from stdin.
2. Parse `tool_input.file_path` from the input.
3. Exit 0 to allow, exit 2 to block (STDERR is fed to Claude as context).
4. Register in `.claude/settings.json` under the appropriate event.

## Lane Contract

### Self-Contained Lanes (no external services)

| Command | Purpose |
|---|---|
| `pnpm verify:architecture` | Frontend/backend import boundary checks |
| `pnpm verify:fast` | Architecture + lint + unit tests |
| `pnpm verify:frontend:chunks` | Built JS chunk size/count gate |
| `pnpm verify:frontend:visual` | Playwright screenshot baseline (desktop+mobile) |
| `pnpm verify:frontend:interaction` | Browser interaction regression (cell input, formula, scroll) |
| `pnpm verify:browser:docker` | Browser visual+interaction via Docker (CI-consistent) |
| `pnpm verify:entropy` | Dead-code (knip) + doc-staleness entropy gate |
| `pnpm verify:doc-index` | Index-coverage gate — every package, design doc and top-level script is reachable from its README |
| `pnpm verify:self` | Runner: 28 lanes — per-package typecheck/test, builds, chunk budgets, entropy; generates `.harness-reports/` JSON |

`verify:entropy` and `verify:doc-index` are complements over the same prose and
must not be folded together. Entropy walks *links → disk*: for each reference in
`docs/design/**/*.md` it checks the target still exists, which catches a file
that moved or was deleted. Doc-index walks *disk → index*: it catches a file
that was added and never indexed, which nothing points at and which therefore
leaves no broken reference to find. That second direction is why
`packages/README.md` was missing four of eleven packages while every link in it
still resolved.

Entropy reads every design doc, at any depth. It used to read only the top
level, which meant 24 of 110 — the convention it enforces was contradicted 886
times in the subdirectories it never opened. It resolves a reference the way a
reader does: against the repository root, the citing document's own directory,
the design directory, and finally the tail of a tracked path, so the
package-relative and elided forms the docs actually use resolve instead of being
reported as missing.

What it cannot do is tell drift from a doc naming a file on purpose to record
that the file does *not* exist — "a mixed selection renders no per-type section,
so there is no `mixed-controls.tsx`" is accurate prose, not a stale link. Those
carry an `entropy.docStaleness.advisory` entry in `harness.config.json`, each
with a reason, printed on every run and never counted toward failure. Prefer the
`doc` + `ref` shape over `pattern`: it downgrades one named reference and leaves
the rest of that doc blocking, so a doc carrying a planned-file name today still
fails on real drift tomorrow.

Entropy still reads no README outside the design tree, so doc-index drops any
link resolving to a nonexistent path before counting it as coverage, which is
the only dead-link check the package and script indexes get.

Coverage is top-level by design. A directory counts as covered once its index
names it — `scripts/agent/` alone holds over a hundred files, and a gate
demanding a row per file produces an index nobody maintains. The same rule lets
one umbrella row cover a subtree: `docs/design/README.md` links `docs/tables/`
once, and an ancestor-directory link covers the per-feature docs beneath it, so
no exception list has to be kept in the gate.

**Lanes are a graph, not a list.** Each lane declares what it is *about*
(`pkgs` / `tags` / `anyPkg`) and what it needs *built* (`needs`), and selection
takes the transitive closure over `needs` — `frontend:test` resolves
`@wafflebase/core` through that package's `exports` to a gitignored `dist/`, so
selecting it without `core:build` would run a broken suite rather than a smaller
one. `needs` edges must point backwards in the array; `laneOrderViolations`
refuses to start otherwise, because the selection closure cannot catch a forward
edge and the resulting failure surfaces inside an unrelated package.

The edges were established per package rather than assumed: no engine package has
tsconfig `paths` (so sheets/docs/slides/board/cli resolve through `dist/`); the
frontend aliases the five engines to `src/` in `packages/frontend/vite.config.ts` and does *not*
alias core (so its lanes need only `core:build`); the backend's jest
`moduleNameMapper` maps every workspace import, core included, to `src/` (so
`backend:test` needs no build, while `backend:build` does); and `notes` and
`design-editor` declare no workspace dependency at all.

`pnpm verify:fast` is unchanged and remains the `pre-commit` gate. `verify:self`
no longer shells out to it — the duplicated `pnpm core build` in that chain is
why.

**Branch-integrity gate.** `verify:self` records `HEAD` before the lanes and
re-reads it after each one. A lane that moves `HEAD`, or leaves it unreadable,
fails **even if it exited 0** — a lane can corrupt the repository and still
report success. The lane report carries `status: "fail"` with a non-zero
`exitCode` even when the lane's own exit code was 0, so no consumer is handed a
report that reads as both failed and successful.

The gate detects *net* movement of `HEAD` only. A lane that commits and resets
back, rewrites another ref, or mutates the index or stash is **not** covered;
the narrow guarantee is stated deliberately, because overclaiming invites
trusting a green run. It exists because a test fixture escaping its temp
directory replaced a working branch's tip three times, and one of those states
reached a public PR as a diff appearing to delete every file in the repo.

### Integration Lanes (require database)

| Command | Purpose |
|---|---|
| `pnpm verify:integration` | Prisma migrate + backend e2e |
| `pnpm verify:integration:local` | Skip integration when DB is unreachable |
| `pnpm verify:integration:docker` | One-command: postgres up + integration + stop |
| `pnpm verify:integration:repeat` | Repeat-run stability check (default 3 runs) |

### CI Lanes (require Docker Chromium + database)

| Command | Purpose |
|---|---|
| `pnpm verify:ci` | Runner: browser visual/interaction + integration; generates CI summary report |

### Composite Lanes

| Command | Purpose |
|---|---|
| `pnpm verify:full` | `verify:self` + `verify:ci` |

### CI Contract

- `changes` job runs first and decides what the change can affect (see
  [Path-aware CI](#path-aware-ci)). Every gate reads its outputs.
- `verify-self` job depends on `changes` (no external services).
- `verify-browser` job depends on `verify-self` and runs browser visual +
  interaction tests inside a Docker container for font-rendering consistency.
- `verify-integration` job depends on `verify-self` and provisions PostgreSQL.
- Harness reports (`.harness-reports/`) are uploaded as CI artifacts (14-day
  retention).
- **`.github/workflows/ci.yml` itself is read-only** (`permissions: contents: read`). Every write to
  a pull request happens in `.github/workflows/ci-report.yml`; see
  [Reporting onto a fork PR](#reporting-onto-a-fork-pr).
- On PRs, `.github/workflows/ci-report.yml` posts one comment reporting CI's
  **scope** — which heavy jobs were skipped and why, which changed file forced
  the full suite, how many lanes were filtered — and applies `ci-config-changed`
  when the mapping was touched. It deliberately does not repeat pass/fail: the
  PR's own checks list already shows that, and `scripts/agent/mark-ready.mjs`
  reads the Actions API rather than this comment precisely because a comment is
  author-writable.
- CI triggers on `push` to `main`, `pull_request` targeting `main`, and
  `merge_group` (see below).

### Reporting onto a fork PR

`.github/workflows/ci.yml` used to post its own verification comment, and **it never worked for how
this project actually receives contributions.** A fork's `pull_request` run gets a
read-only `GITHUB_TOKEN` and no secrets, so `createComment` failed silently; the
step's `continue-on-error` is why nobody noticed. Every merged PR from #789 to
#798 came from a fork and not one received the comment.

It cannot be fixed by adding a token to `.github/workflows/ci.yml`, for two independent reasons:

1. **Secrets are withheld from a fork's `pull_request` run**, so
   `secrets.AGENT_APP_ID` would be empty on exactly the PRs that need it. The
   `CODECOV_TOKEN` note in `verify-self` records the same constraint.
2. Even if it were populated, `verify-self` runs `pnpm verify:self` — arbitrary
   build and test code from the PR's tree. A write-capable token in that
   environment is a token the PR author can exfiltrate.

So the writes moved to a `workflow_run`-triggered reporter, which runs in the base
repository with access to secrets and runs *its own* copy from the default branch
rather than the PR's. This is the same reasoning `.github/workflows/agent-summarize.yml` and
`.github/workflows/agent-review-on-demand.yml` apply from `issue_comment`, and it reuses their App:
`actions/create-github-app-token` with `AGENT_APP_ID` / `AGENT_APP_PRIVATE_KEY`,
scoped to `issues: write` (which covers both PR comments and PR labels).

**The invariant that makes the token safe:** the reporter performs no checkout of
pull-request code, runs no `pnpm`, and executes nothing from the triggering run.
It reads two artifacts as *data* and calls the API. Adding a checkout of
`head_sha` or a build step there would hand the token to the fork.

**The invariant that follows from it:** reads run in their own
`actions/github-script` step on the ambient token, writes in a second step on the
App token — never both in one step. `github-script` binds exactly one client per
step, and because there is no checkout there is no `node_modules`, so a second
client cannot be built inside a step body: `require('@actions/github')` throws
`Cannot find module` before the first API call. #831 did exactly that, and since a
`workflow_run` workflow cannot fail its own pull request, it silently cost every
PR both the comment and the `ci-config-changed` label until the split.
`scripts/test/ci-workflow.test.mjs` holds both halves — inline scripts may
`require` only Node builtins, and the read endpoints never appear in the
App-token step.

Consequences worth knowing:

- The resolution and the PR number travel in a `ci-context` artifact, because
  `github.event.workflow_run.pull_requests` is **empty for a fork PR** — it is
  populated only for same-repo branches, the one case that never needed this.
- Artifact contents are attacker-controlled (lane names come from the PR's own
  `scripts/verify-self.mjs`, reasons embed its diff paths). They are only interpolated
  into markdown, never executed, but are still collapsed for `|`, backticks,
  angle brackets and newlines so a crafted name cannot smuggle HTML or forge the
  `<!-- harness-verification -->` marker under the bot's identity, and
  length-capped so it cannot flood the comment. The lane counts take the same
  risk through a different door and so are coerced to numbers rather than
  collapsed: a count that is not a number is a `.harness-reports/` summary written
  to smuggle markup, and the line is dropped.
- Heavy-job outcomes are read from the run's job list rather than a second
  artifact, so *skipped* is distinguishable from *never wrote a file*. That is
  also what collapses the old two-phase "⏳ pending…" comment into one. What it
  reads is the **gate-marker step**, not the job's conclusion: `ci.yml` gates the
  steps and never the job, because a job-level `if:` renames the check run away
  from the required context — so a heavy job that did nothing still concludes
  `success`, and believing the job would report every reduced run as a full one.
- The comment reports CI's **scope** — what was skipped, which changed file forced
  the whole suite, how many lanes were filtered — and not pass/fail, which the
  PR's checks list already shows. Its heading is always what the run did; the
  gating-file list is recomputed independently and can only ever be a reason
  appended to that. Nothing machine-reads the comment:
  `scripts/agent/mark-ready.mjs` takes the run conclusion from the Actions API,
  because a comment is author-writable.
- Without the App configured the reporter degrades to the ambient token, which
  still works for same-repo PRs. The `changes` job's **run summary** needs no
  token at all, so it remains the copy that always survives.
- **The PR number is bound to the run before anything is written.**
  `ci-context/pr-number` is produced by a job that ran the pull request's own code,
  so on a fork it is attacker-chosen — and unvalidated it aims the App token at any
  issue in the repository. The reporter now requires the named pull request's head
  to be this run's commit (`run.head_sha`, which is the PR head, not the merge
  commit). A re-run of a superseded commit therefore reports nothing; that is the
  safe direction, since a stale report is worse than a missing one and the newer
  run posts its own.
- **`ci-config-changed` tracks the current state in both directions, and is
  computed from data the pull request cannot write.** It shipped add-only, which
  made it monotonic: whatever set it once — a since-reverted gating file, or the
  `base.sha...HEAD` bug above — kept it set for life, and a reviewer could not tell
  a stale label from a live one. Making it removable is what forced the second
  half. `areas.ciConfig` was the obvious input and is the wrong one, twice over:
  it comes from the fork-written artifact, so a pull request could delete its own
  warning; and `false` is **ambiguous at the producer**, because `classify()` emits
  it for every fail-safe resolution too (no diff base, a failed `git diff`, an
  empty diff), so it can mean "no gating file changed" or "we never found out".
  Only the first may clear a label. So the reporter recomputes: the file list from
  `pulls.listFiles`, the globs from `ci.ciConfig` on the **default branch**. Both
  are beyond the pull request's reach, which makes the label right by construction
  rather than by trusting its subject. It holds the label — never clears it — when
  the globs are unreadable or the file list came back truncated at the API's 3000-file
  cap, on the same principle.

  Two consequences. The workflow carries its own copy of `globToRegExp`, because it
  deliberately checks out no code; `scripts/test/ci-workflow.test.mjs` extracts that
  copy from the YAML and asserts it agrees with `scripts/changed-areas.mjs` over a
  glob × path corpus, so the duplication cannot drift into disagreeing with the run
  it describes. And dropping monotonicity costs ordering: `concurrency` is keyed on
  the triggering run, so two runs for one pull request do not serialise and an older
  one finishing last can write a stale answer. Accepted — the next run corrects it,
  the comment body already had that property, and nothing mechanical reads the label.

### Path-aware CI

An agent-only PR used to build a Playwright image and provision Postgres and
Yorkie to run tests that cannot reach `scripts/agent/`. Two layers fix that.

**Why it is a job and not a trigger.** A workflow filtered out by `on: paths:`
produces **no check run at all**. `main`'s required contexts then never report,
and a merge-queue entry waits on them until its status-check timeout dequeues it.
A job that runs reports under a name the queue recognises.

**And why the gate is on the steps, not on the job.** The obvious version — give
the heavy jobs a job-level `if:` and let GitHub record them as `skipped`, which
does satisfy a required check — is wrong, and #803 shipped it before a real
merge-queue entry proved it. **A job with a `strategy.matrix` that is skipped by
its own `if:` never expands the matrix**, so it files its check run under the bare
job name. Measured on the `merge_group` SHA for #799:

```
verify-self (22.x)      success     ← ran, so the matrix expanded
verify-browser          skipped     ← BARE NAME
verify-integration      skipped     ← BARE NAME
```

`main` requires `verify-browser (22.x)` and `verify-integration (22.x)`. Neither
name existed on that SHA, so the entry sat on *"Expected — Waiting for status to
be reported"* and would have been dequeued at the status-check timeout — the exact
failure the job-level filter was chosen to avoid, reached by a different route:
not a missing check *run*, a missing check *name*. MAINTAINING.md's warning that
"required check names must keep matching" is about renaming a job; skipping a
matrix job renames it too.

So `verify-browser` and `verify-integration` always run and always expand, and
every step inside them carries the gate. When there is nothing to test they no-op
and report success in seconds — the semantics the skip was reaching for, under a
name that exists. `scripts/test/ci-workflow.test.mjs` fails if either job regains
a job-level `if:` referencing the filter decision, or if a step loses its gate.

A matrix job *may* still carry an `if:` that can only be false when the run is
already doomed: `needs.verify-self.result == 'success'` is fine, because a failed
`verify-self (22.x)` reports the failure and the entry is dequeued rather than
stranded.

**The mapping is an allow-list.** `harness.config.json`'s `ci.inert` lists the
only paths permitted to shrink a run; a changed path matching nothing forces the
full suite. A new package, a new top-level directory, or a file nobody classified
is therefore covered by default, with no catch-all rule to remember. Never invert
this into a list of paths that *do* trigger things.

**Two workspace packages are inert, and listing one takes a second edit.**
`packages/documentation` (the VitePress site) and `packages/design-editor` (the
dev-only Vite plugin) are leaves: no manifest in the workspace depends on either,
and `packages/frontend/vite.config.ts` does not register the plugin, so neither
can reach the engines, the frontend, or the heavy jobs.

The second edit is the trap. An inert match **short-circuits** the `packages/`
classification in `classify`, so an inert package never enters `changedPkgs`,
never enters the reverse closure, and never appears in `packages` — which means a
lane selecting on `pkgs` alone becomes **unreachable**, and so does `anyPkg`.
Left there, the entry would make the package skippable *and* untested, which is
strictly worse than not listing it: the lane still exists, still looks like
coverage, and never runs. So each inert package's entry carries a tag its lanes
also claim, and `scripts/test/verify-self-lanes.test.mjs` asserts that every tag
in `ci.inert` is claimed by some lane.

**How many lanes have to claim the tag is a per-package question**, and the
answer differs for these two:

| Package | In `knip.json`? | Tag claimed by |
| --- | --- | --- |
| `documentation` | no | `documentation:build` |
| `design-editor` | **yes** (added by #819) | `design-editor:build`, `design-editor:check`, `design-sandbox:check` **and** `verify:entropy` |

`design-editor` needs the second claimant because knip analyses it, so its
dead-code pass is a gate a change there can genuinely fail — and `anyPkg`, which
is how `verify:entropy` normally gets selected, cannot see an inert package. With
only `design-editor:check` claiming the tag, dead code added under
`packages/design-editor/` would pass its PR and first fail on `main`'s push run.
That cost the four engine builds in entropy's `needs`; a design-editor change
selects 8 of 32 lanes and still skips both heavy jobs — checkable against the
lane graph, which is the point of stating it as a number.

`design-editor:build` is a claimant of the same tag for a different reason, and
the reason runs the OTHER way: since #966 the package's `exports["."]` names its
built plugin entry under `dist/plugin/`, so every consumer needs that build —
including
knip, which loads `packages/design-sandbox/vite.config.ts` to discover its
plugins. Entropy therefore `needs` it on **any** package change, not only on a
tagged one, and the tag is what lets a design-editor-only change reach it at all.
A `needs` edge into an inert package's build lane is the shape to reach for
whenever an inert package starts publishing a built entry: the general rule when
listing a package inert: **enumerate every gate that can currently fail on it,
and check each one's route in is a tag rather than `pkgs` or `anyPkg`.**

**Five unrelated failures all mean "run everything"** — no diff base, an
unreadable event payload, a failed `git diff`, an empty diff, a corrupt
hand-off — and each is a test in `scripts/test/changed-areas.test.mjs` rather
than a claim. `ci.ciConfig` adds a sixth: a PR that edits the mapping is measured
by the full suite, so it cannot use the filter to grade its own homework.
`.github/CODEOWNERS` is the review half of that guard.

**The scope of "cannot grade its own homework", stated exactly.** It is a guard
against *mistakes*, not against a hostile author. The `changes` job runs
`scripts/changed-areas.mjs` **from the pull request's own tree**, so a PR that
rewrites the resolver to report `full: false, heavy: false` gets the reduced run it
asked for, and `verify-browser` / `verify-integration` report `skipped`, which
branch protection counts as passing. `ciConfig` cannot catch that, because the code
deciding `ciConfig` is the code under review. What remains is human: the diff shows
the tampering, `.github/CODEOWNERS` puts a maintainer on it, and merge still needs
an approving review.

Closing it mechanically means resolving from the base branch rather than the head —
the pattern `ci-report.yml` already uses for the label (it reads `ci.ciConfig` from
the default branch precisely because the PR's copy is untrusted). That is a change
to `ci.yml`'s `changes` job, not to the resolver, and is deliberately **not** part
of the diff-base work; it is tracked as Phase 5 in
`docs/tasks/active/20260812-path-aware-ci-todo.md`. Until then, treat a reduced run
as evidence about an honest branch only.

**Both ends of the diff come from the event payload, and that is load-bearing.**
`resolveRefs` returns `{ base, head }`; on a `pull_request` those are
`base.sha` and `head.sha`, never the checked-out `HEAD`. `actions/checkout`
leaves `HEAD` at the **merge commit** for that event, and diffing a merge commit
against `base.sha` does not describe the pull request — `merge-base(base.sha,
merge_commit)` is `base.sha` itself whenever the merge already contains it, so
the three-dot form collapses to two-dot and sweeps in whatever the merge brought
along. Measured on #805, whose real change is five inert files:

```
base.sha ... merge_commit   ->  75 files, 18 of them ciConfig   (full run)
base.sha ... head.sha       ->   5 files,  0 ciConfig           (correct)
base.sha ..  head.sha       ->  15 files,  1 ciConfig           (full run)
```

#805 therefore ran the whole suite. That is the safe direction and it is useless:
**any branch behind its base inherits its base's recent history as "changed"**,
and in an active repository that is most branches — so the filter was quietly
doing nothing for them while looking like it worked. The dot count matters too,
in the opposite direction: two-dot compares the trees, so commits the base has
and the head lacks read as changes belonging to the pull request. Three-dot
against the payload's `head.sha` is the only form that is right on both counts,
and both are pinned by tests.

**`base.sha` is not the base branch's tip, and is resolved last for that reason.**
GitHub stamps it when the pull request is created or synchronized and then leaves
it alone, while `refs/pull/N/merge` is rebuilt against the base's *current* tip. So
the two ends drift apart on their own, without anyone touching the branch, and the
gap grows with every merge to `main`. #817 is the clean demonstration, because it
ran twice without changing:

```
02:08  head 8de60d6fd   full=false heavy=false ciConfig=false   agent, docsProse
04:48  head 637226ef1   full=true  heavy=true  ciConfig=true    "a CI gating file changed"
```

Four commits reached `main` in between. Nothing in #817's own five files changed;
`base.sha...merge_commit` grew to 39 files, three of them `ciConfig`
(`package.json`, `scripts/verify-self.mjs`, `scripts/verify-doc-index.mjs`) — all
of them #821's, none of them #817's. The visible cost was a false
`ci-config-changed` label on a pull request that never touched CI config, which is
exactly the kind of alarm that trains reviewers to ignore the alarm.

Three-dot absorbs a stale base only while the branch is **behind** it: the fork
point is still the fork point. It stops absorbing anything the moment the branch
goes **ahead** — a rebase, a force-push, or the **Update branch** button — because
`head` then contains those commits, `merge-base(stale_base, head)` collapses to
`stale_base`, and the base branch's history is charged to the pull request again.
Measured on a rebase over two unrelated `main` commits:

```
stale base.sha ... rebased head  ->  feature.txt, harness.config.json, other.txt
real base tip  ... rebased head  ->  feature.txt
```

That is the pre-merge state of nearly every pull request, so `resolveRefs` takes
the base from the first of three sources to resolve:

| Order | Source | Why it can be trusted / why it is not first |
| --- | --- | --- |
| 1 | `refs/pull/N/merge`'s **first parent** | The base tip GitHub merged against, as fresh as the run. Absent when the merge ref fast-forwarded — which is exactly what a rebased branch allows, hence source 2 |
| 2 | `origin/<base.ref>` | Independent of the merge ref's shape |
| 3 | `payload.base.sha` | **Last.** The only one that can be stale; reaching it over-reports, which merely costs a full run |

Source 1 is only trusted when the merge commit's *second* parent is the payload's
`head.sha` — that signature is what makes the first parent the base tip rather than
some unrelated merge the branch happens to end on.

**The resolution has three consumers, trusted differently on purpose.**

| Field | Drives | Rule |
| --- | --- | --- |
| `full` | whether filtering happens at all | `true` disables selection entirely: every `verify:self` lane runs. Set by a `push` to `main`, a `ciConfig` change, and every fail-safe route |
| `packages` | which lanes run **when `full` is false** | reverse-dependency closure of the changed workspace packages |
| `heavy` | `verify-browser`, `verify-integration`, the coverage steps | **any** workspace package changed — or the scope was never resolved, below |

`full` and `packages` are separate because they answer different questions —
"is selection on?" and "select what?" — and conflating them is how a fail-safe
turns into a no-op: a resolution with `full: false` and no usable `packages`
selects *nothing*, which is why `resolve()` validates the shape of a handed-off
resolution rather than trusting that it parsed.

**A job that cannot resolve anything still succeeds.** `What changed` clones at
full depth, and that checkout occasionally stalls: measured across 30 runs it takes
13–22s and never more than 57s, while every failure sits at the job timeout with
nothing in between — a stalled clone of this history does not finish late, it does
not finish. So it gets two short attempts instead of one long one, and if neither
lands the job reports success having set `full` and `heavy` itself. Nothing is
broken on that path; the scope is simply unknown, and a red check on a run that
went on to measure everything reads as a failure that did not happen.

Succeeding is what makes that explicit `heavy` load-bearing. The gates downstream
read `needs.changes.result != 'success' || needs.changes.outputs.heavy == 'true'`,
so a job that succeeds with `heavy` unset satisfies neither term — and
`verify-browser` and `verify-integration` are required checks, which would then
report green having run nothing. That is the no-op failure mode above wearing a
different hat, and `scripts/test/ci-workflow.test.mjs` is what holds it shut.

The closure is derived from each `packages/*/package.json`, so it cannot go stale
when someone adds a dependency — the dependency *is* the mapping. The two heavy
jobs get the blunter rule because `verify-integration` builds core + docs +
slides + sheets and its e2e set includes `docs-cli-roundtrip`,
`notes-cli-roundtrip` and `slides-pptx-import`: an engine-package change with no
backend file in it can break that job. Narrowing them to the closure is deferred
until the mechanism has been observed working.

**A reduced run must not hide that it was reduced.** The `changes` job writes its
decision and reasons to the run summary — the copy that needs no token and
therefore always survives — and `.github/workflows/ci-report.yml` leads the PR
comment with the same reasons and names the `full-ci` label that overrides them.
Filtered lanes render as `⊘` and skipped-after-failure as `⏭️`, because collapsing
the two would let a real failure read as a deliberate omission.

**`filtered` is a distinct lane status, not a reuse of `skip`.**
`scripts/agent/summarize-ci.mjs` renders `skip` as "an earlier lane failed, so
this never got its turn". An unrecognised status is merely absent from that
tool's counts; a reused one would have made it state something untrue about
every filtered lane. Teaching it to render `filtered` is an outstanding
follow-up.

`overall` is `some(fail)`, not `every(pass)`: the two were equivalent only while
`skip` could not appear without a `fail` ahead of it, which is exactly what
`filtered` breaks.

**`full-ci`** on any PR forces every gated job — one click, no rebase, and not
fork-specific. It cannot work on `merge_group`, whose payload carries no PR
labels.

### Deploy gate

`.github/workflows/publish-ghpage.yml` (wafflebase.io) and `.github/workflows/docker-publish.yml` (`:latest`) used to
trigger on `push: main` as separate workflows with no `needs:`. They **raced**
ci.yml rather than waiting for it, so nothing anywhere enforced "full CI before
deploy" and a red `main` published anyway. Both now trigger on
`workflow_run: [CI] completed` restricted to `main`.

What makes the gate meaningful rather than ceremonial:

- **`push` to `main` is never path-filtered.** `scripts/changed-areas.mjs` short-circuits
  that event to `full: true`. A filtered main run would make the gate theatre.
- **Both check out `github.event.workflow_run.head_sha`, not the branch.** A
  `workflow_run` starts after its trigger finished, so `main` may already have
  advanced to a commit whose CI has not reported.
- **Four `if:` clauses, none redundant** — `conclusion == 'success'`,
  `event == 'push'` (CI also runs on `pull_request` and `merge_group`, and a
  queue commit need never reach `main`), `head_branch == 'main'`, and
  `head_repository == github.repository`. The last two matter more than they
  look: `workflow_run.branches` filters on the *triggering run's head branch*,
  and a fork's default branch is usually also called `main`, so a fork PR opened
  from its own `main` would otherwise satisfy the trigger filter.
- **Chain depth is unchanged.** GitHub allows three levels of `workflow_run`
  chaining and `.github/workflows/ci.yml` → `.github/workflows/agent-review-panel.yml` → `.github/workflows/capture-collect.yml`
  already uses all three with no headroom. These are **siblings** at level 2, not
  new links. Nothing may be inserted between CI and them.
- **`concurrency` with `cancel-in-progress` answers "deploy every few PRs?"**
  without a policy: a burst of merges queues several deploys, all but the newest
  are cancelled, and one deploy publishes the newest CI-verified tree. Safe
  because both deploys are additive and self-reconciling. `docker-publish`'s
  group is keyed so a `release` publish can never be cancelled by a later merge.
- **`packages/documentation` is now built by a lane.** Nothing built it before;
  `.github/workflows/publish-ghpage.yml` builds it via `pnpm build:all`, so a broken docs site
  failed the *deployment*. That is survivable only while the deploy is
  unconditional.
- **`paths-ignore` had to be reimplemented in a step.** `workflow_run` supports no
  path filter, and dropping `.github/workflows/publish-ghpage.yml`'s `packages/backend/**` ignore
  would shorten the window in which a client holding a cached `index.html` can
  still fetch its assets (only `KEEP_COUNT=3` deployments are retained).

The cost, stated plainly: a production deploy now lands roughly a full-CI run
after merge instead of immediately. That replaces a race in which a red `main`
published.

### Merge queue

`main`'s three required checks — `verify-self (22.x)`, `verify-browser (22.x)`,
`verify-integration (22.x)` — are green against the PR's own branch, not against
what `main` will actually contain once the PR lands. On a repository merging
several PRs a day that gap costs a rebase per PR: rebase onto `main`, wait ~18
minutes for CI, discover `main` moved again, repeat. Nothing is wrong with the
change; the queue behind it moved.

GitHub's merge queue closes that gap. A contributor clicks **Merge when ready**
instead of rebasing; GitHub builds a throwaway
`gh-readonly-queue/main/pr-<n>-<sha>` branch holding that PR merged onto `main`'s
current tip plus every PR ahead of it in the queue, requests the required checks
against that *speculative merge*, and merges when they pass. Checks now run
against the tree that will exist post-merge, which is the property a
pre-merge-only gate cannot give.

What the queue does **not** do is reduce the number of CI runs. Each queue entry
gets its own speculative build, so runs stay roughly linear in queued PRs — and
the queue *adds* runs on top of the ones a PR's own pushes already trigger. Two
settings are easy to misread here:

- **Build concurrency** is "the maximum number of `merge_group` webhooks to
  dispatch … throttling the total amount of concurrent CI builds". It caps how
  many speculative builds run at once. A throughput and cost-spike dial, not a
  total-work dial.
- **Merge limits** (minimum / maximum) batch the *merges*, not the builds.
  GitHub's docs are explicit: "Merge limits do not combine `merge_group` builds.
  Merge limits only affect merges to the base branch once one or more
  `merge_group` has satisfied build checks." Raising the maximum lets several
  already-validated entries land together; it does not make them share a run.

So the queue is not a CI-cost optimisation, and anything claiming it batches
several PRs into one run is wrong. What it buys is the two things a
pre-merge-only gate cannot: checks against the post-merge tree, and a human no
longer sitting in a rebase-and-wait loop.

**CI's side of the contract:**

- `.github/workflows/ci.yml` triggers on `merge_group: types: [checks_requested]`. This is load
  bearing — the queue waits on the required contexts by name, so if they never
  start the entry sits until the status-check timeout expires and is dequeued.
  The trigger must therefore be merged *before* "Require merge queue" is
  enabled, and is inert until then (no queue, no event).
- Required contexts are matrix job names and do not vary by event, so enabling
  the queue needs no change to the required-check list.
- The two PR-comment steps are already guarded on
  `github.event_name == 'pull_request'`. A merge-group run has no PR to comment
  on (`context.issue.number` is unset), so they skip rather than fail.
- Codecov upload is skipped on `merge_group`: the queue SHA need not ever reach
  `main` (a failing entry is dequeued, and the entries behind it are rebuilt
  without it), so coverage filed against it is unreachable from any branch. The
  `push` run on `main` covers the merged tree.
- The `workflow_run` consumers (`agent-review-panel`, `agent-iterate-ci`) stay
  inert in queue context without modification. Both gate on
  `head_branch.startsWith('agent/')` plus a `pulls.list` lookup by head branch;
  `gh-readonly-queue/main/...` matches neither, so `managed` resolves `false` and
  the expensive jobs skip. Review and the auto-fix loop belong to the PR, not to
  the speculative merge.
- Runner cost rises by roughly one CI run per queue entry, on top of the runs a
  PR's own pushes already trigger — with no grouping discount, per the settings
  above. At ~18 minutes wall clock (`verify-self` ≤9.3 min, then
  `verify-browser` ≤9.3 and `verify-integration` ≤4.4 in parallel) a 60-minute
  status-check timeout leaves ~3x headroom. Build concurrency is the only lever
  on the cost *spike*; the total is what it is.

**Residual risk.** A `merge_group` run executes the PR's code in the *base*
repository, so it is not sandboxed the way a fork's `pull_request` run is (that
one gets a read-only token and no secrets). Concretely, in this workflow that
means the PR's code runs alongside a `GITHUB_TOKEN` carrying the workflow-level
`pull-requests: write` and `issues: write`, and alongside any secret the workflow
references — here only `CODECOV_TOKEN`, whose sole step is skipped in queue
context, so it is not put into the environment of a queue run at all. It does not
mean arbitrary access to every repository secret: a run can only reach secrets
the workflow itself references.

Only users with write access can queue a PR, so this is the trust boundary that
already governs merging — but it moves code execution one step earlier, to
queueing rather than merge. Review before queueing, exactly as before merging.
Tightening the workflow-level `permissions` to per-job least privilege would
shrink the `GITHUB_TOKEN` half of this and is worth doing, but it is a change to
the `pull_request` path too, so it belongs in its own change rather than riding
along with the trigger.

Enabling the queue is a repository-admin setting, not a workflow change; the
runbook and recommended parameters live in
[MAINTAINING.md](../../MAINTAINING.md#merge-queue).

## Dependency Layering

Architectural boundaries enforce a directed dependency flow. Violations are
caught by lint, not code review.

### Frontend

```
types/lib → api → hooks → components/ui → app (pages)
```

- `types/lib`: no imports from other layers
- `api`: cannot import `app`, `components`, `hooks`
- `hooks`: cannot import `app`
- `components/ui`: cannot import `app`, `api`

### Backend

```
database → auth/user/document → controllers/modules
```

- `database`: cannot import auth, user, document, datasource, share-link
- `auth`: cannot import document, datasource, share-link
- `user`: cannot import auth, document, datasource, share-link

## Engine Package Builds

The five engine packages (`docs`, `sheets`, `slides`, `notes`, `board`) plus
`core` build in two steps, and the order is load-bearing:

```sh
vite --config vite.build.ts build   # JS bundle; emptyOutDir wipes dist/ first
tsc -p tsconfig.build.json          # declarations only, into the same dist/
```

Vite owns the JS, `tsc` owns the declarations. Declarations emitted *before*
the vite step would be wiped by its `emptyOutDir`.

`include`/`exclude` live in the build tsconfig (e.g.
`packages/docs/tsconfig.build.json`), never in the package's main
`packages/docs/tsconfig.json` — `pnpm <pkg> typecheck` reads the main one, so
excluding `test` there would silently drop test typecheck coverage from
`verify:fast`.

These packages previously used `vite-plugin-dts` with `rollupTypes: true`,
which runs `@microsoft/api-extractor` to bundle each entry into a single
declaration file. That is a *publishing* affordance, and no engine package is
published — every one is `private: true`, and the sole npm artifact
(`@wafflebase/cli`) ships no declarations at all (`tsup` is configured
`dts: false`) because it bundles the engines' **JS** inline. The rollup cost
three things: it was the slowest step of each engine build; it hard-crashed
(`InternalError: The referenced path was not found`) whenever a second build
of the same package deleted its intermediate declaration files mid-analysis;
and a crashed rollup left the entry declaration as a stub re-exporting an
already-deleted directory.

### The `verify:dts` lane

Every consumer tsconfig sets `skipLibCheck: true`, so a `dist/` with holes in
its declaration graph typechecks green and silently degrades to `any`.
`scripts/verify-dts-entries.mjs` walks each package's declared `types` and
`exports.*.types` entries, follows every relative specifier transitively, and
fails on the first that does not resolve.

It runs in two places: as a `verify:self` lane after the engine build lanes,
and in `.github/workflows/npm-publish.yml`, which runs no typecheck of its own
and would otherwise publish against a broken `dist/` unnoticed. Named packages
are
required (missing `dist/` fails); with no arguments, unbuilt packages are
skipped, since each caller builds only the subset it needs.

## Completed Phases (1-20, 22, 23)

| Phase | Scope | Status |
|---|---|---|
| 1 | Root verification lanes + PR evidence baseline | Completed |
| 2 | Frontend/backend architecture boundary lint | Completed |
| 3 | Self-contained vs integration lane split in CI | Completed |
| 4 | Frontend migration smoke tests | Completed |
| 5 | Local integration reachability wrapper | Completed |
| 6 | Auth refresh single-flight smoke coverage | Completed |
| 7 | Shared frontend API HTTP error helper + tests | Completed |
| 8 | Datasource API error handling alignment | Completed |
| 9 | Frontend lint warning cleanup | Completed |
| 10 | Zero-warning frontend lint gate | Completed |
| 11 | Frontend build chunk signal cleanup (manualChunks) | Completed |
| 12 | Frontend chunk size budget gate | Completed |
| 13 | Frontend chunk count guardrail | Completed |
| 14 | Deterministic integration runner + docker local path | Completed |
| 15 | Chunk-gate policy externalized to config | Completed |
| 16 | Deterministic frontend visual regression harness | Completed |
| 17f | Browser visual lane + interaction tests + interrupt-safe cleanup | Completed |
| 17 | Integration determinism hardening | Completed |
| 18 | Entropy detection automation (dead-code + doc-staleness) | Completed |
| 18a | Browser lanes integrated into verify:self (graceful Chromium skip) | Completed |
| 19 | Harness report artifacts (per-lane JSON + summary via verify-self runner) | Completed |
| 20 | PR evidence trust automation (CI artifact + auto-comment) | Completed |
| 22 | Dependency freshness detection (vulnerability + outdated in verify:entropy) | Completed |
| 23 | Docker-based browser test environment for CI-consistent rendering | Completed |

Phase 23 delivered:
- `Dockerfile.playwright` using Playwright official image (Chromium + fonts
  included). Version tag matches `packages/frontend/package.json`.
- `scripts/run-browser-tests-docker.sh` wrapper with modes: `visual`,
  `visual:update`, `visual:record`, `interaction`, `all`. Validates Playwright
  version match. It does *not* pass `--user`, so on a Linux host the modes
  that write to the mounted tree (`visual:update`, `visual:record`) produce
  root-owned files — the Playwright image runs as root, and the named
  `node_modules` volumes the wrapper relies on are root-owned too, which is
  why a host UID/GID mapping cannot simply be added here. Docker Desktop maps
  ownership back to the invoking user, so macOS does not see it. CI's own
  `docker run` in `.github/workflows/ci.yml` does pass `--user`, and writes
  nothing.
- `scripts/verify-browser-lanes.mjs` skips Chromium existence check when
  `WAFFLEBASE_DOCKER_BROWSER=true` (Docker image bundles Chromium).
- `packages/frontend/scripts/verify-visual-browser.mjs` warns when updating
  baselines outside Docker.
- The image bundles system fonts; the app's *web* fonts are served from
  committed fixtures, and each capture settles them after the section-ready
  wait.

  `packages/frontend/scripts/google-font-cache.mjs` intercepts
  `fonts.googleapis.com` / `fonts.gstatic.com` at the Playwright context and
  answers from `packages/frontend/tests/visual/fonts/` (~170 KB, 5 files).
  The lane used to make that request for real, on every one of ~25 capture
  passes, and a single failed `woff2` failed the job: **11 of the 64
  `verify-browser` runs sampled on 2026-08-12/13 died that way**, on a
  rotating cast of families and profiles, none of them a regression in the
  branch under test. Waiting harder was never going to fix it — a face whose
  fetch failed sits in `status: "error"` and Chromium negatively caches the
  `woff2`, which is why the stylesheet-refetch recovery below fails
  identically on both attempts in every one of those logs.

  A URL the fixtures do not hold is aborted and reported by URL, so a stale
  cache is a loud deterministic failure (and blocks `visual:update`), never a
  silent fallback-glyph capture. Refresh with `visual:record` — the one mode
  that talks to Google — after changing `index.html`'s `css2` query or adding
  a scenario that paints a new family, and commit the result. Record in
  Docker: the `css2` response varies by User-Agent.

  Serving the fonts from disk removed the flake, not the need for the wait —
  a face is still asynchronous and still registered only once a mount injects
  its link. The gate is an explicit floor — the families/weights `index.html`
  requests (Inter, Fraunces, JetBrains Mono), the families the baselines were
  recorded with — asserted positively: registered in `document.fonts` at all,
  at least one face `loaded`, and `fonts.check()` true at every declared
  weight. Asserting registration is what makes an unanswered stylesheet fail:
  it registers no @font-face rules, and both `fonts.check()` and a
  registry-derived wait would otherwise pass vacuously. Every *other*
  registered family (KaTeX's same-origin maths faces, the eager catalog
  families) gets only a shorter, non-gating wait for quiet — no face left in
  `status: "loading"` — which warns rather than fails, so a family no
  screenshot paints cannot fail the lane. Recovery re-inserts the Google
  Fonts `<link>` elements (URL untouched) so Chromium refetches them — now
  from the cache, which is why it can actually recover. A pass
  whose floor never settles is recorded and fails the run *after* capture —
  screenshots and diffs still land — and blocks `visual:update` from
  recording fallback glyphs as a baseline.
- CI `verify-browser` job builds Docker image and runs browser lanes in
  container. Uploads `*.actual.png` artifacts on failure.

Phase 17 delivered:
- Shared integration test helpers (`packages/backend/test/helpers/integration-helpers.ts`):
  clearDatabase, createUserFactory, describeDb, parseDatabaseUrl, env defaults.
- Timestamp nondeterminism eliminated via `jest.useFakeTimers()` in controller
  contract tests.
- Postgres version pinned to 16 in `docker-compose.yaml` (matches CI).
- Repeat-run stability script: `pnpm verify:integration:repeat`.

Detailed task records:
- `docs/tasks/active/` for in-progress work
- `docs/tasks/archive/2026/02/` for completed phase history

## Top-Level Plan Status

| ID | Goal | Principle | Status | Next |
|---|---|---|---|---|
| A | Fail on breakage by default | Mechanical Enforcement | Completed | Maintain zero-warning, zero-drift baseline |
| B | Two-lane verification split | Mechanical Enforcement | Completed | Stable; improve integration determinism |
| C | Frontend regression harness | Visual Feedback | Completed | Browser lanes in verify:self; Docker-based CI provisioning delivered (Phase 23) |
| D | Agent-oriented contracts | Information Accessibility | In progress | Lane reports + PR auto-evidence (Phases 19-20); failure-summary digest delivered (`scripts/agent/summarize-ci.mjs`); autonomous contribution loop shipped (Phases 24-27); remaining: Phase 21 structured logging/observability context + autonomous issue-filing |
| E | Entropy cleanup loop | Entropy Management | Completed | Dead-code + doc-staleness + dependency freshness delivered |

## Agent-Oriented Phases (21, 24-27)

Phases 24–27 (autonomous contribution loop, local Spec→PR, Tier-1 issue hunting,
panel feedback corpus) have shipped; each phase body below states what is live
versus the narrower items still deferred. Phase 21 (agent observability) is
partially delivered — the agent-queryable failure summary landed; structured
backend logging and per-branch observability context remain.

### Phase 21: Agent Observability Stack

**Principle:** Visual Feedback + Capability-First Debugging — give agents
direct access to runtime signals.

Goal: Enable agents to self-diagnose failures using structured telemetry.

Deliverables:
- Structured logging format for backend services (JSON, correlation IDs).
- Per-branch or per-PR observability context (log grouping by change).
- Agent-queryable failure summaries from lane report artifacts.
  **Delivered** by `scripts/agent/summarize-ci.mjs`, which reads the
  `.harness-reports/` reports (the summary + per-lane files that `verify:self`
  already emits) and prints a ranked root-cause digest (failing lane + its
  failure summary, downstream skips noted). Consumed by the autonomous
  contribution loop below.

Done criteria: An agent can diagnose a CI failure from report artifacts
without human interpretation.

**Loop-status projection (`<!-- agent-loop-status -->`).** Delivered as the
human half of this phase: one sticky PR comment, updated in place by
`scripts/agent/loop-status.mjs`, that makes the review→fix loop legible without
reading workflow logs — a newest-first round table (head sha, non-panel checks,
per-lens check conclusions, what happened next), the fix-round budget, the
latest loop decision, and effort totals. Its contract mirrors the `agent:*`
label projection (Phase 24): it is **derived in full from the unforgeable
signals** (commits, lens check runs, both paged latches, the metric ledger) on
every update, so a missed update self-heals, and **nothing may read it back to
make a decision**. Trust rules, because the repo is public: the upsert only
updates a marker comment authored by an allow-listed bot login or a
write-access human (the paged-latch rule, `rounds.mjs::isPagedLatchComment`);
metric-ledger records are parsed only from trusted-author comments and only
their **numbers** are ever rendered — otherwise a stranger's fake
`<!-- agent-metric -->` record could launder a trusted marker into a
bot-authored comment. Update hooks live in the panel workflow (panel verdict,
promote, round-guard decision, fix outcome, stalled), the CI arm, `@claude fix`
and `@claude rerun`. The check runs remain the verdict of record; the comment
only summarizes their conclusions, and the round guard — not the table — is the
authority on the budget. Every derived number is caller-independent so the body
converges instead of flapping between arms: the round count uses the full lens
manifest (provably equal to the guard's `required_checks` count, because that
set derives from the cumulative changed-file list and never shrinks mid-PR, and
a lens that never fails adds nothing to a count of failing-lens commits), and
the cap defaults to a constant pinned by test to the panel workflow's
`MAX_REVIEW_ROUNDS` literal.

The table is also a **map**, not just a summary. Each round's head cell links to
that commit's checks — GitHub's Checks tab only ever shows the *head* commit's
runs, so the table used to name a round it gave no way to open — and a `Fixer`
column reports what the fix agent did about each round: `3 fixed · 0 skipped ·
0 disputed`, or `—` for a round it was never dispatched for, or `🔧 dispatched`
for one it was sent into and never reported on. Those last two are deliberately
distinct; collapsing them would hide a fixer that ran and said nothing. Every
input comes from records already parsed out of the PR's comments (the dispatch
ledger, fix reports, rebuttals), so the column costs no extra API calls. The
`0 disputed` half is the point rather than a detail: no rebuttal has ever been
filed on an agent PR, and until this cell existed that was indistinguishable
from a dispute channel that silently failed. Reports and dispatches bind to a
round by SHA; a rebuttal names a finding rather than a commit, so it is
attributed to the newest dispatch at or before it was written. `commitBase` is
derived from the Actions env inside `main()` rather than passed as a flag, for
the caller-independence reason above — six call sites across four workflows, and
a link that appeared for some of them would flap.

**Per-round findings comment (`<!-- agent-panel-round:<sha> -->`).** The
dashboard above summarizes conclusions; this posts the findings themselves.
Until it shipped, the autonomous panel recorded verdicts ONLY as `agent-review-*`
check runs — one set per commit (a second, advisory `agent-deferred-findings` run
was added later; see *The deferred-findings channel* below) — while the triage
renderer that makes them
readable (`scripts/agent/review-comment.mjs`) was wired solely into
`.github/workflows/agent-review-on-demand.yml`, which posts no checks. The two arms were
complementary and neither was complete: `@claude review` gave a comment and no
gate, the autonomous panel a gate and no comment. Measured across 19 `agent/*`
PRs, panel comments were **0** on every autonomous one, so a maintainer could
read the fix agent's account of what it changed and never the findings it was
answering.

`scripts/agent/panel-round-comment.mjs` composes the existing pieces —
`collectLenses` + `renderReviewComment` for the body, `buildRounds` for the round
number, so the number here and the number in the dashboard's table come from one
function and cannot disagree. It is keyed by **SHA, not upserted globally**: one
comment per round, updated when CI re-runs on the same commit, so the rounds read
in order against the fix reports that answer them. A single sticky comment was
considered and rejected for that reason.

Three bodies, because silence is ambiguous: `renderReviewComment` returns `""`
for a round with no findings, so a clean round says so explicitly rather than
rendering empty (which reads as "the panel never ran"); a round that blocked
without producing readable findings gets its own wording, since "no findings"
there would be wrong in the dangerous direction; and a missing panel.json is
detected directly rather than inferred, because with it absent every lens reads
`failure` with no findings — byte-identical to a real all-red round — and
rendering six fail-closed reds as findings would report a review that never ran.

**Neutralization here is load-bearing, not hygiene.** The comment is authored by
`github-actions[bot]`, one of the two identities `isPagedLatchComment` trusts to
LATCH the pipeline, and its body is lens prose: model output over an
attacker-authorable diff that quotes this repo's markers routinely. #681 is the
recorded near-miss — an on-demand review comment that merely *named*
`<!-- agent-metrics-summary -->` was deleted seconds later by the metrics sweep.
The same text carrying `<!-- agent-review-paged -->` under this identity would
freeze the panel and the fixer. Everything interpolated goes through
`neutralizeHiddenMarkers`, and a test plants a live latch inside a finding
summary and asserts exactly one live HTML-comment opener survives: our own.

Two run-page companions shipped with it: `scripts/agent/review-round-guard.mjs`
now renders its decision — including the previously **silent PROCEED** — as a
`verdict` step output plus a `$GITHUB_STEP_SUMMARY` block
(`scripts/agent/guard-verdict.mjs`, pure presentation with no decision logic),
and `scripts/agent/panel-job-summary.mjs` /
`scripts/agent/session-job-summary.mjs` put the per-lens verdict/verifier/cost
table and each Claude session's turns/cost/outcome on the run page. The CI arm's attempts
guard writes matching SKIPPED/PAGED/PROCEED summary blocks (inline in
`github-script`, which cannot import a module — the same constraint behind the
`gate` job's literal latch copy), and its paged-latch check is author-checked
with the same predicate as the review-side latch.

**Observability, second slice: findings and money become precise.** The first
slice made the loop's *shape* legible; this one surfaces what each stage
actually decided, on the surfaces that already exist and without changing a
single decision. Three additions, all pure rendering of data the pipeline
already computes:

- **Enriched lens check-run bodies** (`scripts/agent/severity.mjs`). Each
  blocking row now renders a `file:line` locator (the finding's own `line`, or
  the first same-file citation in its evidence — `novelty.mjs::findingLocation`
  is the one rule for both) and the per-finding verifier outcome: confirmed at
  high/low confidence, could-not-settle (the existing `unsettled` wording,
  unchanged), or **UNVERIFIED — the verifier session errored**, the per-finding
  face of the aggregate outage banner. `annotateFindings` stamps the outcome as
  a reporting-only `verification` field from the same null-verdict signal
  `verifierTally` counts, so the marker and the banner cannot disagree. A
  finding that survived a dispute renders the adjudicator's decision **and its
  reason** as a sub-bullet — the reason was computed every round and discarded
  from every human surface (only the `upheld` integer is carried in
  `output.text`, by design; the prose lives here). Findings the author
  reported **skipped** get their own section with the author's note, closing
  the fix-report section's documented not-yet-built item. Because lens bodies
  are copied verbatim into a bot-authored PR comment
  (`.github/workflows/agent-review-on-demand.yml`), the two author-adjacent strings on this
  surface — the adjudication reason and the skip note — are `<!--`-neutralized
  (the `scripts/agent/fix-report.mjs` ZWNJ technique) so author prose cannot
  smuggle a live paged latch into a comment posted by a trusted identity. The fixer-prompt cut
  contract is preserved: every new section arrives via the same `\n###`
  marker (followed by a space, the exact delimiter the cut splits on), and
  `scripts/agent/harvest.mjs`'s corpus reader round-trips the
  enriched rows (pinned by a cross-module test against the real renderer).

- **Per-session ledger** (`scripts/agent/metrics.mjs::renderLedger`). The
  effort summary's aggregates could answer "what did everything cost" but not
  "what did round 3 cost"; a `<details>` fold now lists every recorded session
  chronologically — kind, turns, weighted tokens, cost, duration — with
  `review`/`review-fix` rows carrying their round ordinal (the nth panel
  record IS round n, the same order `detectFlips` reads). Rendering happens
  before any sweep, so `--final` summaries carry the full table. Two rules
  guard it: a missing value renders as `—`, never `0` (`Number(null) === 0`),
  and `kind` — the one free-text field in a record that is parsed from ANY
  comment — is allow-listed to the pipeline's own kinds and renders as
  `other` otherwise, so a forged `<!-- agent-metric -->` record cannot steer
  text into the bot-authored summary.

- **"Where to look" on every 🛑 page** (`whereToLookLine` + `runUrlFromEnv` in
  `scripts/agent/guard-verdict.mjs`). Every page comment now ends with a link
  to the failed run, the job/step that decided or died, and the transcript
  artifact where one exists — the three clicks a hand-off used to make a
  maintainer reconstruct from the Actions tab. The URL is built only from the
  runner's own `GITHUB_*` env (null on any missing piece, never a partial
  link), so pages posted outside Actions render exactly as before. The
  `github-script` page sites (the CI arm's attempts guard, the `stalled`
  safety net) carry inline copies of the line for the usual cannot-import
  reason; they are display-only strings, so no byte-identity pin is needed.

**Observability, third slice: the dispute channel and the leftovers.** The
last places the pipeline acts without a human-visible trace:

- **Visible rebuttal bodies** (`renderRebuttalComment` in
  `scripts/agent/rebuttal.mjs`). A rebuttal comment used to be ONLY its hidden
  marker — an empty-looking bot comment while a machine argument about
  removing a finding from the merge gate played out invisibly. The body now
  renders the disputed finding, the claim, its citations, and the
  load-bearing framing (a claim awaiting adjudication that upholds by
  default; two upheld disputes page a human) above the unchanged record. The
  read side is untouched: `parseRebuttalComment` matches the marker anywhere
  and `fromRebuttalAuthor` gates on identity, not shape. Two hardening fixes
  landed with it, both at serialization (the one writer): author fields are
  `<!--`-neutralized, because rebuttals post through the App token and both
  paged-latch predicates are containment tests gated on exactly that trusted
  identity — a claim quoting a latch would have frozen the loop; and the
  `-->` terminator is transport-escaped exactly as
  `scripts/agent/fix-report.mjs` does, fixing a silent pre-existing failure
  where any dispute quoting a repo marker truncated its own JSON, failed the
  round-trip guard, and was never posted at all.

- **Best-effort failure breadcrumbs** (`emitBestEffortWarning` in
  `scripts/agent/guard-verdict.mjs`). The fail-safe
  scripts — `scripts/agent/set-state.mjs`, `scripts/agent/loop-status.mjs`,
  `scripts/agent/metrics.mjs` — deliberately exit 0 on operational failure,
  which means their `continue-on-error:` steps NEVER show a failed outcome:
  the symptom (a stale label, a stale dashboard, a missing effort comment)
  surfaces later with nothing connecting it to the cause. Their bail paths
  now emit one `::warning::` annotation (run page + PR checks-tab header,
  stdout-only and only inside Actions) plus a job-summary line naming the
  consequence. In `scripts/agent/metrics.mjs` the consequence is OPT-IN per
  call site — bail also serves normal no-ops ("no metrics recorded yet"),
  and warning on those would teach readers to ignore the annotation. The
  inline `github-script` best-effort steps already carried `core.warning`
  in their catch blocks; the implement ack now does too.

- **Kickoff dead-run visibility** (`.github/workflows/agent-implement.yml`,
  final always-step). The one silent termination left: the implement run
  dies or exhausts its turns before opening a PR, and the issue keeps the
  "On it" ack forever. The step resolves whether an open `agent/<issue>-*`
  PR exists (the same branch-prefix lookup as
  `scripts/agent/metrics.mjs::resolvePrByIssue`) and, when none does,
  comments on the issue with the run link, the `claude-execution-output`
  artifact name and the retry command. Three-state honesty, mirroring the
  stalled net: PR found → silent; none found → the dead-run comment, worded
  by whether the agent step failed or merely ended; the PR LIST unreadable →
  a comment that says the state could not be determined, never a failure
  claim the run did not verify.

### Phase 24: Autonomous Contribution Loop

**Principle:** Mechanical Enforcement + Capability-First Debugging — drive the
existing human workflow autonomously while keeping every gate a human already
relied on.

Goal: When a human posts an issue, an agent plans, implements, self-reviews, and
iterates on CI/review feedback until the PR is ready for a **final human review**
before merge. Maintainer review, merge, release, and deploy remain human.

This is a thin orchestration layer over the existing harness — it reuses
CLAUDE.md/CONTRIBUTING.md as the process source of truth, the `verify:*` lanes,
the `.claude/settings.json` hooks, and the CI `<!-- harness-verification -->`
evidence comment. It adds no parallel process; it triggers Claude Code
(`anthropics/claude-code-action`) and enforces one human review gate.

Components:
- **Command dispatch** — the `@claude` mention is a command surface parsed by the
  shared `scripts/agent/command.mjs` (flexible/containment matching: a comment
  triggers a verb when it contains `@claude <verb>` anywhere, case-insensitive,
  first-occurrence wins). Each workflow runs a cheap `route` job that calls the
  parser and gates on the resulting verb, so the mention maps deterministically
  and the workflows never double-fire on each other. Verbs:
  - `@claude fix` (issue) → Kickoff (below). A bare `@claude` on an issue gets a
    help reply.
  - `@claude summarize` (PR) → `.github/workflows/agent-summarize.yml`: a
    READ-ONLY, no-checkout summary comment ("what does this PR do / good to go?").
    PR author OR maintainer, throttled to one per head SHA.
  - `@claude review` (PR) → `.github/workflows/agent-review-on-demand.yml`: runs
    the same lens panel (below) but ADVISORY — aggregates the findings into ONE PR
    comment, records NO check runs and drives no promote/fix, so it never touches
    the merge gate. Works on any PR incl. forks (read-only). PR author OR
    maintainer, throttled per head SHA. The comment is rendered by
    `scripts/agent/review-comment.mjs` in a **triage layout**: a one-line
    verdict + counts headline, then EVERY blocking (critical/major) finding
    expanded and first (each a linkable `file:line` to the reviewed commit,
    lens-tagged), with minor/nit findings collapsed per lens (count in the
    `<summary>`), and the long reviewer prose + relocated/pre-existing findings
    collapsed below. A lens with zero findings is omitted; collapsed sections
    past a char budget are dropped with a stated count (blocking findings never
    are). It is PRESENTATION ONLY — it reads the same `.agent-review/<lens>/verdict.json` findings and
    changes nothing about detection, severity, or the gate; the autonomous
    panel's per-lens check bodies still go through `severity.mjs::renderSummaryMd`
    untouched, and the on-demand path falls back to that per-lens concatenation
    if the triage render is unavailable. The comment then ends with a collapsed
    **"Prompt for AI Agents"** fold (`scripts/agent/ai-prompt.mjs`) — the blocking
    (critical/major, non-demoted) findings rendered as a fenced, copy-pasteable fix
    instruction, so a maintainer can hand the whole review to their own coding agent
    in one click (a fenced code block IS GitHub's native copy button). Empty and
    omitted when nothing blocks.
  - `@claude fix` (PR) → `.github/workflows/agent-fix.yml`: MAINTAINER-ONLY; runs
    ONE fix agent against the review panel's standing verdict, on demand (Phase 30).
    Requires a completed panel verdict on the *current* head commit — which is both
    "a panel ran" and "nothing landed since". Same verb, different surface: the
    issue-side gate is `!github.event.issue.pull_request` and this one is its
    negation, so the two never double-fire.
  - `@claude loop` (PR) → `.github/workflows/agent-loop.yml`: MAINTAINER-ONLY;
    labels the PR `agent:managed` and re-runs CI to opt it into the full
    review→fix→promote machinery. Same-repo branches only (the fixer can't push to
    a fork → fork PRs get a note pointing at `@claude review`).
  - `@claude` + anything else (PR) → the review-reply arm (below). Note this arm
    acts ONLY on `agent/`-authored PRs; ordinary and `agent:managed` PRs are left
    to humans (it never pushes to a branch it did not author).
- **Kickoff** — `.github/workflows/agent-implement.yml`: a trusted-author
  `@claude fix` mention on an issue (or manual dispatch) runs Claude Code headless,
  which follows the standard task workflow and opens a **draft** PR from an
  `agent/<issue#>-<slug>` branch. Structured spec via
  `.github/ISSUE_TEMPLATE/agent-task.yml`.
- **Develop-review loop (CI)** — `.github/workflows/agent-iterate-ci.yml`: on CI
  failure for an agent-managed branch (an `agent/` branch, or a human PR labelled
  `agent:managed` via `@claude loop`), `scripts/agent/summarize-ci.mjs` (Phase 21)
  feeds the diagnosis back to the agent, which pushes a fix. A bounded attempts counter
  pages a human instead of looping forever.
- **Develop-review loop (review)** — `.github/workflows/agent-review-reply.yml`:
  a generic `@claude` mention (no command verb) in a PR/review thread has the
  agent address the finding (or push back with reasoning) in-thread. Restricted to
  `agent/`-authored PRs (the `is_agent` gate) — ordinary and `agent:managed` PRs
  are left to humans, since the arm only acts on branches it authored.
- **Review panel** — `.github/workflows/agent-review-panel.yml`: triggered when CI
  **starts** (`workflow_run: requested`) on a base-repo agent-managed PR (an
  `agent/` branch or an `agent:managed`-labelled PR; fork-originated
  `workflow_run` events are rejected), so review and CI run concurrently rather
  than in series — worth ~13.5 min a round, since the panel (17.8 min median)
  outlasts CI (13.5 min) and absorbs it. The CI conclusion is not dropped: a `ci`
  job waits for it and gates the two PUSHING jobs (`promote`, `fix`), which is
  what keeps this arm and the CI-fix arm mutually exclusive per CI run. On a red
  CI both are skipped and `.github/workflows/agent-iterate-ci.yml` takes the branch;
  ONE orchestrator process (`scripts/agent/review-panel.mjs`, Claude Agent SDK)
  spawns a FRESH read-only subagent per **lens** — `correctness`, `security`,
  `design-fit`, `test-adequacy`, `blast-radius` (declared data-drivenly in
  `scripts/agent/lenses/lenses.json` + one rubric `.md` each). The reviewed
  artifact is the branch diff against `main`, minus ANTLR generated *tooling*
  artifacts (`packages/sheets/antlr/*.interp|.tokens` — nothing loads them at
  runtime, so no lens can act on them). The generated `.ts` files stay IN the
  diff even though they are the larger half: they are executable code, and
  excluding them would leave every lens blind to a hand-edit that
  `packages/sheets/antlr/Formula.g4` does not justify, whose only compensating
  control (`scripts/hooks/guard-generated-files.sh`) is bypassable out-of-band.
  Re-excluding them requires a regen-and-diff lane first. The changed-FILE list
  is left unfiltered because it drives `lensApplies` → the required-check set, so
  a list that shrank mid-PR could un-require a lens that failed an earlier round. Each subagent has
  read-only tools only (Read/Grep/Glob; no branch-code execution), runs with
  `settingSources: []` (so the untrusted branch's `.claude` hooks/settings are
  never loaded — the workflow also strips `.claude/` and installs the SDK in a
  separate UNPRIVILEGED `deps` job so no install runs with the secrets), and
  returns findings (schema-requested, then locally shape-validated + fail-safe
  severity-normalized) classified `critical`/`major`/`minor`/`nit`, each with a
  separate `confidence` of `high`/`medium`/`low`. The two axes are deliberately
  independent: **`severity` is impact if the finding is real, `confidence` is how
  sure the lens is**, and the rubrics tell lenses never to downgrade severity to
  express doubt. Before this split the only channel for doubt WAS severity — the
  rubrics closed with *"when unsure, downgrade"* — which is the documented
  anti-pattern where a model investigates just as thoroughly and then declines to
  report, and is why the panel recorded zero `critical` findings in its first
  nineteen PRs. The rubrics are now **coverage-first**: report everything,
  including uncertain findings, and let the verifier filter. **Gating is
  unchanged and reads `severity` only** (`BLOCKING = {critical, major}`) — gating
  on confidence would rebuild the same clamp inside the trusted script. The
  confidence distribution is reported per PR so the axis can be seen to be in
  use; it is not shown to the fix agent, which must address every blocking
  finding regardless of how sure the lens was. A per-finding
  **verifier** subagent then tries to refute each blocking finding. It is
  deliberately **not given the diff**: the lens that raised the finding reasoned
  from that diff, so a verifier reading the same diff inherits its misreadings
  and confirms them — the correlated-error failure of naive review panels. It
  instead re-establishes the facts from the repository itself (Read/Grep/Glob
  against the branch checkout, capped at 20 turns), is told to distrust the
  finding's quoted evidence, and receives only the cumulative changed-FILE list
  so it can tell new code from pre-existing. Dropping is **grounded, not
  asserted** (`isDroppingVerdict`): the verdict must be an explicit `refuted`, at
  high confidence, naming one of `not-present | already-guarded | out-of-scope |
  pre-existing`, AND citing at least one location that is *shaped* like one
  (`file.ext:line`) — a bare non-empty string would let `"looks fine"` pass as
  evidence, which is the same unevidenced assertion in a citation's costume.
  Anything less — including a bare high-confidence refute, which used to be
  enough — keeps the finding (fails toward blocking, so the false-positive lever
  can't swallow a real bug). `pre-existing` additionally requires the changed-file
  list to be **authoritative**: complete, untruncated, and free of malformed
  entries, since a path absent for any of those reasons would otherwise read as
  "the PR didn't touch it". That is enforced in the trusted script, not only in
  the prompt — a prompt instruction the script does not check is not a rule. The
  metrics comment reports
  `refutedHighConfidence` and `dropped` separately; the gap between them is the
  count of confident refutations the gate declined to act on.
  It also reports **`errored`**, and that one is read FIRST because a non-zero
  value invalidates every number after it. A blocking finding whose verdict is
  `null` means the verifier session THREW; the orchestrator catches it and keeps
  the finding, which is the right default and a silent one. On #592 the panel hit
  `429 You've hit your session limit`, which is deliberately non-retryable, so
  every verifier call after that point threw and every verdict was discarded —
  output indistinguishable from a verifier that examined all 40 findings and
  confirmed each. A verifier outage makes the panel MORE blocking, not less (kept
  findings still gate), so this is a trust signal rather than a safety one: the
  check body now says *"the verifier did not run on N of M findings"* above the
  findings, because it changes how all of them should be read. The verifier is
  also given NO changed-file list and has no provenance ground: whether the change
  introduced the code is answered from git by the novelty gate, and deleting a
  finding because its location is old code is the action #583 established is
  wrong. Age demotes to a reported, non-gating lane; it never deletes. Dropping
  the block also bounds the verifier prompt's uncached tail to the finding itself
  — the list sat AFTER the finding, so it was re-billed on every verification.
  Both panel workflows now keep the panel's lens-stats artifact, and the on-demand
  review carries a one-line verifier/novelty tally in its comment; previously
  that path recorded nothing at all, which is why none of this was measurable.
  Findings carry a **`claimType`**, because the two shapes are verified in
  opposite directions. A `presence` claim ("this code is wrong") is refuted by
  looking it up where the finding says it is. An `absence` claim ("no test covers
  this", "no validation on this input") is refuted by FINDING ONE
  COUNTEREXAMPLE — a search whose failure is indistinguishable from the thing
  genuinely not existing. Running the presence procedure on an absence claim is
  why a false *"no CI workflow runs these tests"* survived #578: the
  counterexample was real and three hops away (`.github/workflows/ci.yml` →
  `pnpm verify:self` → `scripts/verify-self.mjs` → the `agent:tests` lane) and the
  verifier ran out of turns,
  so bias-to-keep confirmed it. Absence claims now get a counterexample-hunting
  prompt, the `searchedFor` list the lens recorded (so it searches where the lens
  did *not*), a `counterexample` refutation ground, and a larger turn ceiling
  (`VERIFIER_MAX_TURNS`, 20 vs 8). A third verdict, **`unresolved`**, exists so
  "I searched and could not disprove this" stops being reported as "confirmed" —
  it does **not** demote: `isDroppingVerdict` still requires an explicit
  `refuted`, so an unsettled finding gates exactly as a confirmed one does. That
  is deliberate. Absence claims are the entire output of test-adequacy and much
  of security and design-fit, so routing unsettleable ones off the gate would
  repeat the mistake the novelty gate had to correct. The finding is marked
  *"verifier could not settle this"* in the summary and counted in
  `verifier.absenceRaised`/`absenceRefuted`/`unresolved`, so a high `unresolved`
  against a low `absenceRefuted` is visible as absence claims riding through
  unchecked rather than being silently discounted.
  A **clustering** pass (`clusterFindings`) collapses RESTATEMENTS of one defect
  **before the verifier runs**, so each distinct defect is verified once rather
  than once per wording. `dedupeFindings` only catches byte-identical summaries, so
  #578 reported the same defect three times over — two wordings of one missing
  file, the deny-list bug as both a `critical` and a `major`, the deny-list-shape
  concern twice — and the verifier could not help, since it judges one finding at a
  time in isolation and re-runs a full session (and `git blame`) for each copy:
  the #578 shape would have paid for four redundant verifier sessions. Collapsing
  first removes that waste. The similarity metric is **not** re-derived:
  `findingSimilarity` in `scripts/agent/rounds.mjs` already owns it for the
  non-convergence detector, calibrated against real panel output with the overlap
  coefficient chosen over Jaccard for exactly this restatement pattern. It
  separated all four of #578's real duplicate pairs from all four of its real
  distinct pairs, with the distinct ones scoring 0.000 — so this needs **no model
  call**. Merging is not deletion, which is what makes that safe: every collapsed
  wording rides along in `mergedFrom` and is rendered (and reaches the fixer), the
  survivor takes the cluster's highest severity so a `critical` is never masked by
  a `major` restatement, it gates if any member gated, and `unsettled` propagates.
  The only thing removed is count inflation, reported as `clusters.collapsed`. The
  stated limitation: two wordings sharing no vocabulary score 0 and stay separate,
  which leaves the count inflated — the status quo, and the conservative direction.
  Running clustering *before* the verifier (it began *after* it, in #591) means
  the merge now decides what the verifier sees, so a wrong merge could let a
  representative's refutation drop a genuinely distinct wording that merged in and
  was never checked on its own. `resolveClusterVerdict` closes that: a
  representative refutation is honoured only when every folded BLOCKING wording is
  ALSO confidently refuted — otherwise the cluster is kept, carrying the surviving
  verdict. That re-verification runs only on the rare dropping verdict of a
  multi-member cluster, so the common confirmed path still pays for exactly one
  verifier session per cluster. Two further bounds: the threshold is conservative
  (the #578 distinct pairs scored 0.000, so they stay separate) and `mergeCluster`
  elects the strongest wording as representative (gating, then highest severity,
  then evidence-bearing), so the verifier judges the form most likely to gate and
  every folded wording is still rendered.
  A finding can now be clustered twice (fresh pass pre-verify, then again when a
  fresh survivor restates a carried-forward prior finding), so `mergeCluster`
  flattens the wordings each pass folded rather than overwriting them.
  A **novelty gate** (`scripts/agent/novelty.mjs`) then answers a question the
  verifier structurally cannot: *did this change PUT this line here, carrying
  code that already existed?* The verifier's independence means it never sees the
  base, so from inside the branch checkout a line a refactor MOVED and a line the
  change WROTE are identical, and the `pre-existing` ground is file-scoped so a
  function relocated into a new file legitimately fails it. #578 demonstrated the
  cost: a PR that lifted `classifyResult` verbatim into a new file had every
  pre-existing bug in it re-reported as introduced-here, confirmed by the
  verifier, and handed to the fixer.
  The question is deliberately NARROWER than "is this code old". Code age is not
  causation: a new guard bypassed by an untouched call site, a new caller
  reaching an old unguarded path, a test that stopped covering a branch — those
  defects live entirely in pre-base lines, and the blast-radius lens exists to
  find them (its rubric orders it to cite the bypassing site, "not the diff line
  that introduced the guard"; correctness and security carry the same out-of-diff
  mandate). Demoting on line age alone would route that whole class off the gate.
  So provenance takes **two** blames, and both must answer: plain `git blame`
  says which commit put the line at this offset, and `git blame -w -C -C -C` says
  which commit originally wrote that content. A line the change did not add is
  `pre-existing` and is **never** demoted. Only a line the change ADDED whose
  content predates the base is `relocated`, and that alone demotes. A whole-line
  `git grep` against the base tree is a fallback for the second question only
  when move-aware blame cannot answer (shallow clone) — never an override of it.
  All probes run in the trusted script via async `execFile` (array args, no
  shell, timeout); no capability is granted to a model. Every git invocation is
  built by `scripts/agent/git-env.mjs`, because **`cwd` and `-C` do not decide which repository
  git operates on — the environment does, and it wins.** git exports its location
  variables into every hook it runs, and `pre-push` runs `verify:self`, which
  reaches this module; unscoped, a probe under a hook answers about whatever
  `GIT_DIR` names. `repoScopedEnv` (reads) strips every location and behaviour
  variable and caps discovery at the repo's parent, so a non-repo path fails
  loudly instead of answering about an ancestor. `fixtureGitEnv` (writes, tests
  only) additionally pins `GIT_DIR`/`GIT_WORK_TREE`; pinning `GIT_DIR` alone is
  insufficient, because an inherited `GIT_INDEX_FILE` still makes `git add`
  rewrite another repository's index and leaves it corrupt. The result routes each
  blocking finding to a **lane** (`routeFinding`): `blocking` gates as before,
  `backlog` is reported with the base location that proves the code already
  existed but does not gate, is **filtered out of the fixer's checklist**, and is
  **not persisted** into the check's machine-readable findings (so it cannot
  reach the carry-forward or the non-convergence detector either); `discarded`
  remains reachable only through the unchanged `isDroppingVerdict`. Every
  uncertain path — no `--base-sha`, a shallow clone, a git failure, a finding
  with no `file:line`, a citation naming a different file — yields `unknown`,
  which keeps the finding blocking. There is deliberately no file-level fallback:
  demoting because a `file` string is absent from the changed-file list is a
  string comparison, not a git answer. Carried-forward prior findings are not
  routed at all, since their `line` was recorded against a tree the fixer has
  since rewritten. `--base-sha` is the merge-base computed by the workflow and
  passed in, never guessed: it is the same endpoint the reviewed diff uses, so
  "what changed" and "what counts as already-there" cannot diverge.
  `lensStats.lanes` reports `blocking`/`backlog`/`unknownOrigin` and
  `scripts/agent/metrics.mjs` renders it; read `unknownOrigin` first, since a zero `backlog`
  beside a high `unknownOrigin` means the gate ran blind rather than that nothing
  was relocated.
  **Placing a finding** is the shared input both gates depend on, and it was quietly
  losing most of them. `novelty.mjs::findingLocation` takes the finding's own `line`
  when a lens supplied one, and otherwise the first `file:line` citation in its
  evidence that NAMES THE SAME FILE — the same-file rule being what stops a foreign
  file's offset from inventing a location that exists but means nothing. Two bugs
  made that rule lose locations it should have found. It read only the FIRST citation
  and discarded it on a file mismatch, while lenses habitually open their evidence
  with the call site or the violated contract and cite the filed file second; and
  `CITATION`'s permissive leading `[^\s:]+` swallowed whatever punctuation abutted
  the citation, so the extremely common `(auth.controller.ts:130)` parsed as the file
  `(auth.controller.ts` and could never match anything. Measured over the 44 blocking
  findings banked on the open agent PRs: 24 carried a same-file citation, 7 were
  being placed. Scanning for the first AGREEING citation and trimming characters that
  cannot begin a path took that to 23 placed, and the surface gate's share of the
  backlog from 9% to 25%. `CITATION` itself is deliberately not tightened — its other
  importers only ask `.test()` ("does this cite anything at all"), and narrowing that
  predicate could turn a grounded verdict ungrounded.

  **The surface gate** (`scripts/agent/review-surface.mjs`) answers the sibling
  question: *did a FIX ROUND put this line here?* It exists because the loop could
  not converge. Measured over 88 scored rounds on the 8 non-converging draft agent
  PRs of 2026-08: **79% of every round's blocking findings were newly discovered
  rather than re-raised** (373 new against 97 carried, matched with the panel's own
  `findingSimilarity`), the reviewed diff never shrank (+228..+358 lines per round;
  #786 went 15 files/+218 at round 1 to 47 files/+5,595 at round 16, #810 8/+251 to
  61/+5,059), and the finding count stayed flat at ~6 per round throughout. That is
  roughly one blocking finding per 50 new lines: the fixer wrote ~300 lines to clear
  ~6 findings and those lines minted ~6 more, so **the loop's fixed point was ~6
  findings rather than 0**. `detectStalledRounds` could not see it — it requires
  findings to REPEAT (`repeatRatio >= 0.30` twice consecutively with a non-falling
  count) and these did not, so it reported `progressing`; replayed fresh at every
  round it fires on exactly one of the eight, at that PR's LAST round. Seven of
  eight ran to the round cap, paged, and `@claude rerun` granted a fresh budget
  without changing the dynamic. The findings were mostly legitimate; the defect was
  that nothing bounded what the PR was allowed to grow into.
  So the review surface **freezes**. A blocking finding on a line a fix round wrote
  stops gating: it is still reported, but it stops failing the lens check and stops
  reaching the fixer, which is what breaks the cycle. The anchor is the head sha at
  the moment the fixer was FIRST dispatched — the `from` field of the first
  `<!-- agent-fix-dispatch -->` record, i.e. the PR exactly as the implement job
  left it. That ledger is already author-gated to `github-actions[bot]`, so a branch
  cannot move its own freeze point, and the **rerun floor is deliberately not
  applied**: `fixRoundsUsed` cuts records before a `@claude rerun` because a
  hand-back grants a fresh *budget*, but the surface is not a budget, and
  re-freezing around whatever the fixer has since written would let the treadmill
  back in one rerun at a time.
  The rule needs **two** blames, exactly as novelty does but with the content test
  INVERTED. Novelty demotes when the content is old; this demotes when the content
  is new. Both are required because a fix round that RELOCATED original
  implement-diff code into a new file gets plain-blamed to the fix commit while its
  content predates the freeze — that is the PR's own code and must keep gating. Only
  a line whose plain blame AND move-aware blame both land after the freeze point is
  `out-of-scope`. There is deliberately no file-level test: "this file did not exist
  at freeze time" is cheaper and worse, because the fixer legitimately grows
  original files and the out-of-diff mandate carried by blast-radius, correctness
  and security routinely cites untouched ones.
  `critical` is **carved out on severity alone** and never demotes on scope. The
  argument for demoting is "this is not what the PR was scoped to fix", which is a
  scheduling claim, and it stops being worth making when the alternative is shipping
  a critical bug; the cost is bounded because critical is rare beside major in this
  corpus. Demotion routes through the same `backlog` lane novelty uses, so
  out-of-scope findings inherit its whole downstream treatment for free — dropped
  from the check's machine-readable findings, therefore invisible to the
  carry-forward and to the non-convergence detector — and `clusterFindings` still
  promotes a demoted survivor back to `blocking` when any other wording of the same
  defect gated, so a lens reporting one defect twice cannot demote it by citing the
  fixer's copy. The two demotion reasons render under separate headings, because
  "the code already existed" and "a fix round wrote this" are opposite claims and a
  shared heading would make one of them a false audit line.
  FAIL DIRECTION, as everywhere here: every uncertain path yields `unknown`, which
  keeps the finding blocking — no `--frozen-sha`, no citation, an unresolvable sha, a
  failed or timed-out blame, a shallow clone. One case is checked **once and
  loudly** rather than inferred per finding: a freeze point that resolves but is not
  an ancestor of `HEAD` (a rebase, force-push or amend) would make every line look
  post-freeze and demote the entire PR off the gate at once, so `freezeResolves`
  refuses it and turns the gate off. Carried-forward prior findings are not routed,
  for a reason that binds harder here than for novelty: a stale offset landing inside
  fixer-written code would demote a still-open blocker permanently, a fail-open
  produced by nothing but line drift. Filing the demoted findings as follow-up issues
  is deliberately NOT part of this — they are reported in the check body where
  `relocated` demotions already live, and issue-filing from the panel job is a larger
  blast radius that belongs in its own change.

  **Token attribution.** Every SDK call is stamped with `{ lens, role }`
  (`role` ∈ `detection` | `verifier`) as `scripts/agent/ask.mjs` pushes its result
  to the shared execution log, so `scripts/agent/metrics.mjs`'s
  `attributionBreakdown` can split the panel's spend per lens and by
  detection-vs-verifier instead of one anonymous total — the effort summary renders
  it as a cost · weighted-tokens table. This is what makes "which
  lens, and is it the verifier?" answerable from the ledger rather than by guessing;
  it is measurement only and gates nothing.
  **Prompt caching (shared core).** The diff dominates the panel's prompt input and
  every session re-sent it, so the lens prompt is split in two: a cacheable
  `systemPrompt` prefix carrying the framing, the scope note and the diff, before
  `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, and the lens's own identity + rubric after it in
  the user prompt. `createWarmupGate` then runs one session per DISTINCT prefix
  alone (the `~1.25×` cache write) and fans the rest out concurrently (`~0.1×` reads).
  Grouping is keyed on the prefix *bytes*, not on the lens, which is what lets two
  lenses handed the same slice share one warm-up; a prefix only one session will use
  is sent uncached, since a write nothing re-reads is a `~25%` loss.
  Byte-identity is the whole mechanism, and once every lens dropped to `samples: 1`
  (#607, #610) a lens could no longer share a prefix with itself — leaving cross-lens
  sharing as the only caching left, and excluding exactly the lenses with the biggest
  slices (`security` reads two classes more than the others; `design-fit` appended
  the issue spec, making its prefix unique on every PR). So the cacheable prefix is
  now the **shared core** — the file classes every code-reviewing lens has in common
  (`cacheCoreClasses`, derived from the manifest: `code`, `code-adjacent`, `policy`)
  — while each lens's remaining in-scope hunks and the issue spec ride uncached in
  the user prompt, where they already cost full price and, no other session sending
  those same bytes as a leading prefix, could never be shared anyway (another lens
  may read some of the same hunks — `docs` reads the prose part of `security`'s
  remainder — but as a different byte string, which caching cannot match). `splitLensDiff` guarantees `core + extra` is exactly
  that lens's own slice, so **no lens sees a hunk outside its scope**: file-class
  routing is unchanged, only the packaging is. A lens that does not read every core
  class (`docs`, prose-only) keeps its own slice and shares with nobody, as before.
  On a mixed PR at the shipped one-sample manifest this takes the projected
  prompt-input saving from `~23%` to `~50%` (five lenses on one warm-up instead of
  three); `scripts/agent/cache-report.mjs` renders the projection offline from the
  real prompt builders. Note the API matches a cacheable prefix as a *leading byte
  run* and the SDK exposes a single boundary, so nesting shorter slices inside longer
  ones would need multiple cache breakpoints and does not work here — sharing
  requires byte-*identity*, which is why the core is a common prefix rather than an
  ordering. The
  **trusted orchestrator** (run from a `main` checkout, via the shared
  `scripts/agent/severity.mjs` rule) computes each lens's conclusion — the
  subagents only classify — and the job records one unforgeable
  **`agent-review-<lens>` check run** per lens (the author agent lacks
  `checks:write`). On all-pass it invokes the ready gate; on any failure it feeds
  the combined findings to the author in a bounded fix loop (pages after
  `MAX_REVIEW_ROUNDS`, or earlier on **non-convergence** — see below). The
  `design-fit` lens additionally reads the originating
  issue (via `Fixes #N`) for spec-conformance — but ONLY when that issue is
  labelled `agent:candidate` AND authored by a non-Bot account (otherwise the
  author agent, which holds `issues:write`, could hand itself an arbitrary spec);
  any other referenced issue is not ingested. Issue and diff text — and the
  working tree the lenses Grep — are all untrusted data, and an LLM reviewer can
  still be swayed by prompt injection; see the risk register below for the
  mitigation stack. The human merge gate is the backstop. Same model across lenses
  for now; a per-lens `model` field makes diversity a one-field change.
  - **False-negative hardening (the verifier only fights false *positives* — it
    drops findings, it can't add a missed one).** Two measures raise recall so a
    real issue isn't silently missed, motivated by a live case where the
    correctness lens flagged a regression, then reviewed the *same unchanged code*
    clean on a re-run:
    1. **Sampling + union.** Each lens runs `samples` times (per-lens field in
       `scripts/agent/lenses/lenses.json`, default 2) and the findings are UNIONed — any sample's
       finding enters the gate. The union goes through the same conservative
       `coerceFindings`/`dedupeFindings` (identical file+summary collapse to the
       highest severity; distinct bugs never merge), and the verifier refute pass
       is the precision counterweight. No LLM/semantic merge — that could
       over-merge two distinct bugs into one, reintroducing the miss.
       Every blocking lens runs at `samples: 1`. A second opus detection sample
       was the panel's single largest cost — detection dominated one L-size PR's
       ~$14 panel (#605, surfaced by the per-lens token attribution above) — so the
       second sample was dropped across the board to keep a panel runnable within
       one session limit. The recall the union bought is given up: a defect a
       single sample non-deterministically misses is no longer recovered by a
       second one. For the code-quality lenses the verifier, the tests, and CI
       still backstop a miss; for `security` there is **no** such backstop — a
       planted instruction or a pasted secret missed on the one sample is missed —
       so this is the sharpest edge of the trade, accepted for cost. `samples` is a
       per-lens field, so raising `security` (or any lens) back to 2 is a one-field
       change the moment the attribution table or a missed finding says it is worth
       the spend.
    2. **Cross-round re-check.** Each round persists its blocking findings in the
       per-lens check run's `output.text`; the next round reads the latest prior
       `agent-review-<lens>` findings (`scripts/agent/prior-findings.mjs` →
       `--prior-findings`, the same script on both panel paths) and re-verifies each
       against the *current repository* with the same biased-to-keep refute pass.
       A prior finding survives unless it is *resolved* on grounded evidence — so
       it can't vanish just because a later fresh pass missed it (only because it
       was actually fixed, cited). Unresolved priors merge (deduped) into the
       round's findings.

       **Infra errors are excluded from carry-forward.** A lens that hit an
       API/quota outage (e.g. a 429 session limit) never reviewed; it writes a
       synthetic `{ infra: true }` "Review could not run …" record only to fail
       closed. That record is *not* a code finding — carrying it into the next
       round would make the panel re-check "the review could not run" as a
       blocker, and the biased-to-keep verifier cannot refute it on grounded
       evidence (there is no code claim to disprove), so it would persist across
       every subsequent round. Two guards prevent it: the panel workflow persists
       an empty `output.text` for any lens whose `panelEntry` carries `infraError`,
       and `scripts/agent/prior-findings.mjs` drops any carried record so flagged on
       read (so the guarantee holds on both panel paths regardless of producer). The
       discriminator is the script-set `infra: true` flag — authoritative because,
       unlike a finding's `summary`, a model cannot forge it. A shape-guarded legacy
       fallback (the stable "Review could not run …" prefix **and** no `file`, which
       every genuine finding cites) also catches records persisted before the flag
       existed, so a PR already contaminated by a pre-fix 429 round self-heals on its
       next round rather than re-surfacing the error forever — without ever letting
       model text suppress a real blocker. The lens still fails closed via its check
       `conclusion`; only the bogus re-check input is suppressed.

    **The deferred-findings channel (`agent-deferred-findings`).** The carry-forward
    contract above is deliberately narrow: `output.text` holds only findings that
    GATE, because it feeds the fixer checklist, the next round's re-check, and the
    non-convergence detector, and the last of those needs a quantity that *shrinks*
    as the fixer works — a pile nobody is obliged to fix never shrinks. The
    consequence is that a round's `minor`/`nit` findings, and any blocker the novelty
    or surface gate demoted to `backlog`, reach no tool: `proseOnly` strips finding
    sections out of the markdown bodies, and carry-forward reads `output.text`.
    They are not lost — `.agent-review/<lens>/verdict.json` keeps every finding with
    the `lane` and `novelty` that explain each decision, and the stage-detail capture
    keeps the raw per-sample ones — but nothing on the pull request is addressed to a
    reader.

    So the panel writes a **second, advisory check run**, once per round, aggregated
    across lenses (`scripts/agent/deferred-findings.mjs`), whose `output.text` is a
    versioned JSON envelope (`agent-deferred-findings/v1`) carrying each record's
    `lens`, `file`, `line`, `severity`, `confidence`, `summary`, `evidence` and its
    provenance. Four properties are load-bearing:

    - **It never gates**, on three counts: `conclusion` is always `neutral`, the name
      is never pushed into the required set, and the name sits *outside* the
      `agent-review-` prefix — which is not defensive about a hypothetical consumer,
      because `scripts/agent/set-state.mjs` enumerates every check run on the commit,
      filters that prefix, and derives `lensBlocked` from what it finds.
      `scripts/agent/loop-status.mjs` excludes it from the CI cell for the same
      reason: `neutral` is not a red conclusion, so counted as an ordinary check it
      would report a confident green for a CI run that never happened.
    - **Provenance is recorded as primitives, absence included.** A native minor
      carries *no* `lane` — `annotateFindings` returns non-blockers untouched — and
      that absence is the signal that it never reached the gate. `novelty.origin` and
      `surface.scope` are recorded separately, because the two gates make opposite
      claims about the same code, and only for the severities the gate actually
      routes: on a non-blocker those fields are model output and would forge a
      demotion that never happened. No derived "why deferred" field is stored;
      `severity.mjs::demotedBy` already answers that and defaults to `relocated` for
      unstamped rows, so storing its answer would bake a default into an archive as
      though it were measured.
    - **Every record carries the rubric generation** it was produced under, as one
      `panel_sha` per run resolved from the `.trusted` checkout — the tree the rubrics
      actually came from, which is *not* the PR head. `severity` means whatever the
      rubric in force said it meant, so without the stamp a record written after a
      rubric change is indistinguishable from one written before it. An archive's
      value grows with time, which is why this could not be added in a later version.
    - **The trim states what it dropped.** `output.text` is bounded to 60k like the
      gating channel, but the envelope carries `total`, `emitted` and `omitted`, so a
      partial record announces itself rather than reading as complete — the
      convention `fix-brief.mjs::buildChecklist` already sets and the gating trim
      does not.

    Nothing consumes the channel yet; it exists so that a later pass over the
    deferred pile has an input, off the critical path.

    3. **Out-of-diff review.** The two measures above both re-read the *same
       artifact*, so neither finds a defect the diff does not contain. A Major
       correctness bug shipped through review on exactly that shape: a new
       read-only guard on the docs editor, with `EditorAPI.paste()` reaching the
       same mutation without it. The correctness and security lenses passed the
       diff twice; the bypassing line was never in it.

       The **`blast-radius`** lens exists for that class and nothing else. Its
       method is the lane: for every changed guard, signature, or contract, Grep
       the repository for every *other* reference and check whether it still
       holds — bypassed guards, unupdated callers, stale consumers of a changed
       export, removed exports still referenced, violated invariants. Line-level
       logic inside the diff is explicitly deferred to correctness, auth design
       to security, so it does not become a fifth general reviewer doubling the
       noise. Scoped `packages/**` + `scripts/**` (out-of-diff impact is a
       property of code) and blocking from day one.

       `scripts/agent/lenses/correctness.md` and
       `scripts/agent/lenses/security.md` additionally carry a **call-site
       mandate** for guards in their own lane: enumerate the other call sites of
       what a new guard protects and cite any bypass by `file:line`. The overlap
       with `blast-radius` is deliberate — an added-but-bypassable gate reads as
       covered, which is worse than no gate.

    All three lower false-negative odds; none makes the panel safe to
    self-promote — the human review gate stays the backstop.

  - **Incremental review (scope narrowing, `scripts/agent/review-state.mjs` +
    `scripts/agent/review-scope.mjs`).** Live in the autonomous panel; the
    on-demand path never narrows.

    The reviewed artifact was `git diff origin/main...HEAD`, recomputed every
    round, so an 8-round PR reads round-1 code eight times. Both endpoints of
    `...` also move: a human `git merge main` changed the artifact with no
    semantic change to the branch and flipped a lens verdict.

    Each lens's **`external_id`** carries what it last reviewed —
    `{"v":1,"reviewed":…,"base":…,"since":…,"mode":…}`. Every candidate location
    sits behind the same `checks:write` boundary (the author agent cannot forge
    any of them), so the choice was about failure modes: `output.text` is
    disqualified because the panel trims it to fit a 60k limit by *dropping
    findings* — it is designed to lose data, and a field that decides whether code
    gets reviewed must not live in a lossy channel.

    **The write rule is a function, not a convention.** `panelEntry` in
    `scripts/agent/review-panel.mjs` attaches the pointer only when a lens produced
    a real verdict (`valid` and not skipped), so a crashed, quota-failed, skipped or
    inapplicable lens stamps nothing and the next round finds a state gap for it.
    Coverage is *proven by the presence of a pointer* rather than asserted
    alongside it, which is why `resolveReviewMode` needs no separate "did this lens
    actually review?" input. It is a function because the first version was a rule
    the three call sites were trusted to follow, guarded by a test that scanned the
    source for which one carried the field — and that test passed when the pointer
    was also attached elsewhere by a separate assignment.

    **Who decides what, and where.** The panel orchestrator resolves neither the
    mode nor the diff: `scripts/agent/review-scope.mjs` reads the pointers (checks
    API) and measures the range (git), `resolveReviewMode` decides purely, and the
    workflow step that *rewrites the diff* is the same step that emits the
    `--review-mode` flag — so the two cannot disagree about what the panel is
    looking at. Their fail directions differ deliberately: the scope step only
    computes, so it tolerates failure and costs a full review; the narrowing step
    mutates the reviewed artifact, so any failure there fails the job. A narrowed
    diff with no flag is the one outcome this design must not produce, and
    `scripts/agent/review-panel.mjs` cannot detect it — it receives a file, not a range.

    `latestLensRuns` filters check runs on `app.slug === "github-actions"`. That
    narrows the writer to a workflow **in this repository**, not to the panel
    specifically — the slug identifies the App, and any workflow here that
    declared `checks: write` would share it. Today only the panel does, and no
    author-controlled workflow can gain it, because a branch cannot edit
    `.github/workflows/**`. That is the boundary; the slug filter rests on it
    rather than replacing it.

    `resolveReviewMode` is fully pure (every git fact injected) and **fails to
    `full` on any doubt**, reporting which: `no-prior-state`, `lens-state-gap`,
    `lens-state-divergence`, `no-new-commits`, `git-facts-unavailable`,
    `force-push-or-rewrite`, `merge-in-range`, `periodic-rebaseline`,
    `delta-too-large`, `invalid-input`, or `ok`. Correctness hazards are checked
    before policy caps so the reported reason names a real problem when one
    exists. Reviewing code twice costs tokens; reviewing it zero times ships a
    bug — there is no case where "probably fine" resolves to `incremental`.

    **The recall regression is real, not hypothetical.** Carry-forward re-checks
    findings already *raised*; it cannot surface a defect whose root cause is
    round-1 code that only became reachable via round-3 code. Three mitigations,
    all mandatory before any round narrows: a **scope note** (`renderScopeNote`)
    telling the lens it still owns defects the delta newly exposes in earlier code,
    that the full working tree is its cwd, and that the changed-file list is
    cumulative; a **forced full round** every 3 rounds plus on any of the hazards
    above; and wider diff context (`-U15`) on narrowed rounds. The honest saving is
    therefore **~2x, not ~8x**.

    **A pointer means the lens LOOKED, not merely that it reported.** Per-lens diff
    slicing (#582) lets a lens produce a valid verdict having run zero detection
    samples: `lensReviewPlan` returns an empty slice when the PR contains files it
    reads but none changed in this round's delta, and the round then rests on the
    prior-finding re-check alone. Such a lens does **not** stamp — `panelEntry`
    requires `ranDetection`, derived from the samples that actually returned.

    Letting it stamp would make `scopeClasses`/`classifyFile` **retroactive**:
    widening a lens's scope later would apply only to commits after the pointer,
    where today it self-heals because every round re-reads the whole diff. Not
    stamping costs one forced-full round; stamping costs a permanent, invisible
    hole. If those forced rounds prove expensive, the cheaper form is a digest of
    the lens's scope config inside the state, so changing the config invalidates
    the pointer — the mechanism `REVIEW_STATE_VERSION` already provides for shape
    changes.

    `--changed-files` stays **cumulative** in every mode. Fed the delta instead,
    `lensApplies` could mark a narrow-glob lens inapplicable in round N, the
    workflow would drop it from `required_checks`, and a lens that FAILED in round
    2 would silently stop being required in round 3 — promoting with an unresolved
    blocker. Unreachable today; the constraint exists so it stays that way.

    CLI defaults to `full`, so all three callers behave byte-identically until the
    workflow opts in — `buildLensPrompt` is exported so a test renders both prompts
    and compares bytes, rather than asserting inertness by reading the source. Two
    inconsistent invocations throw instead of reviewing: incremental with no usable
    `--since-sha`, and `--since-sha` without the mode flag (the shape a lost
    workflow input takes). The on-demand path must never narrow: it records no
    check runs, so it can never write a pointer back.

    `scripts/agent/prior-findings.mjs` replaces the inline `github-script` that
    reads the previous round's findings, with the same behaviour under test. Two
    GitHub API contracts are load-bearing and are easy to get wrong: the
    `commits/{sha}/check-runs` **list response omits or truncates `output.text`**,
    so each selected run is re-fetched by id (a truncated payload fails
    `JSON.parse`, which would silently carry zero findings), and that endpoint is
    object-wrapped, so `--paginate` needs `--slurp` or the concatenated pages are
    invalid JSON. Every `catch` is per-commit or per-lens: prior findings can only
    re-raise a blocker, never clear one, so the fail direction here is "carry fewer
    findings", the opposite of the rest of the pipeline.

    **API/quota error classification.** The Agent SDK reports API failures as a
    `result` message with `subtype:"success"` but `is_error:true` (+ `api_error_status`,
    e.g. a 429 "You've hit your session limit"), so "success" alone is not proof the
    model ran. `classifyResult` distinguishes a real verdict from an *API error* (and
    a transient API error from a *session/usage-limit*, which resets on a fixed
    schedule) from a genuine *no-output*. Transient API errors get a bounded
    `withRetry` (exp backoff); a session-limit fails fast (retry can't clear it). When
    EVERY blocking lens fails on an API error the panel marks an `infraError`: it still
    fails closed (never promotes), but the fix job pages with the *real* reason
    ("Claude API/quota error — re-run after reset"), **skips the fixer** (nothing to
    fix) and does **not** count it toward `MAX_REVIEW_ROUNDS`. This keeps a credential
    outage from masquerading as a code review finding (the #547/#548 test failures).
- **Ready gate** — `scripts/agent/mark-ready.mjs`, invoked by the review-panel
  workflow on all-pass: promotes draft → ready only when the **CI workflow run**
  for the head SHA concluded `success` (read via the Actions API, not the
  author-writable verification comment), **every** required `agent-review-<lens>`
  check concluded `success` (`--require-checks`), and AI authorship is disclosed.
  Gates 1 and 2 are unforgeable — evidence a separate actor produced. Gate 3
  (disclosure) is a required self-attestation (belt-and-suspenders with the
  commit-trailer hook). The gate only flips draft → ready; it has no merge
  authority. The `agent-review-<lens>` checks must **never** be configured as
  sufficient-for-merge on their own — a **required human approving review**
  (branch protection: ≥1 approval + dismiss-stale) stays the non-bypassable merge
  gate (the backstop for LLM-reviewer prompt injection). CODEOWNERS is scoped to
  the pipeline's *own* files, so it additionally requires an owner's review for
  changes to the harness itself, but the repo-wide agent-PR gate is the
  branch-protection approval, not CODEOWNERS.

    **Gate 1 identifies CI by workflow PATH, not by the run's display name.**
    A run's `name` is only the workflow file's `name:` key and nothing makes it
    unique, so a second file saying `name: CI` would produce runs
    indistinguishable from the real ones — and anyone able to push a branch to
    the base repo could then hand gate 1 a green run for their own head SHA.
    The agent App cannot push `.github/workflows/**` (the boundary the panel's
    `workflow_run` trigger rests on), but an `agent:managed` human PR is on the
    same promote path and is not restricted. `CI_WORKFLOW_PATH` and
    `ciConclusion()` in `checks.mjs` are the single source for both readers
    (`mark-ready.mjs`, `set-state.mjs`), and tolerate the `@ref` suffix a called
    workflow reports. `checks.test.mjs` asserts the path names a file that
    exists and whose runs are still named `CI` — a rename that broke the match
    would otherwise make the gate silently unsatisfiable for every PR.

    **Gate 1 identifies CI by asking the API for that workflow's runs**
    (`/actions/workflows/ci.yml/runs?head_sha=…`), not by fetching every run for
    the SHA and matching in JS. That is the identity check, not a convenience:
    matching a run's `path` in JS is parsing an attacker-influenced string, and
    the first attempt stripped an `@ref` suffix, so a file named
    "ci.yml", an at-sign, then anything ending in .yml — a legal filename, and
    one Actions runs because of that extension
    — matched the real workflow and re-opened the forgery. Server-side scoping
    also bounds the response to CI's own runs, so a flood cannot push the CI run
    past `per_page`. The `workflow_run` gates still compare
    `github.event.workflow_run.path` with exact equality, because a
    `workflow_run` trigger has nothing to scope server-side.

    **The newest run wins**, ordered by run `id` (assigned in creation order,
    always present, integer) rather than `created_at`, where a missing or
    unparseable stamp yields NaN and a NaN comparator does not order. A SHA can
    legitimately carry two runs — reopening a PR files a second `pull_request`
    run for the same commit — and newest-wins is correct there, since the later
    run is a fresh execution of the same file at the same tree. What must not
    happen is two runs from DIFFERENT triggers racing for one PR head, where
    "newest" is arbitrary rather than superseding; `checks.test.mjs` pins the
    trigger set so adding such a trigger fails loudly.

    **What gate 1 does NOT prove.** A `pull_request` run executes the PR
    BRANCH's copy of `ci.yml`, so a branch able to edit that file can produce a
    genuinely green run at the genuine path with no tests in it. The agent App
    cannot (it may not push `.github/workflows/**`), but an `agent:managed`
    human PR is on this promote path and is not restricted. Gate 1 therefore
    means "a separate actor reports CI green for this SHA", not "main's CI
    definition passed"; closing that needs the run's workflow content compared
    against the base branch.

    A revision of this doc briefly specified the stricter rule — EVERY run for
    the SHA must be green — on the theory that newest-wins would fail open if a
    SHA ever carried two. It is recorded here because the reasoning looks
    correct and the outcome was not: it closed nothing reachable, and it cost
    three real defects. `@claude rerun` could no longer clear the gate, since it
    re-ran one run; re-running all of them then eroded `agent-iterate-ci`'s
    attempt bound, which counts current `failure` conclusions and a re-run
    REPLACES one; and the resulting fan-out emitted a `workflow_run` completion
    per run into a `cancel-in-progress` group, cancelling the fixer mid-push.
    Failing closed on a hole that is not open is not free — prefer a tripwire on
    the invariant to a rule that does not need it.

    **The trigger side needs the same guard, and cannot express it.** A
    `workflow_run` trigger's `workflows:` filter matches display names only, so
    a forged `name: CI` run still *reaches* every workflow that consumes CI.
    Hardening only the reader would leave the arms that INVOKE the agent open:
    the panel's `fix` job and `agent-iterate-ci.yml` both hold `contents: write`
    and push to the PR branch, and CI's conclusion is the mutex between them.
    `agent-review-panel.yml`, `agent-iterate-ci.yml` and `ci-report.yml`
    therefore assert `github.event.workflow_run.path` in their gating job.
    `docker-publish.yml` / `publish-ghpage.yml` need no clause — their
    `head_branch == 'main'` gate means a forgery would have to be merged first.

    The panel's **concurrency group must carry the same clause as its gate**,
    which is easy to miss because the two are written far apart. `concurrency`
    is claimed at run creation, before any `if:` is evaluated, so a run the gate
    will refuse still takes the group — and with `cancel-in-progress: true` it
    would kill a legitimate panel mid-review, then skip every job, recording no
    verdicts and paging nobody (`stalled` is `!cancelled()`). `checks.test.mjs`
    evaluates both expressions across every event/attempt/path combination and
    fails if they disagree.

    **Exit-code contract with the `promote` job.** mark-ready reports its whole
    outcome through its status: `0` promoted · `1` a gate said no (job succeeds,
    PR stays a draft) · `2` tooling error · `3` gates passed but the flip failed.
    The consumer branches with a `case` that has a `*)` default failing the job,
    because a bare `if [ -eq N ]` chain let an unenumerated status (127 from a
    missing binary, 128+signal from a kill) fall through and **succeed silently**.
    Two consequences worth knowing before editing either side:

    - **`1` is also node's own crash code**, so it is not believed on its own.
      The job greps the captured log for mark-ready's literal verdict line
      (`Not promoting: one or more gates are not satisfied`) and treats a `1`
      without it as a crash → exit 2. That sentence is therefore a **load-bearing
      cross-file contract**, in the same category as `HANDOFF_MARKER`, and
      reflowing it breaks promotion; `mark-ready.test.mjs` pins it from both
      sides — it reads the needle out of the workflow and asserts a real exit-1
      run prints it.
    - **The capture is a redirect, never a pipe.** `cmd | tee log` makes `$?` the
      status of the last pipeline element, discarding the only thing the block
      branches on. The log is `cat`ed afterwards so the report still reaches the
      step log.

    Each branch also records an `outcome` output (`promoted` /
    `gates-unsatisfied` / `flip-failed` / `crashed` / `tooling-error` /
    `unhandled-status`) so the sticky loop-status comment names what actually
    happened rather than guessing from the absence of `ready`.
- **Agent state (advisory single-value label)** — `scripts/agent/set-state.mjs`
  keeps **exactly one** `agent:<state>` label on the PR at a time
  (`implementing → awaiting-ci → reviewing → fixing → ready | blocked`), replacing
  the old additive `agent:iterating` / `agent:needs-human-review` labels (which
  could co-exist, and where `needs-human-review` ambiguously meant both "promoted"
  and "gave up"). `computeLabelSet` replaces the whole label set (atomic PUT),
  stripping every lifecycle *and* legacy label while preserving non-agent labels
  and the issue-side `agent:candidate` provenance. States are set inline by the
  trusted steps that already run — `reviewing` (review-panel), `fixing` (fix /
  iterate-ci), `ready` (mark-ready on promotion), `blocked` (every paging path);
  `implementing` is set by the kickoff agent and `awaiting-ci` is derived-only.
  **The label is a projection, never a gate** — no `if:` reads it (gates stay on
  check runs / CI conclusion / job results / the paged-comment latch). `set-state
  reconcile` re-derives the state from those unforgeable signals and overwrites
  drift; it runs on the stalled path and can be invoked manually.
- **Provenance** — `scripts/hooks/require-ai-disclosure.sh` (PreToolUse Bash,
  gated on `WAFFLEBASE_AGENT_AUTONOMOUS`) enforces an
  `Assisted-by: Claude Code (autonomous)` commit trailer on autonomous runs.

- **Convergence detection (early exit from the fix loop).** `MAX_REVIEW_ROUNDS`
  is a blunt backstop — PR #521 burned all five rounds re-litigating overlapping
  findings before anyone was paged. It is now **3**, down from the 5 that PR #521
  exhausted: `detectStalledRounds` needs `minRepeats + 1` = 3 rounds of evidence
  before it can report a stall, so no earlier non-convergence page is possible,
  and rounds 4-5 were a PR paying a full panel round each (~$12) on the way to a
  page that was already inevitable. Note this bounds the **fixer** directly; panel
  spend after a page is bounded separately, by the paged latch in the `gate` job
  (the round guard runs in `fix`, downstream of `review-panel`, so on its own it
  left a paged PR re-reviewing on every CI-green push — five rounds and $53.98 on
  #605). `scripts/agent/rounds.mjs`'s
  `detectStalledRounds` (wired into
  `scripts/agent/review-round-guard.mjs`, checked BEFORE the round cap so the
  more specific reason wins) pages as soon as two consecutive round pairs both
  (a) fail to reduce the blocking-finding count and (b) exceed a similarity
  threshold against the previous round's findings.
  **Overlap alone is deliberately NOT the trigger**: the cross-round re-check
  above re-merges unresolved priors by design, so a healthy PR shows high
  overlap every round — only overlap *without* a falling count distinguishes a
  stall. Similarity is the overlap coefficient over tokenised summaries, gated
  on lens + file, calibrated at 0.3 against real rephrasings from PR #564
  (same-defect 0.39-0.71, different-defect ≤0.08). It **fails toward not
  paging**: malformed, unreadable, or infra/quota rounds break the run rather
  than manufacture a page, since `MAX_REVIEW_ROUNDS` still backstops and a
  spurious page is the costlier error. Tuned via `STALL_REPEATS` /
  `STALL_SIMILARITY`.
- **`MAX_REVIEW_ROUNDS` counts FIX ATTEMPTS, not panel rounds.** It used to count
  every single-parent commit carrying a failing lens verdict, which is not the
  same thing and was wrong on every agent PR measured. The implement workflow
  pushes its work, self-reviews, fixes what it found, and pushes AGAIN — two
  commits, each drawing its own panel round, both counted as failed fix rounds
  before the fix loop had run once. On #648 and #605 alike that consumed exactly
  2 of the budget, so lowering the cap from 5 to 3 cut the loop from three real
  attempts to **one**; #648 then reported "requested changes 3 times without
  converging" after a single fix attempt. The discriminator is already in the
  data: *a commit committed before the panel first spoke cannot be a response to
  it*. `isFixerCommit` was renamed `isSingleParentCommit`, because that is all it
  ever tested and the old name is what made the miscount look correct.

  It **fails toward counting**: a commit whose position cannot be established
  counts, and with no verdict timestamps anywhere the floor is abandoned entirely.
  Over-counting pages a round early, which a retry undoes; under-counting means
  the cap never trips and the loop is unbounded.
- **The count is now a LEDGER, because the inference above is a race.** "Committed
  after the panel first spoke" is the right discriminator only when the implement
  job's self-review push and the first lens verdict happen in the expected order,
  and they do not reliably: on #737 the self-review push beat the first verdict by
  **20 seconds** and was correctly excluded; on #695 it lost by 2m50s, so two
  implement pushes were charged as fix attempts. A third round there came from a
  panel the concurrency guard CANCELLED, whose `always()` verdict step still wrote
  six fail-closed reds onto a commit nobody reviewed. Three counted rounds, one
  actual fixer invocation, and a page that said "the fixer has tried 3 time(s)".

  So the guard stopped inferring and started recording: it writes a hidden
  `<!-- agent-fix-dispatch -->` comment immediately before dispatching, and
  `rounds.mjs::fixRoundsUsed` counts those. `countFailedReviewRounds` remains the
  fallback for PRs that predate the ledger, and the first record carries a `prior`
  baseline so such a PR hands over exactly rather than earning its spent rounds
  back; a `@claude rerun` that cuts the ledger drops the baseline with it.

  **Who may write a record is deliberately narrower than who may write the paged
  latch**, and the asymmetry is the same one `rerunPointFrom` turns on. Records
  become authoritative the moment one exists, so a single planted record would
  switch a PR off the fallback and could hand back budget — the opposite fail
  direction from the latch, where over-accepting merely stops the loop. Records
  are therefore believed only from `github-actions[bot]`, the guard's
  `GITHUB_TOKEN` identity, with **no association path and not `yorkie-agent[bot]`**
  — that is the App identity the fix agent itself posts under, and the party
  bounded by `MAX_REVIEW_ROUNDS` must not get to choose the rule it is counted by.
  The write is not best-effort either: a dispatch whose record never landed is a
  round the next guard hands out again.

  `close-stuck-checks` closes a cancelled panel's lenses as `cancelled` rather
  than `failure`, and the verdict step is `!cancelled()`, so a superseded round
  stops reading as a spent one. The promote gate is unaffected —
  `checks.mjs::checkPassed` accepts only `success` and treats an absent check as a
  failure — and no `agent-review-*` check is required by branch protection.
- **`@claude rerun` now restores the fix budget too.** #650 added the command: it
  deletes the paged comments, drops `agent:blocked` and re-runs CI. What it could
  not do is give the loop its attempts back — its own summary said the PR was
  "still bounded by the pipeline's round/attempt caps", which on a PR that reached
  the cap means one panel round and an immediate re-page. That is exactly what
  #648 did when it was un-stuck by hand. `scripts/agent/review-round-guard.mjs`
  now counts fix attempts only from the newest rerun.

  **The resume point is the maintainer's COMMAND, not the workflow's result
  comment**, and that is a security property rather than a convenience. The first
  version keyed on a hidden marker trusted by bot login — but `.github/workflows/agent-rerun.yml`
  posts with the App token, so the trusted identity is `yorkie-agent[bot]`, the
  same identity the fixer and implementer post their own free-form comments under.
  The party bounded by `MAX_REVIEW_ROUNDS` could therefore reset its own bound by
  opening a comment with the marker line: an LLM reading an untrusted diff, granted
  unlimited fix attempts, by accident or by injection. A human's command cannot be
  forged by a bot, because `user.type === "Bot"` is refused and no App can present
  as a non-Bot — a structural exclusion rather than a string the agent must not
  guess. Known gap, named rather than hidden: `author_association` is weaker than
  the `getCollaboratorPermissionLevel` the command itself enforces, so an org
  member without repo write moves the floor; the workflow still refuses to act for
  them.

  A hand-back also holds the **stall** and **rebuttal-standstill** pages for one
  attempt. Those run before the cap and read pre-rerun history, so without it a
  rerun on an already-stalled PR re-pages on the first post-rerun round — the same
  failure through a different door. It delays them by one round; it never disables
  them.

  It does **not** reset the CI-fix arm's separate attempt bound, which
  `.github/workflows/agent-iterate-ci.yml` counts from prior failed CI runs. The command's summary
  says so explicitly rather than claiming a blanket restart.
- **The stall bound counts fix attempts too.** `detectStalledRounds` ran over every
  round on the PR, including the implementer's two pre-verdict pushes, so three
  rounds of "evidence" existed immediately and the stall door could cut the loop to
  one real attempt — the cap fix closed one door and left this one open. Both now
  share `fixAttemptCommits`, so the two bounds cannot disagree about what a fix
  attempt is.
- **One panel per branch at a time.** `.github/workflows/agent-review-panel.yml` carries a
  `concurrency` group keyed on the head repository and branch, with
  `cancel-in-progress`. The repository half is a security requirement: the group is
  evaluated before `gate` applies its fork check, so a branch-only key would let a
  fork PR named to match an in-flight agent branch cancel the real panel.
  Two CI completions close together (a re-run, or a push landing mid-round) used
  to start two full pipelines against the same branch, and it broke two PRs in
  distinguishable ways. **#605**: two panels finished in the *same second* with
  identical `external_id` and contradictory verdicts — correctness 1 major vs 2
  major, docs success vs failure — twelve check runs for six lenses, last writer
  wins. **#648**, worse because the panel dispatches a fixer: two fixers ran on
  one branch for 21 overlapping minutes on the same nine findings; the later
  converged in 76 turns and pushed, the earlier crossed its 80-turn ceiling and
  failed, and `stalled` then paged *"the requested changes were not applied"* when
  they had just been applied by the other run. Cancel rather than queue — a
  superseded panel is reviewing a sha that is no longer the head, so its verdict is
  stale before it is written.

  Three consequences worth stating because each is a trap. **`stalled` moved from
  `always()` to `!cancelled()`**: under `always()` a cancelled run still paged,
  because a panel cancelled before it started reports `skipped`, which is one of
  its trigger conditions — so the guard would have latched a PR to `agent:blocked`
  at the moment a fresher round was starting, and the latch would then stop that
  round. **The stuck-check cleanup had to move out of `stalled`** into its own
  `close-stuck-checks` job: it exists for the killed/cancelled case and rode on the
  same `always()`, so leaving it there would have stranded six `agent-review-*`
  checks in progress on every superseded round — the two need opposite cancellation
  behaviour, which is why bundling them regressed. **The group key must not include
  `run_id`**, or it matches only itself and guards nothing.
- **The fixer's turn ceiling is 200**, above `agent-implement`'s 150. The fixer
  must first READ code it did not write, at locations the panel chose, then fix
  every finding in one pass because the prompt tells it to converge in one round.
  At 80 it died at exactly 81 turns on #648 while a concurrent duplicate landed
  the same work in 76 — not a margin, a coin flip. The ceiling is a backstop
  against a runaway loop, not a budget: `MAX_REVIEW_ROUNDS` and the 45-minute job
  timeout both bind well before 200 turns of useful work does.
- **A page must not guess.** The `stalled` page distinguishes three states when the
  fixer job fails — the head moved (an unreviewed commit landed), it did not
  (nothing pushed), or the head could not be read (say so). It deliberately does not
  say WHO moved it: a human push and a concurrent run's fixer are indistinguishable
  from there, so "the fixer pushed the fix" would be the same unproven claim in the
  other direction. The flat
  "the requested changes were not applied" was simply false on #648, and because a
  page is the one message a human is guaranteed to read, it sent the investigation
  after an unresponsive fixer instead of an unreviewed commit.

Human gate (mechanical, not prompt-based): branch protection on `main` requires a
human approving review + CI green + dismiss-stale-approvals; the `agent-implement`
kickoff also fails closed unless that protection is present. The agent token is
non-admin; the pipeline never calls `gh pr merge`. "You sign off on every line"
moves to the approving human reviewer.

### Threat model & residual risks (read before arming)

- **Not fully "dormant" on merge.** The workflows are inert until
  `vars.AGENT_PIPELINE_ENABLED=true`, but three things take effect on merge:
  `.github/CODEOWNERS` (scoped to the pipeline's own files, not repo-wide), the
  `.github/ISSUE_TEMPLATE/agent-task.yml` issue template (appears in the chooser),
  and the `scripts/hooks/require-ai-disclosure.sh` hook registration (a no-op
  unless `WAFFLEBASE_AGENT_AUTONOMOUS=true`). So this PR is a governance change,
  not a zero-effect one.
- **The high-value asset is the secrets, not the draft flag.** The verdict/ready
  architecture makes the *draft→ready* decision unforgeable, but that flag has no
  merge power (a human CODEOWNER must still approve). The real asset is
  the Claude auth secret (`ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` for
  a `claude setup-token` subscription token) + the write-capable App token, held by the code-executing
  agent jobs (`agent-implement`, `agent-iterate-ci`, the review `fix` job) which
  run `pnpm install` (branch `postinstall`) and an unrestricted-`Bash` agent on
  the branch. An adversarially prompt-injected author agent could exfiltrate
  them there. This is inherent to running an autonomous coding agent with an API
  key; it is NOT defended by the review gate. Mitigations: the protected `agent`
  environment (optional per-run human approval), the enablement switch, fork-
  origin rejection, and treating the Claude auth secret as least-privilege and
  rotatable. Adopters must accept this risk consciously.
- **The Claude auth secret is now a pool, and the count matters.** Throughput was
  capped by one account's usage window: when it closed, every lane failed at
  once. `scripts/agent/token-pool.mjs` reads `CLAUDE_CODE_OAUTH_TOKEN` plus
  `CLAUDE_CODE_OAUTH_TOKEN_1..8` from the `agent` environment, selects one per
  **job** from `GITHUB_RUN_ID` + `GITHUB_RUN_ATTEMPT` (so a re-run of a job that
  died on exhaustion does not immediately re-pick the closed account) plus
  `CLAUDE_POOL_SHARD` where jobs of one run would otherwise collide — every leg
  of `eval-replay`'s matrix shares a run id — and replaces it only when that
  account's window closes. Per job rather than per
  call because prompt caches are scoped to the account that wrote them, and
  `createWarmupGate()` exists to pay for the panel's shared diff prefix once; per-call
  rotation would pay that warm-up once per token instead.

  **This relaxes a stated invariant, and the relaxation is the residual risk.**
  The rule in the SDK steps was "export ONLY that one — no second credential in a
  process whose cwd is the untrusted branch checkout"; the pool needs its
  alternatives *in* that process, because failover happens inside the round, so
  the count there is now up to nine. What still bounds it: those sessions grant
  `Read`/`Grep`/`Glob` with `permissionMode: 'dontAsk'` and `settingSources: []`,
  so reaching the environment takes an SDK bug rather than prompt injection —
  defence in depth, not a substitute for the count. **Open:** hand the
  untrusted-cwd step only the two credentials a round can use (the selected one
  and its failover), choosing them in a trusted step. Until then, treat every
  pooled token as sharing one blast radius: rotate them together.
- **The `claude-code-action` lane is not pooled yet.** `agent-implement`,
  `agent-fix`, `agent-iterate-ci`, `agent-review-reply` and `agent-summarize`
  pass the token as an action *input*, so selection has to happen before the step
  and failover has to be a second step. That wrapper needs two behaviours
  confirmed on a real runner first — `continue-on-error` on a composite step, and
  passing a credential through a step output — and both fail silently if the
  assumption is wrong. It lands with that verification, not before.
- **The agent-state label is forgeable and advisory.** The author agent holds
  `issues:write`, so it can set any `agent:<state>` (e.g. a fake `agent:ready`).
  This is acceptable because **nothing gates on the label** — it is a human-facing
  projection only — and `set-state reconcile` re-derives the true state from the
  unforgeable signals (CI conclusion, lens check runs, draft flag, paged latch) and
  overwrites drift. Never wire a workflow `if:` to read `agent:<state>`.
- **LLM-reviewer prompt injection.** The panel's lens subagents read an untrusted
  diff (and, for design-fit, the issue) — **and the untrusted working tree**. They
  run with `cwd` set to the branch checkout and `Read`/`Grep`/`Glob` allow-listed,
  and several rubrics now direct them into the repository (`blast-radius` *requires*
  it), so a planted comment, fixture string, or doc is reached by instruction
  rather than by chance. Injected text can sway severity classification or ask for
  an empty verdict.

  Mitigations, weakest to strongest. **Prompt framing:** every rubric and the
  shared `LENS_CLOSING_INSTRUCTION` frame the diff *and the working tree* as DATA
  and make steering text a reportable finding — necessary, not sufficient.
  **Structural:** tools are read-only (no `Bash`/`Write`/network),
  `settingSources: []` blocks branch-supplied `.claude` hooks, the trusted script
  rather than the subagent computes the gate, and each lens runs `samples` times
  with the findings unioned. **Backstop:** the human merge gate; the
  `agent-review-<lens>` checks must never be sole merge authority.

  Residual risk worth naming: an injected "report nothing" produces an empty
  findings array, which no trusted-code check can distinguish from a genuinely
  clean review. The per-finding verifier does not help here — it only removes
  findings, so it cannot recover one that was never raised.
- **"No human keystroke" is aspirational, phased.** The done-criterion below
  describes no human *authoring* keystroke. In early phases the `agent`
  environment SHOULD keep required reviewers (a human approves each secret-bearing
  run) — that deliberately inserts a keystroke and is worth it. Fully
  approval-free autonomy is a later phase, only once the (now unforgeable) loop
  bounds are trusted in practice.

Done criteria: A maintainer's `@claude fix` on a well-specified issue yields a green,
independently-reviewed, disclosed draft PR marked ready-for-review with no human
*authoring* keystroke between the mention and the review request — and no path for
the agent to reach `main`.

### Phase 25: Local Spec→PR front half

A second front door to the same back half, run on the developer's machine via the
Claude Code CLI instead of an `@claude` issue comment. `.claude/commands/spec-to-pr.md`
(slash command) drives spec → human gate → task → branch → implement → local review →
`verify:self` → draft PR; `scripts/agent/spec-to-pr.mjs handoff` is the deterministic
last mile. The key insight: the back half (`.github/workflows/agent-iterate-ci.yml` +
`.github/workflows/agent-review-panel.yml`) is triggered purely by CI `workflow_run` on same-repo
`agent/*` branches — it is **not** coupled to issues — so a locally-produced
`agent/*` draft PR is picked up identically to an issue-originated one. Nothing in
the back half changes; only this local front half is new.

- **Byte-identical artifact** to the cloud front half: branch `agent/<slug>` off
  `main` pushed to the base repo; draft PR with base `main`; every commit carries
  the `Assisted-by: Claude Code (autonomous)` trailer (enforced locally by
  `scripts/hooks/require-ai-disclosure.sh` once `WAFFLEBASE_AGENT_AUTONOMOUS=true` is exported);
  a PR body that satisfies the ready-gate disclosure check. The draft PR's
  `pull_request:[main]` event runs CI (a bare branch push does not — push is
  filtered to `main`), which is the same trigger the cloud front half relies on.
- **Single source of truth for the disclosure gate:** `scripts/agent/disclosure.mjs`
  exports `disclosesAiAuthorship`, imported by BOTH `scripts/agent/mark-ready.mjs`
  (the gate) and `scripts/agent/spec-to-pr.mjs` (the local self-check) — so the
  local body can never drift from the gate it must pass.
- **Runner split:** local machine for spec→…→draft-PR (verify runs locally, a
  deliberate divergence from the cloud front half, which defers to CI); existing
  GitHub Actions for the CI-fix loop → review panel → ready.
- **Local review is a convenience, not authority:** `spec-to-pr.mjs review` runs the
  same lenses over the working diff, but needs `CLAUDE_CODE_OAUTH_TOKEN` and degrades
  to a warn-and-skip when it is absent. The authoritative panel is still the cloud
  one, which now runs alongside CI rather than after it.
- **Single-writer / branch ownership (the key risk):** the local session owns the
  branch only until the draft PR is created; after that the cloud loops push
  follow-up commits to it. The rebase-on-`main` happens BEFORE handoff (so the
  first push can't conflict), the helper prints a loud "branch is now cloud-owned"
  notice, and the playbook ends the session immediately. Pushing again races the
  cloud fixer and a force-push would break the loops' append-only counters. This is
  behavioral, not mechanical — the one residual risk to respect.
- **Access tier:** because the back half requires `head_repository == base repo`,
  this front door works only for a developer with **push rights to the base repo**
  (fork pushes are rejected) — the same tier that can arm the pipeline.

### Phase 26: Autonomous Issue Hunting

**Principle:** Capability-First Debugging + Entropy Management — the pipeline so
far *consumes* issues; this produces them, by driving the product and observing it
fail.

Goal: an agent explores the `wafflebase` CLI, finds real defects, verifies them,
and emits a report. Tier 1 (shipped) is local and **files nothing** — precision is
measured before any maintainer attention is spent. Filing is a later phase.

**Why this is a separate subsystem and not a fifth review lens.** The cost
asymmetry *inverts*. The review panel FAILS CLOSED: uncertainty keeps a finding,
because a false positive costs one fix round while a false negative merges a bug.
Issue hunting must FAIL QUIET: uncertainty DROPS the candidate, because a false
positive costs a maintainer's attention and pollutes the tracker, while a false
negative costs nothing — the defect stays undiscovered exactly as it is today and
the next run looks again. Getting this backwards produces the documented curl
outcome (~20% of submissions AI slop, zero genuine vulnerabilities in six years of
monitoring, bug bounty discontinued 2026-02-01).

That inversion makes every review-panel helper actively unsafe here, and
`scripts/agent/hunt-gate.mjs` documents each rejection in its header:
`normalizeSeverity` maps unknown → `major` (reportable → invents a report);
`coerceFindings` turns junk into a synthetic blocking finding; `dedupeFindings`
escalates severity on collision; `unionSamples` needs only one lucky sample; and
`applyVerifications` treats a null verdict as KEEP. All five are replaced with the
failure direction flipped. Polarity-neutral helpers ARE shared — `globToRegExp`,
`classifyResult`, `withRetry`, `CITATION`, and `KNOWN` from `scripts/agent/severity.mjs` (the
severity vocabulary is shared; only the coercion rule differs).

Components:

- **The hunter never gets `Bash`.** `scripts/agent/ask.mjs` refuses it outright, so
  the model emits a probe PLAN — `argv` arrays plus a predicted observation — and
  `scripts/agent/hunt-probe.mjs` executes it via `spawnSync` with no shell. Three
  consequences: no shell string is ever built from model output; the clean room is
  enforceable because trusted code owns env/cwd/timeouts; and **replay is exact**,
  because re-running the same argv IS the replay, so the "repro doesn't match what
  the agent did" failure class cannot occur. `renderReproSh` renders shell for
  humans only and is quote-tested against `; rm -rf /`, `$(id)`, backticks,
  newlines and embedded quotes.
- **Charters carry their own oracle.** "Look for bugs" produces slop;
  "behavior contradicts this cited documented promise" produces evidence.
  Data-driven in `scripts/agent/charters/charters.json` + one `.md` rubric each,
  mirroring `lenses/`. Tier 1 ships `contract` and `crash`, both
  `needsBackend: false` — no docker lifecycle, the single largest source of flake.
- **Clean room.** `buildProbeEnv` **replaces** the environment rather than
  extending it. Spreading `process.env` would let the developer's real
  `~/.wafflebase/session.json` and default workspace leak in, so the clean room
  would be a lie and a mutating probe could act on real documents.
  `TZ`/`LANG`/`LC_ALL`/`NO_COLOR` are pinned for determinism.
- **Replay is the anti-slop gate.** The whole probe sequence re-runs 3× in fresh
  scratches and must agree with itself AND match the claim. Timestamps, generated
  ids and map ordering are the top source of phantom repros; this kills them
  before any model is asked to verify anything.
- **Agreement is OVERLAP, not identity.** Two independent samples describe the same
  defect with overlapping-but-not-identical evidence in arbitrary order, so no hash
  of any identity matches them (see the lessons file — three successive
  identity schemes each returned zero agreements on live data). `sameDefect` tests
  whether the in-scope code-location sets share a `file:line`. Line-level
  deliberately: `packages/cli/src/output/formatter.ts` genuinely holds two distinct defects, and file-level
  matching would collapse them. Same shape of judgement `scripts/agent/rounds.mjs` already makes
  for stall detection.
- **The gate.** `isFilingVerdict` is the ONLY place "report it" is decided, in four
  stages — two owned by trusted code (replay reproduced + deterministic; charter
  conformance) and two checking model output (unanimous high-confidence confirms on
  a named `confirmationGround` with `duplicateOf` unset; enough in-scope
  `file:line` citations). Every branch returns false; there is exactly one path to
  `true`. **A null verdict DROPS**, the inverse of `applyVerifications` — the most
  heavily commented line in the file, because a reviewer skimming for symmetry with
  the panel reads it as a bug.
- **Duplicate suppression, two corpora** (`scripts/agent/hunt-corpus.mjs`). Issues
  are handed over whole — 56 issues with bodies, ~37 KB — so no embeddings and no
  similarity threshold. Deferrals need a DETERMINISTIC digest because
  `docs/design/**` is ~375K tokens: plain section-slicing and grep, scoped to the
  charter's `docsScope`, with no model in the loop. A model summarising the
  deferrals would be one more place for a hallucination to enter the one input
  whose job is to prevent hallucinated findings.
- **Novelty ledger** (`scripts/agent/hunt-fingerprint.mjs`). Exploration is
  unbounded, unlike review. Entries are keyed on the defect, carry
  `LEDGER_KEY_VERSION`, and expire once the code in scope changes so the ledger
  cannot blind the hunter to a regression. Two rules learned live: a corrupt ledger
  is FATAL rather than empty (treating corruption as "nothing seen" re-reports the
  exact noise the ledger exists to suppress), and a candidate the panel never
  JUDGED — a verifier that errored or hit a run limit — is never recorded, or an
  infrastructure blip becomes a permanent blind spot.
- **Local front door** — `.claude/commands/hunt.md` + `node scripts/agent/hunt.mjs
  <preflight|run|report>`. `preflight` returns before the SDK is imported, so it
  reports what is missing without `npm ci`.

Reportable severities are `critical`/`major` only; the rubrics tell the model not
to emit `minor`/`nit` at all, since the gate drops them and emitting them spends
budget for nothing.

**Measured, not estimated** — each run writes a hunt-execution.json artifact shaped
like the review panel's own execution log, so `scripts/agent/metrics.mjs` can sum
tokens and cost over it: one `contract` run at
`samples: 3`, `verifiers: 2` costs **~$6.20** and ~12 minutes, dominated by 3.1M
cache-read tokens billed at 0.1×. Two verified defects (#585 and #586) were filed
from it.

Residual risks:

- **A real finding can die to one dissenting verifier.** Unanimity is the precision
  mechanism, and it cost recall: the same `docs import --replace --dry-run` defect
  was reported in one run and refuted in the next. Hand-verification sided with the
  report. Precision is bought with recall here, deliberately, but the trade is real.
- **Secret leakage is the highest-severity risk.** A `--verbose` probe can echo
  `Authorization: Bearer …`, and the eventual destination is a public repo.
  `redactSecrets` is applied at both the report and the artifact-dump boundaries
  and is unit-tested; it must stay that way before filing is enabled.
- **CLI coverage is a slice.** The CLI does not reach Canvas rendering, CRDT
  collaboration, or frontend interaction — where most currently-open bugs live
  (#494, #343, #333). A Playwright-driven UI hunter reusing the existing
  `verify:frontend:interaction` + Docker Chromium lanes is the natural next surface.

Done criteria for Tier 1 (met): a local run reports at least one defect that a
human independently confirms, with **zero** reports a human judges wrong, and the
funnel explains every dropped candidate.

Not yet built: the rolling GitHub-issue report, autonomous filing behind
`HUNT_FILING_ENABLED` with a mechanical accept-rate kill switch, and the formula
differential oracle. (The `round-trip`/`state` backend charters and the
`WAFFLEBASE_HUNT_WORKSPACE` safety rail shipped — see the backend-tier section
below.)

**The explorer EXECUTES.** The first cut could not: its grant was Read/Grep/Glob and
its prompt said *"you never run commands yourself"*, so it read the source,
predicted a contradiction, and a trusted runner tested the prediction afterwards.
That removed the only reason to target a CLI — a CLI's unique value is being an
executable interface — and made surprise impossible, which is the product.

The propose/execute split survives where it earns its keep. It is correct for
**reporting** (exact replay, no shell injection) and wrong for **exploration**
(blindness is the problem). So exploration now runs through one in-process MCP tool
(`scripts/agent/hunt-tool.mjs`): `argv` arrays only, no shell, `assertSafeArgv` plus
the CLI's own `schema` safety annotations, an environment `buildProbeEnv`
**replaces**, and an enforced probe budget. Verifiers keep the read-only grant —
handing them execution would let a verifier confirm a finding with evidence of its
own making.

Evidence is **cited, not authored**. Every tool call is journalled, and a candidate
names `probeRefs`/`failingRef` — indices into that journal. A model therefore cannot
describe a reproduction it never performed, which a model-authored `probes` array
allowed; `resolveProbeRefs` converts the indices back into the shape the gate,
replay and report already speak, and drops any candidate whose references do not
resolve. The repro is a transcript rather than a claim.

Two grounds exist only because the explorer can now act: `self-inconsistent` (two
paths disagree about the same data) and `schema-annotation-false` (a command
violates its own declared safety level). Both are checkable from a transcript, which
is what stops them collapsing into *"this surprised me"* — the ground deliberately
absent, because it is the slop generator that ended curl's bug bounty.

**Backend tier, and the refusal that gates it.** `round-trip` (metamorphic
identities: import→export, batch ≡ N×set, `--pages` partitions, `--dry-run` mutates
nothing) and `state` (create→delete→list, rename twice, delete twice) are
`needsBackend: true` and `mutating: true`. Their oracles are self-evidencing — a
broken relation needs no written promise — so they set `requiresDocCitation: false`
while still demanding a code citation, or a finding would be unactionable.

Two preconditions run before a token is spent, and they fail differently on purpose.
A missing stack (`checkStack`, `GET /health`, 2s) SKIPS the charter, mirroring the
review panel's treatment of its own missing preconditions. A refused workspace also
skips, but is a configuration error rather than an environmental one. Neither is
silent: the report renders **Charters that did NOT run** immediately after the
funnel, because "found nothing" and "never executed" are otherwise the same zero and
only one of them means the code is fine.

`scripts/agent/hunt-workspace.mjs` is the whole guarantee. `WAFFLEBASE_HUNT_WORKSPACE`
must be set explicitly — there is no default and no inference from the developer's
config, because a workspace a mutating run may destroy has to be something a human
typed. It is refused if it is an obviously-real name, if it equals
`WAFFLEBASE_WORKSPACE`, if it appears anywhere in the resolved config.yaml or
session.json, or if either file exists but cannot be read. Absence of proof is
refusal, since a deleted document does not come back from a reflog. The collision
check is a deliberately crude substring scan honouring `WAFFLEBASE_CONFIG` /
`WAFFLEBASE_SESSION` overrides: parsing YAML would mean a new dependency or a
hand-rolled parser whose bugs are silent, and a missed collision is unrecoverable
while a false one costs one renamed variable.

Asking the CLI for its resolved workspace would be more authoritative and does not
work: `status` ignores `--format json` and prints prose. That is ground-truth defect
\#9 — the one command that would answer the question is one of the things this
hunter exists to find.

Every seeded document is named `hunt-<runId>-<n>`, and `hunt.mjs cleanup --run <id>`
deletes by that exact prefix and nothing else, printing every decision including what
it left alone. `--run` is mandatory so there is no "delete everything that looks like
a fixture" mode to reach by accident, and the run id is in the prefix so concurrent
runs cannot delete each other's fixtures. Docker lifecycle is NOT reimplemented —
`scripts/verify-integration-docker.mjs` owns it, and `preflight` reports what is missing.
### Phase 27: Panel Feedback Corpus

**Principle:** Entropy Management — the panel has been tuned repeatedly with no
record of whether any change helped.

Everything else in the pipeline measures effort
(`scripts/agent/metrics.mjs`), self-agreement (`compareSampleAgreement`), or
process (`scripts/agent/rounds.mjs`). Nothing records **outcomes**. So each of
the panel's tuning decisions — severity thresholds, `samples: 2`, file-class
routing, the novelty gate, unanimity in the verifier — was argued from intuition
and two or three remembered incidents. `scripts/agent/misses.jsonl` is the ledger that
makes those arguments settleable.

**Record shape.** Strict JSONL, one object per line, stable field order (no comment
lines — an unreadable line makes `--append` refuse, so the format cannot document
itself):

```text
schema, id, label, source, pr, handoffAt, evidence{commitSha,commentId,url},
files[], fileClasses[], lens, severity, origin, summary,
panelSaw{reviewedSha,conclusion,blockingFindings}, verifiedBy, notes
```

`label` is `miss` **or** `false-positive`, and both live in one corpus deliberately:
a change that cuts misses by raising more findings must pay for it in false
positives, and a corpus holding only one of the two would score that change as pure
progress. `fileClasses` and `origin` were added to the original plan shape once #582
(file-class routing) and #583 (novelty origins) shipped — they turn "we missed four
bugs" into a sliceable claim about *which* population the panel is weak on.

**`verifiedBy: ""` is the load-bearing field.** `scripts/agent/harvest.mjs`
proposes candidates from two independent signatures; a human confirms. Nothing
may consume a record
until someone has put their name there, and the harvester cannot set it even by
accident (`toMissRecord` defaults it and neither harvest path passes it). An
auto-harvested, auto-trusted corpus is a corpus of noise, and harvester noise is
*systematic* — it follows whatever the matcher over-fires on — so it would move the
panel somewhere specific and wrong rather than nowhere.

**Two signatures**, both from data GitHub already keeps:

1. **Human commits after handoff.** `scripts/agent/mark-ready.mjs` posts
   `HANDOFF_MARKER` when the panel approves. A human editing *reviewable code*
   after that instant is the shape of a missed defect. The marker constant moved
   into `scripts/agent/disclosure.mjs` because it is now a contract between two
   modules, and `scripts/agent/mark-ready.mjs` runs its CLI at import time so
   nothing can import a constant from it.
2. **CodeRabbit findings the panel did not raise**, at blocking severity only —
   this corpus measures the *gate*, and a minor maintainability note is not a gate
   failure.

**Two lists that must not be one.** `interestingFiles` restricts candidates to the
`code` / `code-adjacent` classes via `classifyFile`, so the harvester's notion of
reviewable code cannot drift from the panel's own routing table. `policy` is
excluded even though `.github/**` and `scripts/agent/lenses/*.md` land there: a
human editing those is changing the **reviewer**, which is a different event from
the reviewer missing a bug, and mixing the two populations corrupts the one number
this corpus produces.

**Never feed `misses.jsonl` to a lens.** Not as few-shot examples, not as "past
misses to watch for". Three independent reasons, any one sufficient: it biases
lenses toward historical bug shapes when the next defect is by definition new; it
re-grows the prompt incremental review exists to shrink; and it is a verbatim
archive of **attacker-influenceable text** (CodeRabbit bodies, contributor commit
messages). If it ever must reach a model it goes in fenced as DATA, exactly like
the diff.

**Fail directions, opposite by design.** Every read path degrades to fewer
candidates and never throws — a GitHub hiccup costs this run's proposals, not the
corpus. The single write path (`--append`) refuses on any doubt: one unparseable
line means we do not know every id already in the file, so appending could
duplicate a curated record, and a duplicate double-counts in every later tally,
silently and permanently. `dedupeById` keeps the **first** occurrence for the same
reason — existing records are passed ahead of fresh candidates so a re-harvest can
never blank a human's `verifiedBy`.

Seeded with #548's two documented misses: the CodeRabbit `EditorAPI.paste()`
read-only bypass (Major, `correctness`, all four lenses green on that sha), and the
`test-adequacy` flip — `success` at `ab952c9`, `failure` with one major at
`ffeb1d2`, where the only diff between the two commits is +16 lines in
`docs/design/sharing.md`. No test or source file changed, so a lens found a real
defect on one run of byte-identical content and missed it on another. That single
record is the strongest evidence yet against dropping to `samples: 1`.

Done criteria: the plan's panel-quality bar (0 proven false negatives across the
corpus, `critical` demonstrably in use, ≤ 2 rounds to converge) becomes
*measurable*. Not yet built: a `harvest --report` roll-up, scheduled harvesting,
and the paired shadow-mode comparison Phase 9's merge-eligibility line feeds.

### Phase 28: Structured Rebuttal + Independent Adjudicator

**Principle:** Mechanical Enforcement — the author may *claim*, only the trusted
path may *decide*.

**The gap, demonstrated live on #564.** The fixer prompt has always said "if you
believe a finding is wrong, reply in the PR thread with your reasoning" — and
nothing consumed that reply. `scripts/agent/review-panel.mjs` receives the diff,
the changed files, the issue spec and the prior findings; it never received a word
the author wrote. On #564 the fixer posted a correct, evidenced rebuttal (the App
cannot push `.github/workflows/**`, with the literal push error) at 06:46. The
07:05 panel never saw it and re-raised the same finding, twice more.

**The channel.** The fixer posts a structured record as a hidden PR comment
(`<!-- agent-rebuttal … -->`), mirroring the metrics ledger — it holds
`issues:write`, so this is a channel it can actually use, and author-writability
is fine because a rebuttal is only a claim. `scripts/agent/rebuttal.mjs post`
writes it, so the format cannot drift from the parser: a model hand-writing JSON
inside an HTML comment fails in a way that looks exactly like agreement.

**The decision.** The panel job (trusted, `ref: main`) reads rebuttals as
untrusted data, fenced like the diff, and runs an **adjudicator** subagent per
disputed finding — fresh context, not the fixer, not the lens that raised it.
`isOverturningVerdict` is the mirror of `isDroppingVerdict`: an explicit
`overturned`, `high` confidence, an enumerated ground, and at least one
`file.ext:line` the adjudicator actually read. Anything less upholds.

**Persuasion must never be a bypass**, and the fail direction is asymmetric in
four places to make that structural rather than hoped-for: an unparseable
rebuttal is ignored, an *ambiguous* match is refused (a rebuttal that fits two
findings equally well names neither), an errored session upholds, and an
ungrounded verdict upholds. A rebuttal can only ever lose.

**Undeliverable is not wrong.** There is deliberately no overturn ground for "I
cannot make this change" — #564's rebuttal was *true* and the finding was still
correct and still needed doing, by a human. Such a rebuttal is upheld, re-raised,
rebutted again, and pages at two. An overturn ground for inability would let a PR
merge with the work declared impossible.

**Bounded.** A finding disputed `MAX_REBUTTAL_ROUNDS` (2) times and upheld both
times pages a human, checked in `scripts/agent/review-round-guard.mjs` *before* convergence
because it is the more specific reason. The counter also catches the shape the
plan did not name — overturned in one round, re-raised the next, disputed again —
because both mean the loop cannot settle the question by itself.

The count travels on the finding through the check run's `output.text`, the
**unforgeable** channel, not through the author's own comments. Paging is the safe
direction, so a forged count would only summon an unnecessary human — but a bound
the disputing party can move is not a bound.

Inert by default: `--rebuttals` absent means an empty list, which short-circuits
before any session opens, so a panel invoked without it is the panel that existed
before this.

The adjudication outcome is no longer check-body-only:
`scripts/agent/severity.mjs`'s
`adjudicationNote` is exported and rendered by `scripts/agent/review-comment.mjs`
too, so a dispute's decision — and the adjudicator's reason — appears in the
on-demand comment and in the per-round panel comment, the two places a
maintainer actually reads findings. A carried-forward `{ upheld: N }` with no
verdict still renders nothing: that shape is history, not this round's decision.

**Silence about disputes is now itself reported.** No rebuttal has ever been
filed on an agent PR, and until this was addressed that fact was
indistinguishable from a channel that had quietly broken. Three surfaces close
it: the fix report always renders `Disputed (N)` — `_Nothing._` at zero, the
same treatment `Skipped (0)` already had; the loop-status table's `Fixer` column
carries a per-round `N disputed`; and `scripts/agent/rebuttal.mjs`'s post-failure path, which
exits 0 by design because a dispute that cannot be posted leaves the finding
standing, now emits a best-effort warning naming that consequence instead of
vanishing. The count in the report is rendered and never serialized — the hidden
record is the fixer's claim about its own work, while the count is derived from
other comments at post time, and a second stale copy is worth nothing.

Not yet built: an adjudication record in the metrics comment, and any measurement
of how often a rebuttal is *right* — which is a `misses.jsonl` question, since an
overturn that should not have happened is a false negative like any other.

#### The loop shipped inert, and stayed inert until the lens was stamped

`findingSimilarity` returns 0 unless both sides agree on `lens`, and it is the gate
`matchRebuttal` scores through. But `lens` is not in the `FINDING` schema — a lens
is never asked for it — and nothing in `scripts/agent/review-panel.mjs` assigned
one. Prior findings do carry it (`tagPriorFindings` stamps it from the check-run
name), and when a fresh finding merges with its carried-forward twin the FRESH
representative is the one that survives. So the lens was lost in exactly the case
that matters, and the outcome inverted the intent:

| round N+1 state | matched | adjudicator |
| --- | --- | --- |
| fresh pass re-found it (± carry-forward) | 0 | never called |
| carry-forward only (fresh pass missed it) | 1 | called |

Only the second row worked, and it is the one the loop was not built for: a
rebutted finding means the author did *not* change the code, so the next round's
fresh pass almost always re-finds it.

It went unnoticed because the channel was never exercised. No structured rebuttal
has ever been filed on any PR (#564, #605, #632, #633, #648, #649, #657, #666 all
have none) — and a second defect explains part of that: `scripts/agent/rebuttal.mjs`
landed with this phase, so branches cut before it (#632, #648 among them) do not
contain the CLI their fixer prompt tells them to run. Both fail safe — the finding
stands — which is why nothing observable ever went wrong.

Activating it also made three latent weaknesses in the channel real, none of which
mattered while nothing was adjudicated:

- **The channel was unauthenticated.** `readRebuttals` pages every comment on the
  PR, and on a public repo that includes any drive-by commenter's. Now gated to the
  fix agent's identity — `user.type === "Bot"` **and** the login, because other apps
  comment here (CodeRabbit reviews this very file, and a review quoting the marker
  format could otherwise parse as a record). A `[bot]` login cannot be registered by
  an ordinary account, so the pair is unforgeable from outside. Grounding still
  blocks the overturn; this stops persuasion getting a turn.
- **The FINDING fields were not fence-neutralised**, only the dispute was. They are
  a previous round's model output derived from the diff, and they render *before*
  the fence opens — so an injected `<author-rebuttal>…</author-rebuttal>` would have
  placed a complete fake dispute ahead of the real one.
- **The per-lens partition was implicit**, inherited from `findingSimilarity`'s lens
  gate. `adjudicateRebuttals` now filters by `lensId` itself, so "a lens adjudicates
  only its own disputes" is a property of that function rather than an invariant its
  caller has to maintain.

`stampLens` fills the blank. It is a named export rather than an inline `.map` for
a testing reason worth recording: as an expression, a test could only restate it,
and a restated copy passes just as happily with the real call deleted — which is
exactly what the first draft of these tests did. It OVERWRITES rather than filling blanks —
`lens` last, the same rule prior-findings.mjs states for the same reason: a finding
must not be able to declare its own origin, and a fresh finding is model output
too. It stamps `merged` rather than the gating subset because the round loop then
removes overturned findings from that same array by object IDENTITY, so stamping at
the gating step would leave every overturned finding un-removable from the summary. A source-level test asserts the
round loop actually routes `merged` through it, since that loop lives in `main()`
and no unit test can reach it.

#### The bound was still inert: the count died in the round that computed it

Stamping the lens made disputes *match*; it did not make the counter *persist*.
An upheld finding is RE-CREATED (`{...f, adjudication}`) by `adjudicateRebuttals`
and `applySkipClaims` in `scripts/agent/review-panel.mjs`, and those copies lived
only in `gating` — what the check's conclusion is computed from — while
`writeVerdict` persisted `merged`'s pre-adjudication originals into verdict.json.
verdict.json is where the panel workflow reads `adjudication.upheld` into the
check run's `output.text`, and `output.text` is the unforgeable channel both the
next round's carry-forward and the round guard's `exhaustedFindings` count from.
So the increment died in the same round that computed it: every round re-derived
`upheldCount(prior) + 1` from a prior count of 0, the counter could never reach
`MAX_REBUTTAL_ROUNDS`, the standstill page could never fire, and a finding could
be re-disputed forever — bounded only by the round cap, which pages with a far
less specific message than the one this bound exists to send.

`substituteAdjudicated` closes it: the adjudicated copies replace their originals
in what `writeVerdict` persists, paired back by object identity
(`applySkipClaims` is a positional map; `adjudicateRebuttals` returns its
re-creations as `replaced` pairs). Mapping copies back to originals also fixed a
latent half of the same bug — a finding that was skip-claimed and *then*
overturned appeared in `dropped` as the skip copy, which the old identity filter
over `merged` could never remove.

Persisting the count exposed two more places the same integer silently died on
the way into round N+1, both in the merge:

- **`mergeCluster` dropped `adjudication` from folded wordings**, while the
  workflow comment above the `output.text` builder already claimed the opposite
  ("carried on folded wordings too … see upheldCount"). A rebutted finding means
  the code did not change, so the next fresh pass almost always re-finds it — and
  the fresh representative wins the cluster slot, so the carried count had to
  survive in `mergedFrom`, where `upheldCount` takes the cluster max. It now does,
  integer only, exactly as the workflow trims it.
- **`dedupeFindings` handed a byte-identical collision to the fresh copy** and
  discarded the carried one's count with it. The winner now absorbs the loser's
  higher `upheld` (`absorbUpheld`), so the counter is carried by the collision,
  never decided by it — a dedup that can zero the rebuttal counter is a bound the
  merge order gets to move.

This is a BEHAVIOUR change, not a refactor: the standstill page in
`scripts/agent/review-round-guard.mjs` becomes reachable for the first time. A
finding disputed and upheld in two rounds now pages a human instead of buying a
third adjudication session, which is the destination Phase 28 specified for a
question the loop cannot settle. An end-to-end two-round test in
`scripts/agent/review-panel.test.mjs` drives the real wiring — merge, gate,
adjudicate, substitute, carry forward — and asserts `upheldCount` reaches 2
through both merge paths, alongside a source-level test that the round loop
routes `writeVerdict`'s input through `substituteAdjudicated` at all.

### Phase 29: Lint the agent control plane

**Principle:** Mechanical Enforcement — the cheapest check that could have caught it.

`verify:fast` lints `packages/frontend` and nothing else, so `scripts/**` — the
~30 modules that decide whether a PR may merge — had **no static analysis at
all**. The only thing between a typo and `main` was `node --test`, and only over
paths a test happens to reach.

#657 shipped `retryAt`, an undeclared identifier on the round-cap page path,
straight through green CI: no test exercises that page, so the guard would have
thrown a `ReferenceError` exactly when it was supposed to latch a PR. The review
panel caught it, which is the expensive way to catch a typo.

`eslint.config.mjs` at the repo root, scoped to `scripts/**/*.mjs`, wired into
`verify:fast` so it fails in about a second rather than after the build chain.
Three notes on the shape:

- **`js.configs.recommended`, not a hand-picked rule list.** The whole directory
  produced ten violations against the full baseline — eight dead bindings, two
  redundant regex escapes — all fixed in the same commit. A curated subset has to
  justify each omission, and the omissions are where the next silent bug lives.
- **Rooted at the top level, not in `scripts/agent/`.** That directory is an
  npm-managed island whose tree is `npm ci`'d and uploaded as an artifact on every
  panel run; adding a linter to it would bloat that artifact for a check that never
  runs there.
- **`eslint`, `@eslint/js` and `globals` are root devDependencies**, not borrowed
  from `packages/frontend` by pnpm hoisting. Hoisting is not a contract, and the
  failure mode of losing it is this lint silently not running — the exact shape of
  the gap it closes.

The config is itself under test (`scripts/agent/lint-config.test.mjs`). That is not
belt-and-braces: the first version spread `js.configs.recommended` and then set
`rules`, which **replaced** the recommended set and left `no-undef` disabled.
`eslint scripts` still exited 0. A config that lints nothing reports success, so
the tests assert on the resolved rule set — `no-undef` is `error`, and every
upstream recommended rule survives the local override.
### A re-run does not emit `workflow_run: requested`

`requested` fires when a workflow run is **created**. A re-run reuses the run id, so
it emits only `completed` — and `@claude rerun`'s last act is `reRunWorkflow` on the
PR's CI run.

So from the moment the panel's trigger became `requested`-only, `@claude rerun`
re-ran CI and re-engaged **nothing**, while still reporting *"Re-running CI now; the
review panel will run again"*. Observed on #632 and #648: CI genuinely re-ran
(`run_started_at` 06:01, success at 06:15) and no panel run was created, while
`.github/workflows/agent-iterate-ci.yml` — which listens to `completed` — fired for
both. The command's mechanism had been silently uncoupled from the trigger it
depends on.

The panel now subscribes to `[requested, completed]`, and the `gate` job admits
`completed` **only when `run_attempt > 1`**:

| event | attempt | admitted | why |
|---|---|---|---|
| `requested` | 1 | yes | fresh CI — the parallel-start path |
| `completed` | 1 | **no** | `requested` already started this round |
| `completed` | 2+ | yes | a re-run, where `requested` never fires |

That keeps one panel per CI run, so subscribing to both does not double the ~$12
round.

**The concurrency group has to be partitioned to match, and getting this wrong
disables the panel entirely.** `concurrency` is claimed at the workflow level — at
RUN CREATION, before any job's `if:` is evaluated. With one undifferentiated group,
a fresh CI run's `completed` event creates a second run that cancels the panel the
`requested` event started ~13 minutes earlier, **mid-review**; the second run then
refuses the event and skips every job. No verdicts recorded, and `stalled` is
`!cancelled()`, so no page either. The panel takes ~14 min against CI's ~13, so the
collision is near-certain rather than occasional. A job-level `if:` cannot protect a
group that was already claimed on its behalf.

So the group carries a suffix: runs that will be refused (`completed` on attempt 1)
land in a `noop` lane where cancelling each other costs nothing, and every run that
will actually review shares `active` — which preserves what the guard exists for
(#605's two same-second contradictory verdicts, #648's two fixers on one branch).
The partition and the gate's admission rule are written separately and must agree,
so `scripts/agent/checks.test.mjs` evaluates both across all four event/attempt
combinations and fails if they diverge, including a check that the partition is not
degenerate — a group that always answered `active` would pass a same-answer test
while restoring the bug.

The `ci` job's `decide()` returns `proceed` immediately for an already-completed
successful run, so the `completed`-triggered path does not sit waiting for a
conclusion it already has.

**A trigger is part of a command's contract.** `@claude rerun` re-runs CI *in order
to* fire the panel; narrowing what the panel listens to broke the command without
touching it, and nothing failed — the rerun reported success both times.

### Label writes on a PR need `pull-requests: write`

Not `issues: write`. A pull request is an issue for most of the API — its
**comments** are reachable with `issues: write` — but its **labels** are not, and
the mismatch produced two silent failures that looked like success:

- **`@claude rerun` announced dropping `agent:blocked` and did not.** The job held
  `pull-requests: read`, so `deleteComment` succeeded ("cleared 1 paged marker(s)")
  and `removeLabel` failed with `Resource not accessible by integration` — while the
  summary claimed the drop unconditionally. Observed on #632 and #648: both said
  they had dropped the label, and both stayed blocked.
- **`agent:reviewing` has never existed.** The `review-panel` job had the same
  `pull-requests: read`, and `scripts/agent/set-state.mjs` is fail-safe (any API
  error logs and exits 0), so the "Set state → reviewing" step reported success from
  the day it was written. #648, #632, #605 and #633 all show
  implementing → fixing → blocked with no reviewing state in between.

Both are fixed by the grant. Two things generalise:

**Fail-safe writes need their outcome reported.** `scripts/agent/set-state.mjs` exiting 0 on error
is the right call for a label that gates nothing — it must never fail the pipeline —
but it means a broken grant is indistinguishable from a working one. The rerun
summary now reports which of *dropped* / *was not set* / *could not drop* actually
happened, rather than asserting the happy path.

**Jobs that write labels with the default `GITHUB_TOKEN` are enumerable**, and were
enumerated: `iterate` inherits the grant workflow-level, `fix` and `stalled` declare
it, and the two above were the only gaps. `agent-implement`'s label write is not in
this class — it happens inside the agent's prompt using the App token, whose
installation permissions the workflow block does not govern.

### Phase 30: `@claude fix` — the on-demand fix agent

**The gap.** The fixer only ever ran on the loop's terms: inside
`MAX_REVIEW_ROUNDS`, only after a fresh panel round, and never once the loop had
paged. A maintainer reading a standing verdict had no way to say "address these
now" — the closest thing was `@claude rerun`, which restarts the whole cycle
(~13 minutes of CI, then a full panel) to reach a fixer that already had
everything it needed. `@claude fix` is that missing handle: one attempt,
immediately, against the verdict as it stands.

**The precondition is one question, not two.** The rule is "a previous panel run,
and no commit after it". `scripts/agent/fix-eligible.mjs` decides it by asking
whether the CURRENT head sha carries completed `agent-review-*` check runs from
`github-actions`. A commit MOVES the head, so a verdict attested against the head
is simultaneously proof that the panel ran and proof that nothing has landed
since. Deliberately no timestamp comparison: "panel at T, commit at T+1" would
depend on two clocks and on commit dates, which the author controls
(`git commit --date`). The gate fails toward INELIGIBLE in every branch — an API
error, an unreadable check list, an unknown head all refuse, because this
authorises a bot to push to someone's branch.

It does *not* check the paged latch. A PR the loop gave up on is the main reason
to reach for this verb, so `@claude fix` runs on a paged PR and leaves the latch
in place: the loop stays parked and the next panel round does not silently
re-engage the auto-fixer. `@claude rerun` remains the verb that clears it.

**The report, and why it goes to the adjudicator.** After fixing, the agent files
a structured report (`scripts/agent/fix-report.mjs`) — one `--fixed` or
`--skipped` per checklist item, in a hidden payload under a human-readable table.
The next panel round reads it and folds each claim into the EXISTING adjudication
pass (Phase 28) rather than into the verifier. That placement is the whole design:
`adjudicateFinding` states that the verifier path is the one path in the panel
that has never been handed author-written text, and a report is author-written
text. So it goes to the component built to receive it.

This depends on the lens actually being stamped on a finding, which it was not
until the fix split out into its own PR — see the Phase 28 note on the loop
shipping inert. Without it `findingSimilarity` scores every claim 0 and nothing
here matches anything.

The asymmetry between the two statuses is the safety property:

- `fixed` maps onto the real overturn ground `not-present` — the defect is
  genuinely gone. The adjudicator still has to read the code and cite locations,
  so a false "I fixed it" is upheld and the finding stands.
- `skipped` maps onto **nothing**. `OVERTURN_GROUNDS` has no entry for "I did not
  do it", by design (Phase 28: *undeliverable is not wrong*), so a skipped item is
  upheld — and skipping the same finding twice trips `upheldTwice` and pages a
  human, which is the right destination for a question the loop cannot settle. It
  is upheld WITHOUT an adjudicator session: no enumerated ground could ever apply,
  so a 20-turn Opus run could only reach the answer already known.
  `applySkipClaims` writes the increment directly. The author controls only whether
  a claim exists, and its effect is to move the finding TOWARD the paging bound.

Three collisions had to be resolved before that worked, and each failed silently:

- **A rebuttal and a report about the same finding tied.** Both prompts require an
  item per checklist entry *and* a rebuttal for a finding believed wrong, so a
  disputed finding always produced two records with identical lens/file/summary —
  and `matchRebuttal` refuses a tie. The grounded rebuttal was therefore never
  adjudicated for exactly the findings the channel exists to serve, and
  `adjudication.upheld` never passed 1, so `upheldTwice` could never fire. A
  rebuttal now outranks a report about the same finding.
- **Two rounds' reports tied the same way**, which is the other half of the same
  page never firing. Only the LATEST report counts now — which is also the honest
  semantic, since a report describes what one run did to the findings standing at
  that moment. It removes a second bug too: `readFixReports` has no round filter,
  so round 1's "I FIXED this" was being replayed to round 5's adjudicator as a
  claim about a tree it never saw.
- **Cost.** A report covers the whole checklist by construction, so uncapped this
  bought one 20-turn session per still-gating finding, inside the panel job's
  45-minute timeout — on a #648-shaped PR, nine extra sequential sessions per
  round, with `close-stuck-checks` marking every lens failed if the job were
  killed. `MAX_FIX_ADJUDICATIONS = 5` caps it; the overflow is upheld
  session-free like a skip, and the count is logged rather than silently dropped.

"This finding is wrong" remains a different claim with a different channel: a
rebuttal, which an adjudicator decides on enumerated grounds. Both fixers — the
loop's and the on-demand one — are told the difference in their prompt.

**A separate effort comment, and what it is really for.** `metrics.mjs effort`
posts one standalone comment per fix run under its own marker
(`<!-- agent-fix-effort -->`), which matches neither `METRIC_PREFIX` nor
`SUMMARY_MARKER`, so `summarize`'s sweep and repost cannot touch it. The session
is also recorded into the PR-wide ledger as a `review-fix` record, so the total
stays right.

Success is decided by `classifyFixResult`, not `classifyResult` alone. That
function was written for Agent SDK sessions and requires `structured_output`,
which a claude-code-action transcript never carries — handing it one made every
*successful* fix run report `failed (no-output) — subtype=success. Not retryable;
a human should take a look.` It is now used only for the failure taxonomy, which
is the part it gets right and the part worth reusing.

It reports the OUTCOME, not just the spend, and that is most of the value. Both
`@claude rerun` attempts on #632 and #648 failed with:

```json
{ "subtype": "success", "is_error": true, "api_error_status": 429,
  "terminal_reason": "api_error", "num_turns": 1,
  "result": "You've hit your session limit · resets 12:10pm (UTC)" }
```

An account quota window, 18 seconds, no work done. From outside it is
indistinguishable from a cheap successful round, and the pipeline's only signal
was the generic "the fixer agent failed and the branch head is unchanged" page —
which sends a maintainer looking for a code defect. The comment now names it, and
distinguishes the three cases that need different responses: a **session limit**
(wait for the reset, then re-run), a **turn ceiling** (re-running as-is hits it
again), and a **transient** (retry now).

**One behavioural change, deliberately.** The inline version always emitted
outputs, so a round with zero failing lens checks handed the fixer an empty work
list, spent an agent run on nothing, and then paged from "the fix produced no
commit". `scripts/agent/fix-brief.mjs` exits non-zero instead, which fails the
`fix` job and pages through the `stalled` net — same destination, one agent run
cheaper, and the run log says why. The other zero-finding case is unchanged: when
failing lenses exist but none of their `output.text` parses, the checklist is
still the honest "(no per-file findings parsed…)" pointer and the lens bodies are
passed UNCUT, because cutting them there would leave the fixer with nothing at
all.

**One brief, one builder.** The fixer's work list came from ~100 lines of inline
`github-script` in `.github/workflows/agent-review-panel.yml`. It is now
`scripts/agent/fix-brief.mjs`, shared by both workflows — the same lesson
`scripts/agent/prior-findings.mjs` records, applied to a *prompt* input: a second copy is how
one of them keeps handing the fixer 39 minor findings after the other stopped.
Extracting it also put its two bounds (40 items / 16k chars) and the
`proseOnly` cut under test, and replaced `core.setOutput`'s implicit random
delimiter with an explicit one — the value is previous-round model output, so a
guessable `$GITHUB_OUTPUT` delimiter would let a finding append step outputs of
its own.

**The channel needs the same author gate as a rebuttal, and more so.**
`readFixReports` pages every comment on the PR, so on a public repo an
unauthenticated marker comment reaches the adjudicator — and one report carries up
to 80 items where one rebuttal carries a single claim, with every `fixed` item
framed as "verify whether the defect is gone". `fromRebuttalAuthor` is reused
rather than re-derived: both channels have exactly one legitimate writer, the fix
agent, and two copies of "who may write" is how one of them ends up wrong.

**Two hazards from putting verbatim finding text in a hidden payload.**
`scripts/agent/metrics.mjs` can state that its records never contain the
space-then-`-->` terminator its parser splits on, because it serialises
machine-generated fields. Every field in a fix
report is model text copied verbatim from a finding, and this repo's findings
quote its own HTML markers constantly. `JSON.stringify` does not escape `-->`, the
parser's non-greedy match stopped at the first one, the round-trip guard then
refused — and the CLI posted *nothing at all*, losing every other item in the
report. The payload now escapes the terminator as `-\u002d>`, which `JSON.parse`
restores byte-for-byte. The visible prose separately neutralises the module's own
marker, which would otherwise be matched ahead of the real record sitting below it.

**Trust boundary.** Everything that DECIDES (eligibility) or composes the agent's
PROMPT (the brief) runs from the trusted `main` checkout, before the PR branch is
checked out over it — a branch must not be able to choose whether it gets fixed or
what the fixer is told to do. Author-side acts (posting the report, recording
effort) run from the branch afterwards, the asymmetry `scripts/agent/rebuttal.mjs` documents:
writing a claim is an author-side act, and a tampered copy could only produce a
differently-worded claim that still has to be grounded.

**Not yet built.** The panel's rendered summary does not surface "N findings the
author reported as skipped" — the fix agent's own comment is the human-visible
record, sitting in the same thread. And `MAX_REVIEW_ROUNDS` still counts only
autonomous rounds; an on-demand fix is deliberately outside that budget, which is
the point of the verb but does mean a maintainer can spend past it by hand.

### The fixer's push cancels the job it is still reporting from

The autonomous fixer posts its own report, and for a while it posted it *after*
pushing. That ordering loses the report, because the push is what ends the job:
it re-triggers CI, CI re-triggers the review panel, and
`.github/workflows/agent-review-panel.yml` is `cancel-in-progress` — so the fresh
panel run cancels the run the fixer is still inside, about half a minute later.

#757 measured it. The fixer pushed on all three rounds and reported on one:

| round | commit | fix job cancelled | report |
|---|---|---|---|
| 1 | 07:54:45 | 07:55:19 (+34s) | lost |
| 2 | 08:47:14 | 08:47:48 (+34s) | posted 08:47:41, 7s of margin |
| 3 | 09:32:58 | 09:33:29 (+31s) | lost |

Nothing was broken and nothing had to be retried — the fixer was simply racing a
cancellation it caused itself, and won once. This is the same shape as the
dispatch-record window (above): work done in the seconds after a push is not
reliably delivered, so the fix is ordering rather than machinery. **Commit,
report, then push.** Nothing can cancel work that happened before the push that
causes the cancellation, and `scripts/agent/fix-report.mjs`'s `--head` is the SHA the fixer
acted *on*, so the report is already complete before the new commit exists.

`scripts/agent/fix-report.test.mjs` pins the ordering in the prompt — both the report and any
rebuttal must precede the push instruction, and the prompt must SAY so rather
than merely be arranged that way, because the agent reads prose and "THEN REPORT"
sitting above a push section reads as "report last".

`.github/workflows/agent-fix.yml` (the on-demand `@claude fix`) is not exposed:
it declares no workflow-level concurrency, so the panel run its push triggers
cancels nothing, and its prompt already ordered the report first.

### The metrics sweep deleted other people's comments

`metrics.mjs summarize` posts the effort summary fresh each round and deletes the
previous one. Both of its cleanup loops selected by `body.includes(marker)` over
EVERY comment on the PR — so any comment containing the literal
`<!-- agent-metrics-summary -->` or `<!-- agent-metric …-->` was removed, whoever
wrote it and whatever it was.

Observed on #681, a PR about pipeline observability. The on-demand review's own
findings comment named `<!-- agent-metrics-summary -->` while enumerating the
harness's comment surfaces; `summarize` runs in the same job four seconds later and
deleted the review. Every job and step reported success, and `safeDeleteComment` is
best-effort by design, so nothing failed and nothing logged it — the comment simply
was not there. It looked like `@claude review` had produced only an effort comment.

The exposure was general, not specific to the panel: CodeRabbit reviewing
`scripts/agent/metrics.mjs` quotes markers as a matter of course, a maintainer can
paste one, and the `--final` branch swept `METRIC_PREFIX` on a bare `includes` with
no parse at all. Any PR that touches or discusses this module was affected, on
every summarize — which runs in the on-demand review, promote, and fix.

`isOwnComment` replaces both tests with two cheap conditions. POSITION: both
`renderSummary` and `serializeRecord` emit the marker as the body's first
characters, while a quotation is prose *about* a marker and appears mid-sentence —
this alone fixes it. AUTHOR: every writer here posts through a token, so ours are
always a Bot, and `user.type` is set by GitHub rather than chosen by the commenter.
It fails toward KEEPING: a stale summary costs a duplicate, while deleting the
wrong comment destroys work with no record that it happened.
### `author_association` is not a permission

`@claude rerun` moves the fix-round floor forward, and the guard decided whose
rerun counted with `author_association`. On #648 a maintainer with **Maintain**
ran it four times and GitHub reported every one of those comments as
`CONTRIBUTOR` — association describes the commenter's relationship to the PR
thread, not their access, and it reads `CONTRIBUTOR` for anyone with commits on
the repo whose org membership is not public. So the floor was never set, the guard
counted the PR's entire history, and it paged with *"tried 3 time(s) (limit 3)"*
against a rerun that had reset nothing. The absent `since the last rerun` clause in
that page is the tell.

The verb itself worked. `.github/workflows/agent-rerun.yml` gates on `getCollaboratorPermissionLevel`
— authoritative — so the label came off and CI re-ran, while the budget silently
did not move. **Two checks for one question, disagreeing**: the command's
permission to run, and the command's effect, resolved by different authorities.
That is the same shape as the `agent:blocked` label bug — the action reports
success and the consequence is dropped.

`scripts/agent/rounds.mjs` had named this gap, but in the opposite direction: it worried about
being too *permissive* (an org MEMBER without write passing). The failure that
happened was too strict. Both directions are real, and both are fixed below —
the strict one is what paged #648, the permissive one would have handed the
bounded party extra rounds on a rerun the workflow refused.

`permissionResolver` in `scripts/agent/gh-checks.mjs` closes it — an injected
`(login) => true | false | null` built from the same API the workflows use, so
`scripts/agent/rounds.mjs` stays pure and testable.

**The resolver is the only authority.** When one is supplied, `isRerunCommand`
does not consult `author_association` at all. Association is *not* a fast-path
accept, and it must not be: `MEMBER` is membership of the owning **org**, which
says nothing about permission on this repo, and `COLLABORATOR` is satisfied by a
read- or triage-only invite. Accepting either would move the floor for a
commenter `.github/workflows/agent-rerun.yml` then refuses to run — the same two-authorities-
disagreeing bug in the opposite direction, granting budget for a rerun that never
happened. That is the gap `scripts/agent/rounds.mjs` had named and left open; it is closed now,
in both directions. Lookups memoize per login, failures included, so a PR with
many comments from few people costs at most one call each — and only for comments
that already parsed as `rerun` from a non-Bot.

The resolver-less form survives as the pure, association-only legacy behaviour.
Its only caller is `scripts/agent/loop-status.mjs`, which is a **projection, never a gate**: at
worst it displays a round count the guard will not honour. Every *gating* caller
injects a resolver.

Fail direction: an unresolvable login does **not** set the floor. Not resetting
leaves the PR paged for a human, which is where one the loop cannot finish
belongs; resetting on a failed lookup would hand more attempts to the very party
the budget bounds. The bot exclusion is still checked first and no resolver can
override it — that is what stops the bounded party resetting its own bound.

Still on association, deliberately: `isPagedLatchComment`'s human arm. It fails
toward *reviewing*, so a maintainer's hand-written latch being ignored costs a
review round rather than stopping one, and its literal copy in
`.github/workflows/agent-review-panel.yml` (that job does no checkout, so it cannot import) would
have to make an API call too. Recorded as a known, benign instance of the same
signal.

### Phase 31: UI Issue Hunting

Phase 26's own residual-risk list names the ceiling this addresses: the CLI reaches
neither Canvas rendering, CRDT collaboration, nor frontend interaction, which is where
most open UI bugs live. This is the Playwright hunter that section called "the natural
next surface", and it reuses Phase 26's precision apparatus wholesale — inverted gate,
3x replay, adversarial verifier panel, novelty ledger. **Only the probe layer and the
prediction protocol are new.**

**The sensor is a bridge, not the accessibility tree.** Sheets, docs and slides render to
Canvas, so the a11y tree covers the React chrome and essentially nothing where the
content is. `window.__WB_HUNT__` on the DEV-only `/harness/hunt` route answers a CLOSED
registry of named readers instead — `doc.text`, `doc.runs`, `doc.fontSizes`,
`sheet.cellValue`, `sheet.cellCenter`, `doc.canUndo`, `sheet.canUndo` — over
`MemStore`/`MemDocStore`, with
the real `DocsFormattingToolbar` mounted. No backend, no login, no cleanup risk. A
registry rather than an `evaluate(<model JS>)` hook, so the reachable surface is bounded
by reviewed code; membership is an own-property test, because a plain object literal
resolves `readers["toString"]` through the prototype chain and would have invoked it.

**The driver is a subprocess.** `playwright` resolves from `packages/frontend` and NOT
from `scripts/agent` (separate installs), and duplicating it would duplicate the version
`scripts/run-browser-tests-docker.sh` pins against `Dockerfile.playwright`. Spawning
`packages/frontend/scripts/hunt-ui-runner.mjs` also keeps the async browser behind a
synchronous call, so `scripts/agent/hunt-probe.mjs`'s `replay()` is reused unchanged.

**Free oracles first, run after every action at zero model cost:** `pageerror`,
`console-error`, `network-fail`, and Crawljax/ATUSA-style DOM invariants (duplicate ids,
dangling ARIA references, `undefined`/`NaN`/`[object Object]` in the chrome). Two scoping
rules keep them from reporting the harness: request failures and browser-generated
console errors about them are ignored for non-app origins, since Tier 1 has no backend by
construction; and the placeholder-text scan excludes the editor host, because a user's
document may legitimately contain the word "undefined". `verify:hunt:oracles` proves each
one fires on an injected fault and stays quiet on the two negative controls — a detector
that silently stops firing is invisible, because a clean run and a dead detector produce
the same empty report.

**The prediction protocol is where a mismatch stops being an opinion.** The oracles only
catch defects that announce themselves; most real UI bugs do not. So the agent commits to
an expectation — a NAMED READER plus a COMPARISON from a six-operator closed set, never
prose — submitted WITH the action, with the runner performing the read in the same
round-trip so the caller cannot look before committing. Trusted code renders the verdict.
There is deliberately no regex operator: a model-supplied pattern is code this process
would execute.

Four grounds, each MECHANICALLY checked rather than trusted:

| ground | claim | what the process verifies |
|---|---|---|
| A | the app contradicts itself | `value` must be an `@read:`/`@input:` reference to a SUCCESSFUL, STRICTLY EARLIER journal entry, and a `@read:` must name the same reader — a literal is the model asserting its own belief, which is what A exists to exclude |
| B | `docs/design/**` says otherwise | bounded `source` matching `CITATION`, in the charter's `docsScope`, no `..` |
| C | the app's own label says otherwise | the quote must appear in that step's page snapshot |
| D | general convention | never eligible; journalled for a human |

`UNEVALUABLE IS NOT VIOLATED` is load-bearing: a comparison that cannot be carried out is
never a finding. Collapsing it into `violated` would turn every malformed prediction into
a report.

**What the protocol does NOT establish** — recorded because two false findings appeared
within minutes of it first running, both ground A, both traceable, both reproducing:
`MemStore.undo()` is a no-op, so any undo prediction on the sheet surface is a guaranteed
false finding (now askable via `canUndo`); and docs undo is per-keystroke, so expecting a
typing burst to be one undo step is wrong for reasons unrelated to the product. Grounding
removes a CLASS of bad predictions, not all of them, which is why the verifier panel stays
load-bearing and its rubric attacks the EXPECTATION before the behaviour.

**Cross-sample agreement is absent by design**, and Phase 26 dropped it too for the same
measured reason (see that section). Precision therefore rests on journal-reference
resolution, the 3x deterministic replay, and the panel — so `actual` participates in
`uiObservedKey`, or replay would be blind to the very value a violation was computed from.

**No visual channel.** There is no screenshot action, and adding one is rejected rather
than deferred: a "these overlap" claim traces to nothing, so it is ineligible under every
ground above, and making it eligible would mean adding the "looks wrong" ground this
design exists to exclude. Spatial questions on slides/board are exactly computable from
state instead (`boundingBox`, `combinedBoundingBox`, `framesApproxEqual` are already
exported). Renderer bugs — model right, paint wrong — remain the visual lane's job, which
already owns 220 baselines with Docker font pinning. Two instruments, two failure classes.

**Exploration is a session; replay is a clean room.** The CLI hunter spawns a fresh
process per probe because that costs milliseconds. Measuring the same shape here retired
it: a 1-action plan takes 6095ms and a 3-action plan 6103ms, so Vite plus Chromium boot is
~6.1s and each subsequent action ~4ms. At `maxActions: 80` a spawn-per-action tool would
spend ~8 minutes on boot alone, against a whole-run probing budget of ~15 minutes. So
`packages/frontend/scripts/hunt-ui-runner.mjs` gained a `--serve` mode — newline-delimited
JSON, one response per request, one page for the session — and `scripts/agent/hunt-ui-session.mjs`
is the client (measured through it: ready 856ms, first action 5.4s, later actions 33-44ms).
Both modes share one `observeAction`, extracted rather than duplicated.

Replay deliberately does NOT use it. `runUiPlan` keeps its `spawnSync` path against
`--plan`, so the determinism gate still gets a fresh process and a fresh browser context
per attempt. Sharing one mechanism would mean either a slow explorer or a replay that
inherits state, and the second is how phantom repros get through. A failed action in serve
mode is an observation with `ok:false`, never a protocol error, because "the click missed"
is data — and the process stays up through a malformed request, since killing the browser
over one bad line discards the boot this mode exists to amortise.

**The tool description is the map.** PR 1's readers were reachable but undiscoverable:
nothing told a model that `doc.fontSizes` existed, so an agent asked about formatting would
reach for the snapshot and read an almost-empty a11y tree off a canvas.
`scripts/agent/hunt-ui-tool.mjs` therefore lists the readers, with arity, SCOPED TO THE
RUN'S SURFACE. That list is a second copy of the bridge registry, so a test parses
`packages/frontend/src/app/harness/hunt/bridge.ts` and fails on any divergence — a stale
copy is silent, because a reader never called is indistinguishable from an area with no
defects.

**The per-run surface selector is enforced, not requested.** `assertSafeActionPlan` bounds
reader NAMESPACES, which is the right check for it to make and not sufficient here: a run
assigned `doc` must not reach `sheet.*`. The tool checks exact names at three doors — the
action's own reader, a click target's `reader` (a point comes from `sheet.cellCenter`, not
from coordinates), and `expect.read` — plus `goto`'s surface, or an agent could navigate
out of its assignment and then read legally.

**What comes back is deliberately less than what happened.** A non-`read` action reports
only whether it landed; a prediction reports its VERDICT and never the measured `actual`;
no page snapshot is returned unless `dom.snapshot` was read by name. Handing back the value
invites re-describing a violated prediction as some weaker claim that happens to fit it,
which is the rationalisation the round-trip design exists to prevent.

**One gate, not two.** The orchestrator reaches the SAME `isFilingVerdict` the CLI
hunter does. Only two things genuinely differ — the permitted `confirmationGround`
values, and where citations come from — so those became options with the CLI's
behaviour as defaults, rather than a second gate. The reason is testability, not
tidiness: "every branch returns false, exactly one path to true" is a property that has
to be mutation-tested, and a duplicate gate would be covered by none of the tests
guarding the original. The two ground sets are pinned DISJOINT except for an explicit
allowlist (`none`, and `unhandled-failure` — a crash with no guarded path is the same
defect whether the stack came from a process or a `pageerror`), so adding a ground to
one hunter cannot silently widen the other.

**The UI explorer does not cite code, and that is deliberate.** `UI_EXPLORER_SCHEMA` has
no `citations` field at all. Localising "the font-size button misbehaved" to a source
line means tracing toolbar → `EditorAPI` → the docs style application: expensive in
turns, and exactly where a model invents a plausible wrong line. The VERIFIERS supply
the location through `groundedIn`, from source they actually read, and the gate's
citation stage is fed from there — still `CITATION`-shaped, still inside `codeScope`.
A field the schema does not offer cannot be filled in badly.

**The defect identity is the prediction, not the citation.** Cross-sample agreement died
because its identity was line-level citation overlap and two samples finding one defect
cited it a line or two apart. A UI defect has a better identity available, because the
protocol already names what broke: `(persona, action type, reader, operator, ground)`,
every component computed by trusted code from the journal. An unlocatable candidate gets
`""` and is recorded as a drop rather than given an invented key that would suppress
unrelated findings.

**The positive control is seeded, because the real one was already fixed.** Every other
check in this phase is a negative control — proof the hunter does not report things that
are fine. Nothing proved the opposite, and the two failures are indistinguishable from
outside: a healthy app and a dead instrument both print zero. #343 was to be the control
until PR 1 proved it already fixed, and no other open UI bug has a known ground-A shape.
So `?fault=drop-second-char` on the harness route swallows every second printable
keystroke — the cleanest possible ground-A shape, the app contradicting the agent's own
input. `verify:hunt:oracles` asserts BOTH directions: seeded must drive a ground-A
prediction to `violated` AND `eligible`, clean must leave it `held`. Both matter; a fault
that is always on manufactures findings, which is worse than one that never fires. This
is the one justified reversal of PR 1's rule that faults come only from the driver —
Playwright can inject a `pageerror` from outside, but it cannot inject a *semantic*
defect into the editor's own code path. It cannot ship: `/harness/hunt` is already
DEV-only via a statically-replaced `import.meta.env.DEV`, so the file is not in a
production bundle at all.

That control check drives the REAL runner and hands its output to `assessExpectation`
unmodified, rather than asserting over a hand-written journal. The distinction is not
pedantic: a test that constructs its own input can assert a property the pipeline does
not have, and this build has produced that exact defect more than once — including a
docblock in two files claiming the protocol treated the runner's oversized/unserializable
markers as unevaluable when nothing implemented it.

**A SEEDED RUN PASSES BY BEING REFUTED, NOT BY BEING REPORTED.** This phase was designed
around the opposite claim — "run the persona against `?fault=` and assert the pipeline
reports it end to end" — and the first live run showed that is unachievable, and should
be. Verifiers establish CAUSE by reading source, and this fault lives in the harness
route inside this repository. Four independent verifier sessions found it, cited
`page.tsx:112-128`, described the mechanism exactly ("a per-install counter,
`preventDefault()` on every second printable key"), confirmed the docs input path inserts
text verbatim with no drop logic, and refuted at high confidence. That is the panel doing
its job perfectly.

The only way to make a seeded fault reportable is to blind the verifier to the
repository, which buys a green control at the cost of the stage that stops
plausible-but-wrong findings. So the criterion is: the explorer FINDS it, replay
REPRODUCES it, and the panel refutes it *for the demonstrable reason that it is ours*.
That is a STRONGER signal than a report would be — it proves the panel can locate a
cause, which is exactly the capability the design's residual-risk section says everything
now rests on.

Status: PR 1 (#642) shipped the executor, harness and oracles; PR 2 (#665) the prediction
protocol; PR 3 (#678) the serve mode, the session client and the MCP tool; PR 4a (#684)
the orchestrator, personas and the seeded control; #691 the four defects the first live
runs exposed — a replay that scored 3/3 on plans where nothing ran, a turn ceiling below
the action budget, a failed brief discarding its journal, and `-C` failing to scope git
under a hook. Three seeded runs cost $13.42 in total and proved every stage: explorer,
grounding, replay, verifier, gate, ledger guard, report. Still to come: the clean run
that measures precision, repro minimization, the backend tier, and slides/board. Nothing
is filed automatically; the output is a local report, and the CLI hunter's filing gate
(20 accepted at >=90%) restarts for this surface because it generates candidates by a
different mechanism.

### Phase 32: Human-Reported Defects (Debug Report)

Phases 26 and 31 built hunters that generate their own candidates. This phase adds the
channel they cannot cover: **the defect a person noticed**. Full design in
[debug-report.md](debug-report.md); what belongs to the harness is below.

**The reporter is not asked to translate.** Phase 24's intake expects a brief with
reproduction steps and a location; producing one costs more than noticing the defect did,
which is why most noticed defects are never filed. Here the reporter supplies a point on
the screen and one sentence, and an agent produces the issue text — drafted at PREVIEW
time, so what the person confirms is the text that will be filed. The three additions to
`scripts/agent/` are an intake step (redact → dedupe → route), a verification step
(two-way delegation) and a PR-assembly step (grouping, one item per commit, size
disclosure); they arrive with the pipeline itself, later in the rollout.

**Nothing is filed without confirmation, and `hunt-ui` still files nothing.** The
`report-*` scripts act only on items a person confirmed in the panel; the hunters'
autonomous findings do not enter this path. That keeps the rule
[hunter-usage.md](hunter-usage.md) states — no filing stage on the hunters — intact
while giving confirmed human reports a filing route.

**Verification splits by what the report can support, and failure lowers the
destination rather than discarding the report.** A report with reproduction steps
becomes a synthesised plan for `hunt-ui.mjs replay`; an appearance report has neither
prediction nor plan, so it skips replay and is gated by a new `visual-intent` lens
instead — one `lenses.json` row plus one prompt, whose inputs are the reporter's
sentence and the baseline / actual / diff PNGs `verify-visual-browser.mjs` already emits.
It judges whether the after state satisfies the sentence AND whether the diff exceeded
the report's scope; the second fires more often. When replay says "not reproduced" the
report is filed as an issue carrying BOTH the expectation and the failed replay — the
documented failure mode where a reader's scope is wider than the action means a failed
replay is not proof the observation was wrong, and resolving that discrepancy is a
person's job, not the pipeline's.

**Grouping is governed by homogeneity, not count.** Two padding fixes pass or fail
together; a padding fix and a formula-engine bug do not. Items touching one file are
forced into one PR (separate PRs would conflict), items of one `kind` and risk class are
electively grouped, and `logic` items are never grouped. The pipeline may SPLIT a
proposed group and may never MERGE across kinds — splitting is always safe.

**Isolation outranks same-file merging**, which matters because the two rules
genuinely conflict: two `logic` items in one file satisfy both. Independent review of a
behaviour change is the stronger guarantee, so they stay separate and the file overlap
is REPORTED as a conflict — land one, rebase the other — rather than silently merged
into a PR the isolation rule forbids. Caps: 8 items per group, 5 PRs per session, with
overflow queued and visible rather than dropped.

**The grouping proposal is made without repository access, so the delta must be
reported.** Elective coupling needs only the items; forced coupling needs a checkout. A
PR shaped differently from what the person approved, with no stated reason, breaks trust
before it breaks anything else — so the results round-trip records
`proposed 2 PRs → actual 3 (reason)`, and a silent adjustment is a defect in this phase,
not an implementation detail.

**Credentials split by blast radius, not by convenience.** Drafting is tool-free and
output-only, so its key can live with the app (worst case: wasted tokens and a rejected
draft — no privileged action for an injection to reach). Verification, code location and
PR authorship need a checkout and the `verify:*` lanes, so that credential stays with the
repository and the repository PULLS reports with a read-only `ApiKey`. The app never
pushes; a compromised app cannot create a commit.

**`agent:candidate` cannot be granted by this path, and is not.** The gate requires the
label AND a non-Bot author, so an Actions-opened issue does not open it even when
labelled. The checkbox records intent: a local run applies the label, Actions mode
renders a checklist in the issue body. Intent conveyed, gate unweakened.

**The intake lane files nothing by itself, and the separation is structural.**
`report-intake.mjs` emits a plan; `report-verify.mjs` prints the lane commands rather
than running them; `report-to-pr.mjs` assembles branches, commits and bodies and spawns
no process at all — a test asserts that rather than trusting it. Opening a PR stays
`spec-to-pr.mjs handoff`, taken after a person has read the assembly. The payoff is that
`--dry-run` is the SAME code path as a real run, not a second one that drifts from it.

`report-bundle.mjs` re-validates a bundle at the disk boundary and cannot share code
with the browser's parser — `scripts/agent/` is a separate npm install, the same
constraint behind the UI hunter's subprocess runner. Shared fixtures under
`scripts/agent/fixtures/debug-report/`, loaded by both suites, are what keep the two
from drifting.

Status: SP0 spike run 2026-08-21 (throwaway; four findings recorded in
[debug-report.md](debug-report.md), three of which changed the capture design). Shipped
as a four-PR stack: 1a core model/session/store/`HostAdapter`; 1b capture, engine
locators and the overlay; 2 the preview panel, drafting and the dev transport; 3 the
`scripts/agent/` intake lane and the `visual-intent` lens. Each stage took one
`/code-review` round, and both of the first two rounds found real defects in the path
that had just been wired — including a drafting endpoint that could never have
succeeded, which its own unit tests could not see because they tested the
implementation rather than the wiring. Still to come: SP1.5 auto-detection and the SP2
deployed mailbox.

## Harness Policy

Harness policy is managed in `harness.config.json`:

```json
{
  "frontend": {
    "chunkBudgets": {
      "maxChunkKb": 500,
      "maxChunkCount": 60
    }
  },
  "entropy": {
    "deadCode": { "enabled": true },
    "docStaleness": { "enabled": true, "designDir": "docs/design" },
    "dependencyFreshness": { "enabled": true, "failOnCritical": true }
  }
}
```

Frontend chunk environment overrides:
- `FRONTEND_CHUNK_LIMIT_KB`
- `FRONTEND_CHUNK_COUNT_LIMIT`

Entropy detectors default to enabled; set `"enabled": false` to disable
individually for debugging. Dependency freshness `failOnCritical` fails the
gate when critical vulnerabilities are found.

## Definition of Harness v1 Completion

Harness v1 is complete when all are true:

1. Integration lane is reproducible locally without manual orchestration.
   **Status: Done** (`verify:integration:docker`).
2. CI failures are diagnosable in under 5 minutes from logs/reports.
   **Status: Done** (structured JSON reports per lane + summary via
   `scripts/verify-self.mjs` runner — Phase 19).
3. PR required verification evidence is automatically trustworthy.
   **Status: Done** (CI artifact upload + auto-comment on PRs — Phase 20).

## References

- [OpenAI: Harness engineering — leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
- [Martin Fowler: Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)
