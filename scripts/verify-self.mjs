import { spawn } from "node:child_process";
import { extractFailureSummary } from "./failure-summary.mjs";
import { readHeadSha } from "./agent/git-env.mjs";
import {
  laneOrderViolations,
  resolve as resolveChangedAreas,
  selectLaneNames,
} from "./changed-areas.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const reportDir = path.resolve(repoRoot, ".harness-reports");

const LANES = [
  // Agent-harness unit tests. `scripts/agent` is a standalone npm package
  // OUTSIDE the pnpm workspace, so `pnpm verify:fast` never reaches it — without
  // this lane the panel's safety-critical suites (severity/checks/verifier) would
  // never run in CI. No build or SDK install needed (the SDK is lazy-imported),
  // so it runs first and fails fast on a regression in the gate itself.
  //
  // RECURSIVE, and single-quoted so NODE expands the pattern rather than `sh`.
  // Both halves are load-bearing. The glob used to be a flat `*.test.mjs`, which
  // silently matched nothing in any subdirectory — `scripts/agent/eval/`'s suites
  // would have been written, passed locally and then never run again, with green
  // CI as the only evidence. And node's own globber skips `node_modules`, which
  // `sh` does not: the `deps` job runs `npm ci` inside `scripts/agent`, so an
  // sh-expanded `**` would start running third-party test files.
  // `eval/test-lane.test.mjs` reads this line back and asserts every suite under
  // `eval/` is matched by it, at every depth.
  //
  // WHY A TIMEOUT FLAG. On 2026-08-06 run 31073290840 printed `ok 1` .. `ok 305`,
  // went silent 2.3s in, and sat there for 31.5 minutes until a human with write
  // access cancelled it by hand; teardown then reported six orphan processes
  // (node, sh, node, sh, node, node). It never printed a `# tests` summary, and
  // the same lane at that same commit prints 1180 of them locally — so the
  // suite did NOT complete: 875 tests never reported. The offending change is
  // reverted, and the log does not say which of two mechanisms stalled it:
  // a test that hung while running, or a test FILE whose tests all finished
  // while a child process it spawned kept its process alive. Reproducing both
  // shapes together showed neither flag alone ends both — `--test-timeout` names
  // the hung test and then hangs on the leaked child; `--test-force-exit` never
  // fires, because a hung test never "finishes". Both flags shipped together for
  // that reason; only the timeout survives, for the reason below.
  //
  //   --test-timeout=60000  cancels a test that hangs WHILE RUNNING and NAMES it
  //     with its file and line, so the next one diagnoses itself. 60s is ~8x the
  //     slowest single test measured here (7.7s, a CLI-spawning test, macOS) and
  //     ~17x the lane's whole CI duration (3.5s). Deliberately loose: a flaky
  //     timeout on a loaded runner would be worse than the hang it guards.
  //
  //   --test-force-exit  WAS here and has been REMOVED, because it truncated the
  //     very reports this lane exists to produce. It exits the runner once every
  //     known test has finished — but that exit does not wait for the per-file
  //     child results to finish arriving, so whole files' results were dropped.
  //     Silently: a result that never arrives cannot fail, so the lane printed
  //     `# fail 0` and went green having run less than it claimed. Six
  //     consecutive Node 22 runs of the full glob reported 1468, 1410, 1427,
  //     1460, 1411 and 1434 tests — up to 58 missing, and on one run every test
  //     in `harvest.test.mjs`, a file unrelated to anything being changed. When
  //     the same truncation landed mid-message instead of between files it
  //     surfaced as `eval/run.test.mjs` dying with "Unable to deserialize cloned
  //     data": that is the CI failure seen on #736 and twice on #742, each time
  //     cleared by a re-run, each time costing a maintainer the question "is this
  //     my change?".
  //
  //     Removing it costs nothing measurable. Without the flag the same glob
  //     completes in 8-13s and reports the full 1468 every time (6/6 runs, exit
  //     0, no orphans). The hang it was added for is still bounded, by the two
  //     mechanisms that actually bound it: `--test-timeout` above names a test
  //     that hangs WHILE RUNNING, and `ci.yml`'s `timeout-minutes` bounds the
  //     rest. That was already true when the flag shipped — the note here said so
  //     ("it only fires when the runner learns the tests finished, which a child
  //     spawned `stdio: \"inherit\"` prevents … Only `ci.yml`'s `timeout-minutes`
  //     bounds that one"), which is the case it was reached for and the one case
  //     it never covered. `reapLaneGroup` below still cleans up orphans.
  //
  // THE REMAINING FLAG GOES BEFORE `--test`. `eval/test-lane.test.mjs` captures
  // everything after `--test ` in each invocation and expands it with `sh`; put
  // the flag after and it is read back as a FILE to run, which node then fails to
  // find. That is now a loud failure rather than the silent one this note used to
  // describe: the check no longer matches globs by hand, it runs the command
  // substitution and compares its real output against the files on disk.
  //
  // WHY THIS LANE INVOKES NODE TWICE. `eval/run.test.mjs` runs in a process of
  // its own, and that is the whole fix for a failure this lane has been red with
  // since #750: the file dies with `Unable to deserialize cloned data` thrown by
  // the RUNNER's `#processRawBuffer`, never by a test — a partial frame on the
  // v8-serialized channel a test file reports its results over. It always takes
  // some of that file's trailing tests with it, so the run also goes SHORT.
  //
  // Measured on ubuntu-latest across 180 lane runs on a fork, counting the
  // string:
  //
  //   in one invocation with the rest of the suite   6 / 60
  //   alone, in its own invocation                   0 / 60   (p = 0.027)
  //
  // What that measurement also rules out, each on its own arm of 20-40 runs:
  // node 22 vs node 24 (5/40 vs 4/40, p = 1.000 — not a runtime bug to wait
  // out); `--test-concurrency=1` (still 1/20, and it doubles the lane); CPU
  // pressure and OOM (`cancelled 0`, no kernel OOM line, 10.9 GB free, and the
  // corrupted runs finish EARLY — 6.7s against a 9.6s median — which is the
  // shape of a process that stopped, not one that struggled).
  //
  // THE CAUSE IS NOW KNOWN, and it was never really about sharing a runner. A
  // test file reports over its own STDOUT, as v8 frames (`0xFF 0x0F`, 4-byte
  // big-endian length, payload). `#processRawBuffer` looks for that magic only at
  // the TOP of a call: having consumed one frame it takes whatever follows in the
  // same read chunk as the next frame's header and length without re-checking, so
  // plain text behind a frame becomes a length — a large one stalls the stream and
  // loses that file's remaining results, a small one deserializes garbage and
  // throws. `eval/run.mjs`'s progress heartbeat was the only writer of such text
  // in this lane (`runCli` redirects `console.log`, which the heartbeat never
  // used), and it now goes to stderr, which the runner reads as lines.
  //
  // Measured on a real `eval/run.test.mjs` child's captured result stream,
  // randomized chunk boundaries, same frames in both arms: with its 931 bytes,
  // 30/30 reproduce the exact error; with the text removed, 0/30. Sharing a runner
  // was a proxy for load — a busy runner drains each socket later, so a frame and
  // the text behind it coalesce into one read far more often, which is why the
  // arms above moved without ever naming a cause.
  //
  // ISOLATION IS KEPT ANYWAY, and deliberately not claimed as the fix. The parser
  // behaviour is upstream and still there, so this bounds the blast radius of any
  // future stdout write from this file. Removing it is a separate change and wants
  // its own measurement, not a rider on this one. What has not changed is why it is
  // written this way: nothing is skipped, no result is dropped,
  // and the two invocations together report the SAME total one invocation reports
  // when it is not corrupted — 1556 + 55 = 1611 as measured at `7dbeb61ce`, a
  // number that moves with every test added, so it is the equality that is the
  // claim here and not the figure. Compare
  // `--test-force-exit` below, which also made this lane green and did so by
  // losing up to 58 tests without saying so.
  //
  // The cost is +5s on a lane that is 0.9% of `verify-self` (#692 measured 3.5s
  // of 412s), against a failure that was costing a re-run on roughly one PR in
  // eight.
  //
  // SEQUENCED, NOT `&&`. Joining the two invocations with `&&` would skip
  // `eval/run.test.mjs` entirely whenever anything in the first list failed — the
  // lane reporting less than it ran, on the exact failure path where a second
  // failure is most worth seeing. That is the defect #750 was about, reintroduced
  // by the fix for it, so both invocations run and the first non-zero status is
  // what the lane exits with.
  //
  // `-prune` rather than `! -path './node_modules/*'`: that form only excludes the
  // TOP-LEVEL install, so a nested `node_modules` anywhere under `scripts/agent`
  // would still have its vendored suites run. `-prune` drops the directory at any
  // depth, and `eval/test-lane.test.mjs` plants a file in a nested one to prove it.
  //
  // `find` rather than a second glob because node's `--test` has no exclusion
  // syntax, and an ENUMERATED list would silently stop covering a file someone
  // adds later — the exact failure `eval/test-lane.test.mjs` exists to prevent.
  // That test now runs this command substitution and checks its real output, so
  // the two invocations are proven to partition the suite rather than asserted to.
  {
    name: "agent:tests",
    cmd: "cd scripts/agent && node --test-timeout=60000 --test $(find . -type d -name node_modules -prune -o -name '*.test.mjs' ! -path './eval/run.test.mjs' -print | cut -c3- | sort) ; rest=$? ; node --test-timeout=60000 --test 'eval/run.test.mjs' ; iso=$? ; if [ $rest -ne 0 ] ; then exit $rest ; fi ; exit $iso",
    tags: ["agent"],
  },
  // Top-level harness scripts (`scripts/*.mjs`), whose suites live in
  // `scripts/test/`. NOTHING RAN THESE BEFORE THIS LANE. `agent:tests` above
  // covers `scripts/agent/` only — a standalone npm package outside the pnpm
  // workspace — and `pnpm verify:fast` reaches neither, so
  // `scripts/test/verify-entropy.test.mjs` sat in the repository for months
  // having never been executed by CI. It passes; that is luck, not evidence.
  //
  // Single-quoted so NODE expands the pattern rather than `sh`, for the reason
  // spelled out on `agent:tests` above: node's globber is recursive and skips
  // `node_modules`, so a suite added in a subdirectory later is picked up
  // instead of silently matching nothing.
  //
  // No selector on purpose, so it runs only on a full pass. Everything it tests
  // — `changed-areas.mjs`, `verify-*.mjs` — is in `harness.config.json`'s
  // `ci.ciConfig` list, and a change to any of those forces a full run anyway.
  // A new `scripts/foo.mjs` is unclassified, which also forces one.
  {
    name: "scripts:tests",
    cmd: "node --test-timeout=60000 --test 'scripts/test/**/*.test.mjs'",
  },
  // Repo-wide lint of `scripts/`, which is what `verify:fast` used to reach
  // first. Kept first here for the same reason: it is seconds long and catches
  // the class of mistake that would otherwise be found after a nine-minute build.
  { name: "lint:scripts", cmd: "pnpm lint:scripts", tags: ["agent"] },
  // Index coverage — every package, design doc and top-level script is
  // reachable from the README that introduces it. The complement of
  // `verify:entropy`'s dead-link pass, which walks links → disk and so cannot
  // see a file that was ADDED and never indexed (nothing points at it, so there
  // is no broken reference to find). `anyPkg` because a new package is exactly
  // the case it exists for; `docsProse` because a new design doc is the other.
  // Reads markdown and builds nothing, so it declares no `needs` and sits with
  // the other sub-second gates rather than after the builds.
  {
    name: "verify:doc-index",
    cmd: "pnpm verify:doc-index",
    anyPkg: true,
    tags: ["docsProse"],
  },
  // The third direction on the same subject. `verify:doc-index` asks whether a
  // file was ever introduced; `verify:entropy` walks links out of the design
  // docs; this one walks the whole graph from CLAUDE.md and asks whether the
  // paths a reader is invited to follow lead anywhere. An index is a promise,
  // and the other two gates check that the promise exists, not that it holds.
  // Same shape as the gate above: reads markdown, builds nothing.
  {
    name: "verify:doc-links",
    cmd: "pnpm verify:doc-links",
    anyPkg: true,
    tags: ["docsProse"],
  },
  // Import-boundary rules. Neither arch config sets `parserOptions.project`, so
  // both are pure syntactic lints and need no `dist/` — which is why they sit
  // above the builds rather than after them.
  { name: "arch:frontend", cmd: "pnpm frontend lint:arch", pkgs: ["frontend"] },
  { name: "arch:backend", cmd: "pnpm backend lint:arch", pkgs: ["backend"] },
  // core must build first — sheets/docs/slides/frontend all import
  // `@wafflebase/core` (geometry, tokens) from its gitignored `dist/`.
  { name: "core:build", cmd: "pnpm core build", pkgs: ["core"] },
  // Vitest over `src/`; nothing here imports the `dist/` this package produces,
  // so it declares no `needs`.
  { name: "core:test", cmd: "pnpm core test", pkgs: ["core"] },
  {
    name: "sheets:build",
    cmd: "pnpm sheets build",
    pkgs: ["sheets"],
    needs: ["core:build"],
  },
  {
    name: "docs:build",
    cmd: "pnpm --filter @wafflebase/docs build",
    pkgs: ["docs"],
    needs: ["core:build"],
  },
  {
    name: "slides:build",
    cmd: "pnpm slides build",
    pkgs: ["slides"],
    needs: ["core:build", "docs:build"],
  },
  // Every consumer tsconfig sets `skipLibCheck: true`, so a `dist/` whose
  // declaration graph has holes typechecks green and degrades to `any`.
  // Assert the four packages just built above actually resolve.
  {
    name: "verify:dts",
    cmd: "node ./scripts/verify-dts-entries.mjs core sheets docs slides",
    pkgs: ["core", "sheets", "docs", "slides"],
    needs: ["core:build", "sheets:build", "docs:build", "slides:build"],
  },
  // WHAT USED TO BE ONE `verify:fast` LANE. That lane was a single `&&` chain
  // covering `lint:scripts`, four builds and eighteen per-package typecheck and
  // test invocations, reported as one pass/fail row taking most of the runner's
  // nine minutes. Two things were wrong with that. A failure anywhere in the
  // chain named the whole chain, so `.harness-reports/` — the artifact the agent
  // fixer reads to decide what broke — could say no more than "verify:fast
  // failed". And a chain cannot be selected against: `pnpm sheets test` and
  // `pnpm frontend lint` have nothing to do with each other, but no filter can
  // run one without the other while they share a lane.
  //
  // `pnpm verify:fast` itself is UNCHANGED and still the pre-commit gate: it is
  // the one command a human wants when the question is "is this committable",
  // and `.githooks/pre-commit` runs it. The duplication between the two is
  // deliberate and cheap; the chain re-running `pnpm core build` is why these
  // lanes no longer do.
  //
  // Each `needs` below is the dependency the package actually resolves through
  // `exports` to a built `dist/`, established per package rather than assumed:
  //   * No engine package has tsconfig `paths`, so `@wafflebase/x` in
  //     sheets/docs/slides/board/cli resolves to that package's `dist/`.
  //   * The frontend aliases sheets/docs/notes/slides/board to their `src/` in
  //     `vite.config.ts` and does NOT alias core — so its lanes need `core:build`
  //     and nothing else.
  //   * The backend's jest `moduleNameMapper` maps every workspace import,
  //     core included, to `src/` — so `backend:test` needs no build at all.
  //     `backend:build` still does, because tsc resolves for real.
  {
    name: "sheets:check",
    cmd: "pnpm sheets typecheck && pnpm sheets test",
    pkgs: ["sheets"],
    needs: ["core:build"],
  },
  {
    name: "docs:check",
    cmd: "pnpm --filter @wafflebase/docs typecheck && pnpm --filter @wafflebase/docs test",
    pkgs: ["docs"],
    needs: ["core:build"],
  },
  {
    name: "slides:check",
    cmd: "pnpm slides typecheck && pnpm slides test",
    pkgs: ["slides"],
    needs: ["core:build", "docs:build"],
  },
  // notes and design-editor reach no BUILT workspace output, so they are the lanes
  // that can run against a tree with nothing built.
  {
    name: "notes:check",
    cmd: "pnpm --filter @wafflebase/notes typecheck && pnpm --filter @wafflebase/notes test",
    pkgs: ["notes"],
  },
  {
    name: "design-editor:check",
    // The shell build joins this lane rather than earning its own. `dist/` is
    // gitignored, so nothing else in CI would ever run it — and a broken shell build
    // is not cosmetic: `shellServer` serves `dist/shell`, so the whole editor 404s
    // without it. ~3s, which is well under the cost of another lane.
    //
    // `lint` joins it for the same reason, and because of what its absence cost: this
    // package carried ~17 React files with no ESLint config at all, so `react-hooks`
    // never saw it and a `useState` below an early return reached main. It runs FIRST —
    // a lint error is the cheapest failure here, and finding it after a 3s build and a
    // 1000-test suite wastes the difference.
    cmd: "pnpm --filter @wafflebase/design-editor lint && pnpm --filter @wafflebase/design-editor typecheck && pnpm --filter @wafflebase/design-editor test && pnpm --filter @wafflebase/design-editor build",
    pkgs: ["design-editor"],
    // `pkgs` alone would never select this lane: harness.config.json lists
    // packages/design-editor/** as inert, and an inert match short-circuits the
    // packages/ classification, so the package never reaches `packages`. The tag
    // is what keeps the lane reachable — same shape as documentation:build.
    tags: ["designEditor"],
  },
  {
    name: "design-sandbox:check",
    cmd: "pnpm --filter @wafflebase/design-sandbox typecheck && pnpm --filter @wafflebase/design-sandbox test",
    // Tagged on the same `designEditor` tag as the lane above, deliberately: this
    // package imports design-editor's source directly, so its typecheck program
    // contains that package's files and a change to either can break the other. Two
    // separate tags would let a design-editor-only change skip the lane that would
    // have caught it.
    pkgs: ["design-sandbox"],
    tags: ["designEditor"],
    // It does reach a `dist/`, one step removed and easy to miss: this package
    // consumes `@wafflebase/design-editor` as SOURCE, but `vitest.config.ts`
    // aliases the ENGINES to their `src/` too (the canvas seed tests must load the
    // same copy the scenes do), and engine source imports `@wafflebase/core`
    // through its `exports` map — `packages/sheets/src/view/theme.ts` pulls
    // `@wafflebase/core/tokens`. Without core built that is an ERR_MODULE_NOT_FOUND
    // inside sheets, reported against a design-sandbox test. Same shape as the
    // frontend lanes: engines aliased to src, core resolved for real.
    needs: ["core:build"],
  },
  {
    name: "debug-report:check",
    cmd: "pnpm --filter @wafflebase/debug-report typecheck && pnpm --filter @wafflebase/debug-report test",
    pkgs: ["debug-report"],
    // Geometry comes from `@wafflebase/core/geometry`, whose exports map points
    // at `dist` — so the declarations have to exist before this typechecks.
    needs: ["core:build"],
  },
  {
    name: "board:check",
    cmd: "pnpm --filter @wafflebase/board typecheck && pnpm --filter @wafflebase/board test",
    pkgs: ["board"],
    needs: ["core:build", "docs:build", "slides:build"],
  },
  {
    name: "cli:check",
    cmd: "pnpm cli typecheck && pnpm cli test",
    pkgs: ["cli"],
    needs: ["core:build", "docs:build", "slides:build"],
  },
  { name: "backend:test", cmd: "pnpm backend test", pkgs: ["backend"] },
  { name: "frontend:lint", cmd: "pnpm frontend lint", pkgs: ["frontend"] },
  {
    name: "frontend:test",
    cmd: "pnpm frontend test",
    pkgs: ["frontend"],
    needs: ["core:build"],
  },
  {
    name: "frontend:build",
    cmd: "pnpm frontend build",
    pkgs: ["frontend"],
    needs: ["core:build"],
  },
  {
    name: "verify:frontend:chunks",
    cmd: "pnpm verify:frontend:chunks",
    pkgs: ["frontend"],
    needs: ["frontend:build"],
  },
  {
    name: "backend:build",
    cmd: "pnpm backend build",
    pkgs: ["backend"],
    needs: ["core:build", "docs:build", "sheets:build", "slides:build"],
  },
  {
    name: "cli:build",
    cmd: "pnpm cli build",
    pkgs: ["cli"],
    needs: ["core:build", "docs:build", "slides:build"],
  },
  // The VitePress docs site. NO LANE BUILT THIS BEFORE. `publish-ghpage.yml`
  // runs `pnpm build:all`, which builds it at DEPLOY time, so a broken docs site
  // failed the deployment rather than the pull request. That is survivable while
  // the deploy is unconditional and is not once the deploy waits on CI, so the
  // build moves in front of the merge.
  {
    name: "documentation:build",
    cmd: "pnpm documentation build",
    pkgs: ["documentation"],
    tags: ["documentation"],
  },
  // Repo-global by nature: knip's dead-code pass reasons over the whole import
  // graph, so an export can only be proven dead by looking at every package at
  // once. Hence `anyPkg` rather than a package list — any package change can
  // orphan an export somewhere else. `docsProse` is here because
  // `entropy.docStaleness` reads `docs/design`. It runs last because it is the
  // only lane that wants every `dist/` present.
  {
    name: "verify:entropy",
    cmd: "pnpm verify:entropy",
    anyPkg: true,
    // `designEditor` is here because `anyPkg` cannot reach it. An inert package
    // never lands in `packages`, so the one gate a design-editor change CAN fail
    // — knip's dead-code pass, which analyses packages/design-editor since #819
    // added it to knip.json's `workspaces` — would otherwise be skipped on the PR
    // and first fail on main's push run. It costs the four engine builds in
    // `needs`; the heavy jobs and the frontend/backend suites still skip.
    tags: ["docsProse", "designEditor"],
    needs: ["core:build", "sheets:build", "docs:build", "slides:build"],
  },
];

