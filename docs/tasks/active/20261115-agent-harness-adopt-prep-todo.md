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

- [ ] Run the arms' suites against yorkie's core (main `0fa3f92f`) in a
      scratch copy, and fix every arm-side incompatibility here so the arms
      pass against either core
- [ ] Root `.gitattributes` with the two `-text` lines the manifest needs
- [ ] `docs/design/template.md` → `TEMPLATE.md` (the issue-to-PR prompt names
      it), and every reference
- [ ] `scripts/ci/summarize-ci.mjs --dir <reports>` with the core's contract
      (silent, exit 3, unless a lane failed), and `ci.yml` uploading the lane
      reports as `ci-lane-reports` beside today's `harness-reports`

### W3 — the per-repository files

- [ ] `.github/agent-harness/config.json` and `coverage-note.md`, from
      today's values; loads with yorkie's `config.mjs`
- [ ] `.github/actions/agent-toolchain/`: the hardened install (#1142) as
      the toolchain action, plus the pinned pnpm download it needs once the
      workflows no longer set pnpm up; its tests beside it
- [ ] `.github/agent-harness/repo.test.mjs`, `repo.snapshot.json`, `README.md`
- [ ] Dry run of W4 in a scratch copy: sync, `npm ci && npm test && npm run
      test:repo`, the arms lane, `scripts/test`; classify every failure

## Review

(filled in as the work lands)
