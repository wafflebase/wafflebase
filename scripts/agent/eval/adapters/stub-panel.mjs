// A STAND-IN for review-panel.mjs, so the replay runner can be tested for free.
//
// This is the reason `panelScript` is injected rather than resolved: the real
// panel spends money on every invocation, so a test suite that drove it would
// either not exist or not run. Every defect the adapter and the runner fix is a
// property of what the panel WROTE and what it EXITED WITH, and both are
// reproducible by a script that writes canned files and exits with a chosen code.
// So the whole subprocess contract — six flags in, six files out, a gate line on
// stdout, an exit code — becomes assertable at zero cost.
//
// IT IS NOT A MODEL OF THE PANEL, and must not grow into one. It has exactly one
// job: emit a chosen shape of output. The one place it defers to the real panel is
// `stageDetailDiffContentEnabled`, which is IMPORTED rather than re-implemented —
// a stub that re-typed that rule would let the runner's env plumbing pass while
// the real flag did nothing, which is the class of bug the assertion exists for.
// (Importing `review-panel.mjs` is cheap and needs no `node_modules`: `ask.mjs`
// imports the SDK lazily.)
//
// Driven by a JSON spec at $STUB_PANEL_SPEC. Absent → a sane one-lens success.
// Every key is optional:
//
//   exitCode        number, default 0
//   omit            file names NOT to write, e.g. ["panel.json"]
//   gate            "auto" (default: behave like the real panel), "none", or a
//                   literal line to print
//   baseResolves    boolean, default true — with a --base-sha, does the gate run?
//   lensDiffMode    "auto" (default: the real STAGE_DETAIL_DIFF_CONTENT gate),
//                   "never" or "always". `never` models a panel that does not
//                   write `lensDiff` no matter what the flag says — a pre-#644
//                   panel, or a flag that did not propagate. That is a DIFFERENT
//                   PANEL, not a second copy of the rule, which is why it is a
//                   mode here and not an if-statement over the env.
//   lenses          [{ id, findings, stageDetail, conclusion, applicable,
//                      blocking, valid, infraError }]
//   execution       the review-execution.json array
//   wallMs          number for review-timing.json
//   hang            boolean, default false — write everything, then NEVER EXIT
//   spawnGrandchild boolean, default false — with `hang`, also start a child
//                   process that ignores SIGTERM
//
// WHY A HANG MODE, AND WHY IT SPAWNS A GRANDCHILD. Both are shapes of exit
// behaviour, which is the same thing `exitCode` already models — not a step
// towards modelling the panel. The grandchild is the load-bearing half: the real
// panel's `query()` starts its own subprocess per lens, so a stub that hung
// alone would let a plain `child.kill()` pass the timeout test while leaving in
// production exactly the orphans #682's CI hang ended with. It inherits stdio on
// purpose — holding the parent's pipes open is what stops `close` from firing,
// which is the half of that hang a timeout alone does not fix. The pids go to
// `stub-pids.json` so a test can assert on the PROCESSES, not on the promise.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs } from "../../vendor/pipeline/gh-checks.mjs";
import { stageDetailDiffContentEnabled } from "../../vendor/pipeline/review-panel.mjs";

/** One lens, one blocking finding carrying the two fields the harness used to
 *  drop: `lane` (from the gate's git blame) and `novelty` (from `noveltyOf`). */