const IS_POSIX = process.platform !== "win32";

/**
 * SIGKILL everything still in `pid`'s process group.
 *
 * Called once a lane has already exited, so the only members left are things it
 * leaked. `agent:tests` can leak: a test that spawns a child which outlives it
 * would otherwise run alongside every later lane and the coverage steps after
 * them. The 2026-08-06 incident's job teardown reported six such orphans. This
 * mattered more when `--test-force-exit` could end the runner mid-flight; it is
 * kept because the leak it cleans up is a property of the tests, not of that
 * flag, and a lane that ends on a timeout can still strand a child.
 *
 * Negative pid means "the group", which is why `runCommand` spawns detached: a
 * detached child is its own group LEADER, so its pid doubles as the group id.
 * Attached, it inherits this runner's group instead, its pid is not a group id
 * at all, and the signal lands on nothing (or on an unrelated group that
 * happens to hold that number). Verified by mutation — dropping `detached`
 * leaves the orphan running.
 *
 * Best-effort on purpose. ESRCH — the whole group already gone — is the normal
 * case and must not fail a lane that passed.
 */
function reapLaneGroup(pid) {
  if (!IS_POSIX || !pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone. Nothing to report and nothing to do.
  }
}

/**
 * Lane process groups that have not been reaped yet.
 *
 * `detached` also detaches the lane from the terminal's foreground group, so a
 * Ctrl-C that reaches this runner no longer reaches the lane. Forwarding it by
 * hand keeps the old behaviour: interrupting `pnpm verify:self` (this file is
 * the `pre-push` hook's entry point) still stops the build it started.
 */
