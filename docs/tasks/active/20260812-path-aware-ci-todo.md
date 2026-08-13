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

## Phase 5: Deferred

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

- **`summarize-ci.mjs` cannot be edited here** — it is not in this repository at
  all any more. The agent workflows execute `wafflebase/agent-pipeline` at a
  pinned commit, and the mirror that used to sit in `scripts/agent/` was deleted;
  the module is not part of the vendored subset either. Change it upstream, tag,
  and bump the pin. (When this was written the mirror still existed and the
  constraint was that editing it changed nothing that executes; the conclusion is
  the same, the reason is now stronger.) `scripts/verify-pipeline-drift.mjs` (which does not list
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