const DEFAULT_SPEC = {
  exitCode: 0,
  omit: [],
  gate: "auto",
  baseResolves: true,
  lensDiffMode: "auto",
  hang: false,
  spawnGrandchild: false,
  lenses: [
    {
      id: "correctness",
      findings: [
        {
          severity: "major",
          file: "scripts/agent/x.mjs",
          summary: "the retry loop can spin forever",
          evidence: "x.mjs:41 has no ceiling",
          lane: "backlog",
          novelty: { origin: "relocated", basis: "blame" },
          unsettled: true,
        },
      ],
      stageDetail: { samples: [[]], verifications: [], scopeNote: "" },
    },
  ],
  execution: [
    {
      type: "result",
      num_turns: 3,
      total_cost_usd: 0.42,
      duration_ms: 90000,
      session_id: "stub-session",
      usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  ],
  wallMs: 30000,
};

function loadSpec() {
  const p = process.env.STUB_PANEL_SPEC;
  if (!p) return DEFAULT_SPEC;
  return { ...DEFAULT_SPEC, ...JSON.parse(readFileSync(p, "utf8")) };
}

function gateLine(spec, baseSha, repo) {
  if (spec.gate === "none") return null;
  if (spec.gate !== "auto") return String(spec.gate);
  // The real panel's three lines, verbatim from `review-panel.mjs`.
  if (!baseSha) return "novelty gate: OFF (no --base-sha) — every finding routes as before";
  if (!spec.baseResolves) return `novelty gate: OFF — --base-sha ${baseSha} does not resolve in ${repo}`;
  return `novelty gate: on, base ${baseSha}`;
}

const args = parseArgs(process.argv);
const outDir = path.resolve(args.out ?? ".agent-review");
const spec = loadSpec();
const omit = new Set(spec.omit ?? []);
const write = (rel, obj) => {
  if (omit.has(rel)) return;
  const abs = path.join(outDir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(obj, null, 2) + "\n");
};

mkdirSync(outDir, { recursive: true });
// What the adapter ACTUALLY passed. Asserting this is what turns "6/6 flags match
// upstream" from an audit finding into a test.
write("stub-argv.json", process.argv.slice(2));

const line = gateLine(spec, args["base-sha"], path.resolve(args.repo ?? process.cwd()));
if (line) console.log(line);

write(
  "panel.json",
  spec.lenses.map((l) => ({
    id: l.id,
    title: l.title ?? l.id,
    blocking: l.blocking ?? true,
    applicable: l.applicable ?? true,
    conclusion: l.conclusion ?? "success",
    valid: l.valid ?? true,
    ...(l.infraError ? { infraError: l.infraError } : {}),
  })),
);
write("review-lens-stats.json", spec.lenses.map((l) => ({ id: l.id, samples: 2 })));
write("review-execution.json", spec.execution);
if (spec.wallMs !== null) write("review-timing.json", { wallMs: spec.wallMs, startedAt: 0, endedAt: spec.wallMs });

for (const l of spec.lenses) {
  write(path.join(l.id, "verdict.json"), {
    findings: l.findings ?? [],
    summary: l.summary ?? "",
    valid: l.valid ?? true,
    conclusion: l.conclusion ?? "success",
  });
  if (l.stageDetail) {
    // The `lensDiff` KEY rides along only when the flag is on, and the decision is
    // the real panel's own exported gate — see the header. `""` is a legitimate
    // value (a lens whose file-class slice is empty), which is why the runner's
    // assertion counts the key and not the bytes.
    const detail = { ...l.stageDetail, lensDiffBytes: (l.lensDiff ?? "").length };
    const carries =
      spec.lensDiffMode === "never" ? false
        : spec.lensDiffMode === "always" ? true
          : stageDetailDiffContentEnabled(process.env);
    if (carries) detail.lensDiff = l.lensDiff ?? "";
    write(path.join(l.id, "stage-detail.json"), detail);
  }
}

// A panel that never exits, optionally with a subprocess of its own. Last, so
// everything above has already been written: the interesting case is a panel that
// LOOKS like it is working and simply never finishes, not one that produced
// nothing.
if (spec.hang) {
  const pids = { panel: process.pid, grandchild: null };
  if (spec.spawnGrandchild) {
    // Ignores SIGTERM and outlives its parent unless the whole GROUP is
    // signalled — measured behaviour for a process reached only by `child.kill()`.
    const gc = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
      stdio: "inherit",
    });
    pids.grandchild = gc.pid;
  }
  write("stub-pids.json", pids);
  setInterval(() => {}, 1000);
} else {
  process.exit(spec.exitCode ?? 0);
}
