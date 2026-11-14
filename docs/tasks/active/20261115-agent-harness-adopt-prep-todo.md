# Prepare for yorkie's Shared Harness Core — Task Tracking

wafflebase is moving its agent harness onto yorkie's shared core: everything
under `scripts/agent/` and every `.github/workflows/agent-*.yml` becomes a
byte-identical copy written by yorkie's `sync.mjs`, and what is wafflebase's
own lives in `.github/agent-harness/` and `.github/actions/agent-toolchain/`.
This task is steps W2 and W3 of the convergence plan: make every convention
the core assumes true here, and write the per-repository files, so that the
switch (W4) is the sync and nothing else. The sync itself is not part of it:
`scripts/agent/**` and today's `agent-*.yml` keep running as they are.

## Plan

### W2 — conventions and decoupling

- [x] Run the arms' suites against yorkie's core (main `0fa3f92f`) in a
      scratch copy, and fix every arm-side incompatibility here so the arms
      pass against either core
- [x] Root `.gitattributes` with the two `-text` lines the manifest needs
- [x] `docs/design/template.md` → `TEMPLATE.md` (the issue-to-PR prompt names
      it), and every reference
- [x] `scripts/ci/summarize-ci.mjs --dir <reports>` with the core's contract
      (silent, exit 3, unless a lane failed), and `ci.yml` uploading the lane
      reports as `ci-lane-reports` beside today's `harness-reports`

### W3 — the per-repository files

- [x] `.github/agent-harness/config.json` and `coverage-note.md`, from
      today's values; loads with yorkie's `config.mjs`
- [x] `.github/actions/agent-toolchain/`: the hardened install (#1142) as
      the toolchain action, plus the pinned pnpm download it needs once the
      workflows no longer set pnpm up; its tests beside it
- [x] `.github/agent-harness/repo.test.mjs`, `repo.snapshot.json`, `README.md`
- [x] Dry run of W4 in a scratch copy: sync, `npm ci && npm test && npm run
      test:repo`, the arms lane, `scripts/test`; classify every failure

## Review

- Arms against yorkie's core (main `0fa3f92f`), scratch copy, no
  `node_modules`: 10 failures before (a removed `globToRegExp`, a
  disclosure predicate that reads per clause, an unexported probe
  vocabulary); 646 tests, 644 pass + 2 `todo` after. Against today's core:
  643 pass, 3 skipped.
- The probe's "permission denied" and "/login" are anchored to the
  credential in the arm and in today's core, matching yorkie's pending
  `agent-harness-probe-vocab`; against that core the vocabulary comparison
  is enforced and passes.
- The toolchain action is the #1142 install plus a pinned pnpm download.
  Two changes were needed for the shared workflows: `.trusted-*` checkouts
  at the workspace root are left out of the walks and a link into one is
  refused, and the container sees an empty read-only directory over `.git`
  and each trusted checkout. Mutations of each fail the suite; the
  real-container test passes with Docker.
- W4 dry run, synced from yorkie `agent-harness-probe-vocab` (`6a505b83`)
  and main (`0fa3f92f`): `npm test` 1366/1367 (one load timeout, passes
  alone) and 1370/1370, `test:repo` 27/27 on both, arms 647/647 and
  645 + 2 `todo`. `scripts/test`: eleven guard failures in
  `agent-workflow-guards.test.mjs`, the same on both cores, which W4 has to
  resolve (most are the guard's shape for today's install steps).
- actionlint 1.7.12: the base's 16 shellcheck notes, nothing new.

## Review round 1

Two independent reviews (toolchain; configuration and the rest). Fixed:

- [x] The install skipped every root `.trusted-*` directory; it now skips
      only the checkout it runs from (a real directory with a real `.git`),
      walks every other one, and refuses links into any of them
- [x] `DOCKER_HOST` must be unset or a `unix://` socket
- [x] `repo.test.mjs` claimed the shared rules take every test name; it now
      pins the exact gap (`*.e2e-spec.ts`, `*.integration.ts` are not
      runnable names) until yorkie-team/yorkie#2362 lands
- [x] The root `postinstall` leaves `.githooks` unwired under CI
- [x] The template catalogue's README is policy, not prose
- [x] The probe-vocabulary `todo`s became an exact pin of yorkie main's
      present answers, so any change there fails
- [x] `summarize-ci.mjs` closes a fence a cut leaves open and escapes the
      heading
- [x] The switch's losses are listed in `.github/agent-harness/README.md`

Each fix was mutation-checked: reverting it fails its test.

