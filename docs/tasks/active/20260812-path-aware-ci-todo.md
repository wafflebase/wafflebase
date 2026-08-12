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

## Phase 3: The two heavy jobs

- [ ] 3.1 `changes` job in `ci.yml` calling the resolver
- [ ] 3.2 `if:` gates on `verify-browser` / `verify-integration`
- [ ] 3.3 `full-ci` label override (cannot work on `merge_group` — that payload
      carries no PR labels, same constraint `agent-iterate-ci.yml:39` works around)
- [ ] 3.4 `ci-config-changed` label + `::warning::` in the job summary
- [ ] 3.5 Render filtered lanes + reasons in the `<!-- harness-verification -->` comment

## Phase 4: The deploy gate

- [ ] 4.1 `full: true` on `push`-to-`main` (lands in 1.2; this is what makes the
      gate sound)
- [ ] 4.2 `publish-ghpage.yml`: `push` → `workflow_run` on CI success, checkout
      `event.workflow_run.head_sha`, `concurrency` coalescing
- [ ] 4.3 `docker-publish.yml`: same, and delete the dead
      `paths-ignore: frontend/**` (the directory is `packages/frontend/**`, so it
      has never skipped anything)

## Phase 5: Deferred

- [ ] 5.1 Tighten `verify-browser` / `verify-integration` to per-package reverse
      closure. v1 keeps `packages/**` ⇒ both, on purpose (see lessons).

## Constraints discovered during planning

- **`scripts/agent/summarize-ci.mjs` must not be edited here.**
  `scripts/verify-pipeline-drift.mjs` compares `scripts/agent/` against the
  pinned `wafflebase/agent-pipeline` commit, and `summarize-ci.` is not in its
  `STAYS` exclusion list — an edit here fails the `pipeline-drift` job. The new
  lane status is named `filtered` (not a reuse of `skip`) specifically so the
  pinned pipeline's `summarize-ci.mjs` *ignores* it rather than mislabeling it as
  "skipped because an earlier lane failed" (`summarize-ci.mjs:102`). Teaching it
  to render `filtered` is a follow-up in that other repo.
- **`packages/docs|slides|sheets|core` can break `verify-integration` with zero
  backend files touched** — `ci.yml` builds those four for that job, and the e2e
  set includes `docs-cli-roundtrip`, `notes-cli-roundtrip`, `slides-pptx-import`.
- **`verify-browser` never touches the backend** — `verify-browser-lanes.mjs`
  builds only core + sheets and runs Playwright; no Postgres, no Yorkie, no
  `webServer`. `packages/backend/**` → browser is not a real edge.
- **`pipeline-drift` stays ungated** — it is the correctness gate on the very
  area being sped up, and costs ~30s.