const liveLaneGroups = new Set();
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(signal, () => {
    for (const pid of liveLaneGroups) reapLaneGroup(pid);
    process.exit(code);
  });
}

function runCommand(cmd, cwd) {
  return new Promise((resolve) => {
    const chunks = [];
    const proc = spawn("sh", ["-c", cmd], {
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
      // See reapLaneGroup: its own process group is what makes the lane
      // reapable as a unit.
      detached: IS_POSIX,
    });
    const { pid } = proc;
    if (pid) liveLaneGroups.add(pid);

    proc.stdout.on("data", (data) => {
      process.stdout.write(data);
      chunks.push(data);
    });

    proc.stderr.on("data", (data) => {
      process.stderr.write(data);
      chunks.push(data);
    });

    // Reap on `exit`, NOT on `close`. `exit` fires when the lane's own process
    // ends; `close` waits for its stdout and stderr to close as well, and an
    // orphan that inherited those pipes holds them open indefinitely. Reaping
    // from `close` therefore never runs in the one case that most needs it —
    // measured: a lane that exits after backgrounding a pipe-holding child left
    // the orphan alive and the runner blocked past 20s, never reaching the next
    // lane. Killing the group here closes those pipes, which is what lets
    // `close` arrive at all.
    //
    // Reaping before the drain finishes costs nothing: bytes already written
    // sit in the pipe buffer and are still read after the writer dies. Only a
    // process still producing output *after* its own lane exited loses
    // anything, and that process is the leak.
    proc.on("exit", () => {
      liveLaneGroups.delete(pid);
      reapLaneGroup(pid);
    });

    // `close`, not `exit`, for the RESULT, so the lane's tail output is in
    // `chunks` before the report is written.
    //
    // Still not covered: a lane whose own process never exits — the
    // `stdio: "inherit"` case in the comment on `agent:tests` above, where the
    // test runner itself never learns its tests finished. Neither handler
    // fires, so nothing here bounds it; `ci.yml`'s `timeout-minutes` is the
    // only thing that does.
    proc.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, output: Buffer.concat(chunks).toString() });
    });
  });
}

