import { spawn } from "node:child_process";
import { readHeadSha } from "./agent/git-env.mjs";
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
  },
  // core must build first — sheets/docs/slides/frontend all import
  // `@wafflebase/core` (geometry, tokens) from its gitignored `dist/`.
  { name: "core:build", cmd: "pnpm core build" },
  { name: "sheets:build", cmd: "pnpm sheets build" },
  { name: "docs:build", cmd: "pnpm --filter @wafflebase/docs build" },
  { name: "slides:build", cmd: "pnpm slides build" },
  // Every consumer tsconfig sets `skipLibCheck: true`, so a `dist/` whose
  // declaration graph has holes typechecks green and degrades to `any`.
  // Assert the four packages just built above actually resolve.
  {
    name: "verify:dts",
    cmd: "node ./scripts/verify-dts-entries.mjs core sheets docs slides",
  },
  { name: "verify:fast", cmd: "pnpm verify:fast" },
  { name: "frontend:build", cmd: "pnpm frontend build" },
  { name: "verify:frontend:chunks", cmd: "pnpm verify:frontend:chunks" },
  { name: "backend:build", cmd: "pnpm backend build" },
  { name: "cli:build", cmd: "pnpm cli build" },
  { name: "verify:entropy", cmd: "pnpm verify:entropy" },
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

function extractFailureSummary(output) {
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  for (const line of lines) {
    if (
      /\b(FAIL|ERROR|error|Error|✗|✘|FAILED)\b/.test(line) &&
      line.trim().length > 5
    ) {
      return line.trim().slice(0, 500);
    }
  }
  return lines.length > 0 ? lines[lines.length - 1].trim().slice(0, 500) : null;
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
  const overall = results.every((r) => r.status === "pass") ? "pass" : "fail";
  const summary = {
    timestamp: new Date().toISOString(),
    overall,
    totalDurationMs,
    lanesRun: results.filter((r) => r.status !== "skip").length,
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

mkdirSync(reportDir, { recursive: true });

const results = [];
const totalStart = Date.now();
const headBefore = readHead();
let failed = false;

for (const { name, cmd } of LANES) {
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
    r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "○";
  const dur =
    r.durationMs > 0 ? ` (${(r.durationMs / 1000).toFixed(1)}s)` : "";
  console.log(`  ${icon} ${r.lane}${dur}`);
}
console.log(
  `\n  ${summary.overall === "pass" ? "All lanes passed" : "FAILED"} in ${(summary.totalDurationMs / 1000).toFixed(1)}s`,
);
console.log(`  Report: ${reportDir}/summary.json\n`);

if (failed) {
  process.exit(1);
}