function laneFileName(lane) {
  return lane.replaceAll(":", "-");
}

function writeLaneReport(report) {
  const filePath = path.resolve(reportDir, `${laneFileName(report.lane)}.json`);
  writeFileSync(filePath, JSON.stringify(report, null, 2) + "\n");
}

function writeSummary(results, totalStart) {
  const totalDurationMs = Date.now() - totalStart;
  // `some(fail)` and NOT `every(pass)`. The old form was equivalent only while
  // `skip` could not appear without a `fail` ahead of it — which is exactly what
  // `filtered` breaks. Under `every(pass)` a run where one lane was correctly
  // filtered and every other lane passed reports `overall: "fail"`, which would
  // have turned the whole point of this change into a red PR.
  const overall = results.some((r) => r.status === "fail") ? "fail" : "pass";
  const summary = {
    timestamp: new Date().toISOString(),
    overall,
    totalDurationMs,
    lanesRun: results.filter((r) => r.status === "pass" || r.status === "fail")
      .length,
    lanesFiltered: results.filter((r) => r.status === "filtered").length,
    lanesTotal: LANES.length,
    lanes: results.map(({ lane, status, durationMs }) => ({
      lane,
      status,
      durationMs,
    })),
  };
  writeFileSync(
    path.resolve(reportDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  return summary;
}

/**
 * The commit HEAD points at, or `null` when that cannot be read (a vendored
 * copy or exported tarball, where the guard below does not apply).
 *
 * Read once before the lanes and again after each one. No lane may move the
 * developer's branch: a test that shells out to git and escapes its fixture
 * commits into THIS repository instead, on whatever branch is checked out,
 * replacing the branch tip. That happened — ten commits left a branch and the
 * resulting push read as deleting every file — and the only symptom was the
 * diff stat.
 *
 * Scoped via `readHeadSha` rather than trusting `cwd`, because this runner IS
 * the `pre-push` hook's entry point, and a hook is exactly where git exports
 * `GIT_DIR`. Reading `HEAD` with an inherited environment would let the guard
 * watch a different repository than the lanes can damage.
 *
 * Detects *net* movement of `HEAD` only. A lane that commits and resets back,
 * rewrites another ref, or mutates the index or stash is NOT covered; claiming
 * otherwise would be worse than the narrow guarantee, because it invites
 * trusting a green run.
 */
function readHead() {
  return readHeadSha(repoRoot);
}

// --- main ---

// A `needs` edge pointing forward is a lane whose prerequisite has not been
// built when it runs, and the selection closure cannot catch it — it would
// select both and still run them in this order. Refuse to start instead: a wrong
// answer here surfaces as a build error inside an unrelated package, which is
// the most expensive kind of failure to read.
const orderProblems = laneOrderViolations(LANES);
if (orderProblems.length > 0) {
  console.error("verify:self: the lane graph is inconsistent —");
  for (const problem of orderProblems) console.error(`  ${problem}`);
  process.exit(2);
}

// The lane graph, for `scripts/test/verify-self-lanes.test.mjs`. A flag rather
// than an export because importing this module runs the suite; the test gets the
// real array as the runner sees it, not a copy that could drift from it.
if (process.argv.includes("--print-lanes")) {
  console.log(
    JSON.stringify(
      LANES.map(({ name, pkgs, tags, needs, anyPkg }) => ({
        name,
        pkgs: pkgs ?? [],
        tags: tags ?? [],
        needs: needs ?? [],
        anyPkg: anyPkg ?? false,
      })),
    ),
  );
  process.exit(0);
}

mkdirSync(reportDir, { recursive: true });

// In CI, `ci.yml`'s `changes` job has already decided this and passes it down in
// `WAFFLEBASE_CHANGED_AREAS`, which `resolve()` returns verbatim — so the gates on
// the two heavy jobs and the lane selection here cannot reach different
// conclusions. Locally there is no such hand-off, so `resolve()` diffs against the
// merge-base with `upstream/main` (then `origin/main`, then `main`) and every way
// that can fail returns "run everything".
//
// This is also the pre-push hook, so a push is checked against the areas it
// touches rather than the whole suite. What backstops that is the `push` run on
// `main`, which is never filtered and which the deploy waits on.
const resolved = resolveChangedAreas();
const selected = selectLaneNames(LANES, resolved);

if (!resolved.full) {
  console.log("verify:self: lane filtering is ON");
  for (const reason of resolved.reasons ?? []) console.log(`  - ${reason}`);
  console.log(`  running ${selected.size} of ${LANES.length} lanes`);
}

const results = [];
const totalStart = Date.now();
const headBefore = readHead();
let failed = false;

for (const { name, cmd } of LANES) {
  // Checked before the `failed` cascade below, because the two mean different
  // things and must not be conflated: `filtered` is "no changed path can reach
  // this lane", `skip` is "an earlier lane failed, so this never got its turn".
  // `scripts/agent/summarize-ci.mjs` renders `skip` as the latter in prose, so
  // reusing `skip` would have made it state, confidently, something untrue about
  // every filtered lane. An unrecognised status is instead simply absent from
  // its counts, which is the safe direction to be wrong in.
  if (!selected.has(name)) {
    const filteredReport = {
      lane: name,
      status: "filtered",
      durationMs: 0,
      exitCode: null,
      failureSummary: null,
    };
    results.push(filteredReport);
    writeLaneReport(filteredReport);
    continue;
  }

  if (failed) {
    const skipReport = {
      lane: name,
      status: "skip",
      durationMs: 0,
      exitCode: null,
      failureSummary: null,
    };
    results.push(skipReport);
    writeLaneReport(skipReport);
    continue;
  }

  const start = Date.now();
  console.log(`\n▸ ${name}`);

  const { exitCode, output } = await runCommand(cmd, repoRoot);
  const durationMs = Date.now() - start;

  // Checked after the exitCode split so a lane that genuinely failed keeps its
  // own diagnosis; a moved HEAD is then reported on top of it rather than
  // instead of it. `headAfter == null` while `headBefore` was readable means
  // the repository stopped answering during the lane, which is a worse outcome
  // than movement and must not pass as "unchanged".
  const headAfter = readHead();
  const headLost = Boolean(headBefore) && headAfter === null;
  const headMoved = Boolean(headBefore) && Boolean(headAfter) && headAfter !== headBefore;

  if (headMoved || headLost) {
    const detail = headMoved
      ? `moved HEAD ${headBefore.slice(0, 9)} -> ${headAfter.slice(0, 9)}`
      : "left HEAD unreadable";
    const report = {
      lane: name,
      status: "fail",
      durationMs,
      // Deliberately not the lane's own exit code: a lane can corrupt the
      // repository and still exit 0, and a report saying `fail` alongside
      // `exitCode: 0` reads as a contradiction to downstream consumers.
      exitCode: exitCode === 0 ? 1 : exitCode,
      failureSummary: `lane ${detail}${exitCode === 0 ? "" : ` (lane also exited ${exitCode})`}`,
    };
    results.push(report);
    writeLaneReport(report);
    console.error(`\n\u2717 ${name} ${detail}`);
    console.error("  This lane wrote to the repository. Inspect before doing anything else:");
    console.error("    git status && git reflog -n 20");
    if (headMoved) {
      console.error(`  The prior tip was ${headBefore}. Resetting to it DISCARDS uncommitted work,`);
      console.error("  so tag the current state first:  git tag rescue/$(date +%s) HEAD");
    }
    failed = true;
    continue;
  }

  if (exitCode === 0) {
    const report = {
      lane: name,
      status: "pass",
      durationMs,
      exitCode: 0,
      failureSummary: null,
    };
    results.push(report);
    writeLaneReport(report);
  } else {
    const report = {
      lane: name,
      status: "fail",
      durationMs,
      exitCode,
      failureSummary: extractFailureSummary(output),
    };
    results.push(report);
    writeLaneReport(report);
    failed = true;
  }
}

const summary = writeSummary(results, totalStart);

console.log("\n─── verify:self summary ───");
for (const r of results) {
  const icon =
    r.status === "pass"
      ? "✓"
      : r.status === "fail"
        ? "✗"
        : r.status === "filtered"
          ? "⊘"
          : "○";
  const dur =
    r.durationMs > 0 ? ` (${(r.durationMs / 1000).toFixed(1)}s)` : "";
  console.log(`  ${icon} ${r.lane}${dur}`);
}
// "All lanes passed" would be a false claim on a filtered run, so say what was
// actually run whenever anything was left out.
const passHeadline =
  summary.lanesFiltered > 0
    ? `${summary.lanesRun} of ${summary.lanesTotal} lanes passed (${summary.lanesFiltered} filtered)`
    : "All lanes passed";
console.log(
  `\n  ${summary.overall === "pass" ? passHeadline : "FAILED"} in ${(summary.totalDurationMs / 1000).toFixed(1)}s`,
);
console.log(`  Report: ${reportDir}/summary.json\n`);

if (failed) {
  process.exit(1);
}
