// The review panel behind the target-adapter seam: three methods, one
// subprocess, and the panel's own output contract expressed as data.
//
//   prepareInput      corpus item inputs → the files review-panel.mjs reads
//   runAgent          spawn review-panel.mjs (ONE process, N lens subagents)
//   captureArtifacts  its output files + its own stdout → what a run envelope records
//
// The subprocess contract is INTACT and this module does not rewrite it: all six
// flags and all six output files below were re-verified against
// `review-panel.mjs` at `bb21ff953`. What is rewritten is the capture side, where
// four separate defects all failed in the SAME direction — they turned a broken
// review into a clean one:
//
//   1. every finding was rebuilt as `{lens,severity,file,summary,evidence}`, so
//      the `lane` the gate routed on was computed and then thrown away. The lane
//      rests on a `git blame` of the tree under review, so it is the one field
//      that CANNOT be recovered afterwards — that tree is gone after merge.
//      Upstream already fixed this exact bug once, in `normalizeFindings`, and
//      published the postmortem: rebuilding a finding from a field list "silently
//      dropped everything the orchestrator annotates onto a finding after the lens
//      produced it. That was a real bug rather than a tidy contract."
//   2. `runAgent` resolved `{outDir, code, stdout, stderr}` and the caller
//      assigned NONE of it, and `runAgent` never rejects by design — so no
//      non-zero exit could ever become a non-`ok` item. Fixed STRUCTURALLY rather
//      than by remembering: `captureArtifacts` now takes the RUN RESULT, not a
//      directory, so the exit code cannot be dropped without the call failing.
//   3. the panel prints whether the novelty gate ran, and that line was dropped
//      on the same statement. It is parsed here into a NAMED state.
//   4. `readJson(...) ?? []` turned a panel that crashed before writing
//      `panel.json` into "the panel found nothing" — `findings: []`,
//      `stageDetail: {}`, and `status: "ok"`. Indistinguishable from a genuinely
//      clean pull request, and a free perfect-precision zero-recall data point in
//      every scorer downstream. `panel` is now `null` with a named `panelState`,
//      and `findings` is `null` rather than `[]`, so "nothing was found" is not
//      spellable by a missing file.
//
// A FALSE CLEAN REVIEW IS NOT NOISE, IT IS A PERFECT SCORE. That is why every
// judgement in here refuses rather than degrades, and why the read path answers
// with named states instead of empty collections: `[]` and `{}` are legitimate
// values the panel really does produce, so they must not also be the shape of
// failure.
//
// FIDELITY. A replay's `--repo` is whatever the runner materialised: an empty
// directory when repo context is unavailable, the tree at `review_commit` when it
// is. Neither is a git checkout yet, so `--base-sha` is available here (and
// asserted, below) but nothing passes it — that pairing is PR 6's. This comment
// deliberately does not state a fidelity INVARIANT; the version it replaces
// asserted "replay is DIFF-ONLY" and was already false when the runner grew a
// repo-context path.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { readWallMs } from "../../metrics.mjs";

/**
 * Every flag this adapter passes, named once so a test can pin the contract
 * rather than an audit re-deriving it by hand every few months. Verified against
 * `review-panel.mjs`'s usage block: all six are still accepted there.
 *
 * `baseSha` is listed and is NOT passed by the runner today — see the header. It
 * is here so that the assertion in `parseGateState` has something to assert
 * against, which is the whole reason the gate's self-report is checkable now
 * instead of after PR 6 lands.
 */
export const PANEL_FLAGS = Object.freeze({
  diffFile: "--diff-file",
  changedFiles: "--changed-files",
  lensesDir: "--lenses-dir",
  repo: "--repo",
  out: "--out",
  issueFile: "--issue-file",
  baseSha: "--base-sha",
});

/**
 * The panel's output files, by role. Five were already read; `timing` is the
 * SIXTH and the adapter did not know it existed — which is how our arm's latency
 * came to be read from `sumExecutions`'s flat `duration_ms` sum. That sum is not
 * wall-clock: the panel runs its lenses, and each lens's samples and verifier
 * calls, CONCURRENTLY, so it overcounts by the concurrency factor (#669 measured
 * a ~12-minute panel reported as 36–63).
 */
export const PANEL_OUTPUT_FILES = Object.freeze({
  panel: "panel.json",
  lensStats: "review-lens-stats.json",
  execution: "review-execution.json",
  timing: "review-timing.json",
  verdict: "verdict.json",
  stageDetail: "stage-detail.json",
});

/**
 * What we know about whether the novelty gate ran, as a closed vocabulary.
 *
 * The panel prints exactly one of three lines and the harness threw all three
 * away. It matters more than it looks: an inert gate is SAFE (every finding keeps
 * gating) but it is indistinguishable in the output from "nothing was relocated",
 * so a run with the gate and a run without it look identical — and pooling those
 * two is the measurement error this whole lane exists to prevent.
 *
 *   off-no-base-sha          no `--base-sha` was passed. EXPECTED today.
 *   off-base-sha-unresolved  a `--base-sha` was passed and does not resolve in
 *                            `--repo`. The silent-degradation case.
 *   on                       the gate ran, against a base the panel resolved.
 *   unreported               the panel printed none of the three. Either it died
 *                            before reaching that point, or the line moved — and
 *                            a contract that moved without anyone noticing is
 *                            exactly what this project keeps getting burned by.
 */
export const GATE_STATES = Object.freeze(["off-no-base-sha", "off-base-sha-unresolved", "on", "unreported"]);

/**
 * Whether the capture carries the routed diff each lens actually read.
 *
 *   complete    every lens that wrote a stage detail carries the `lensDiff` key
 *   partial     some do and some do not
 *   absent      none do, though captures exist
 *   no-capture  no lens wrote a stage detail at all — capture disabled, or every
 *               lens skipped. Nothing to assert and nothing to over-read.
 *
 * The KEY is what is counted, never the value. `lensDiff: ""` is a real value the
 * router produces for a lens whose file-class slice is empty, and treating it as
 * missing would report a working capture as broken. An ABSENT key is the shape
 * that makes the downstream fixture builder fall back to the whole pull-request
 * diff, silently.
 */
export const DIFF_CONTENT_STATES = Object.freeze(["complete", "partial", "absent", "no-capture"]);

const refuse = (msg) => {
  throw new Error(`reviewer adapter: ${msg}`);
};

/**
 * Which of the three gate lines the panel printed, plus the line itself.
 *
 * Pure, exported, and matched on the DISTINGUISHING PHRASE rather than on the
 * exact sentence. The wording carries an em dash and a `--base-sha` value, and a
 * regex pinned to the full sentence would silently fall to `unreported` on a
 * punctuation edit — turning a passing assertion into a failing one for a reason
 * that has nothing to do with the gate. What must not drift is the DISTINCTION
 * between the three, and that is what is matched.
 *
 * The LAST gate line wins. There is one per panel process today; if a future
 * panel printed the state again after resolving it, the later line is the
 * conclusion.
 */
export function parseGateState(stdout) {
  const lines = String(stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("novelty gate:"));
  if (lines.length === 0) return { state: "unreported", line: null, baseSha: null };
  const line = lines[lines.length - 1];
  const sha = /\b([0-9a-f]{7,40})\b/.exec(line)?.[1] ?? null;
  // Order matters: the unresolved line ALSO contains "OFF", so the narrower
  // phrase is tested first.
  if (line.includes("does not resolve")) return { state: "off-base-sha-unresolved", line, baseSha: sha };
  if (/\bOFF\b/.test(line)) return { state: "off-no-base-sha", line, baseSha: null };
  if (/\bon\b/.test(line)) return { state: "on", line, baseSha: sha };
  // A `novelty gate:` line that says none of the three. Not `on` — claiming the
  // gate ran on an unparseable line is the one answer that cannot be recovered
  // from downstream.
  return { state: "unreported", line, baseSha: null };
}

/**
 * Read a JSON file into `{state, value}` — never into a bare value, and never
 * into a default.
 *
 * `?? []` on `panel.json` is the defect this shape exists to make unspellable. A
 * caller that wants to know "did the panel produce output?" must read `state`;
 * there is no value it can mistake for the answer.
 */
function readJsonState(file) {
  if (!existsSync(file)) return { state: "absent", value: null };
  try {
    return { state: "present", value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (e) {
    return { state: "unreadable", value: null, error: e.message };
  }
}

export function reviewerAdapter(options) {
  // Read rather than destructured, so `reviewerAdapter(null)` reaches the refusal
  // below instead of a `TypeError` about an intermediate value.
  const panelScript = options && typeof options === "object" ? options.panelScript : undefined;
  if (typeof panelScript !== "string" || panelScript.trim() === "") {
    refuse("panelScript is required — the panel is injected so a test can drive the contract with a stub instead of a paid run");
  }
  return {
    name: "reviewer",

    /**
     * Write the panel's input files into `workDir`; return their paths.
     *
     * REFUSES on an empty diff rather than writing one. The panel fails closed on
     * an empty `--diff-file` (its own comment: defaulting to `""` would hand
     * every lens an empty change → no findings → all-pass → an UNREVIEWED PR
     * promoted), so writing one guarantees a wasted spawn. `buildConfig` took the
     * same stance for the same reason: it is cheaper to find out here.
     */
    prepareInput(itemInput, workDir) {
      const diff = itemInput?.diff;
      if (typeof diff !== "string" || diff.trim() === "") {
        refuse("the item has an empty diff — the panel fails closed on one, so this spawn would burn a replay to learn that");
      }
      mkdirSync(workDir, { recursive: true });
      const diffFile = path.join(workDir, "diff.patch");
      const changedFilesFile = path.join(workDir, "changed-files.txt");
      writeFileSync(diffFile, diff);
      writeFileSync(changedFilesFile, (itemInput.changedFiles ?? []).join("\n") + "\n");
      // Only when there IS one. `null` and `""` both mean "this PR closed no
      // issue", and a `needsIssueSpec` lens must be able to tell that from an
      // issue whose body was blank — the store keeps the distinction as
      // `issueSpec: null`, and writing an empty file here would erase it.
      let issueFile = null;
      const spec = itemInput.issueSpec;
      if (typeof spec === "string" && spec.trim() !== "") {
        issueFile = path.join(workDir, "issue-spec.md");
        writeFileSync(issueFile, spec);
      }
      return { diffFile, changedFilesFile, issueFile };
    },

    /**
     * Spawn the panel for one item. Async so the caller can show progress while
     * it runs (the panel is quiet for minutes otherwise).
     *
     * `baseSha` is accepted and defaults to NOT PASSING the flag. That default is
     * the honest one today: the runner materialises the review tree with `git
     * archive`, which has no `.git`, so a `--base-sha` would resolve to nothing
     * and the panel would report the gate OFF — which `captureArtifacts` now
     * treats as a hard error, correctly. Passing it belongs with the real
     * worktree, in PR 6.
     *
     * Resolves rather than rejects, unchanged and deliberately: a spawn failure
     * and a non-zero exit are the same kind of fact about this item, and both
     * must reach the envelope. What changed is that the resolved value can no
     * longer be dropped — `captureArtifacts` takes it.
     */
    runAgent(inputs, { lensesDir, outDir, repoDir, env = process.env, baseSha = null }) {
      mkdirSync(repoDir, { recursive: true });
      mkdirSync(outDir, { recursive: true });
      const args = [
        panelScript,
        PANEL_FLAGS.diffFile, inputs.diffFile,
        PANEL_FLAGS.changedFiles, inputs.changedFilesFile,
        PANEL_FLAGS.lensesDir, lensesDir,
        PANEL_FLAGS.repo, repoDir,
        PANEL_FLAGS.out, outDir,
      ];
      if (inputs.issueFile) args.push(PANEL_FLAGS.issueFile, inputs.issueFile);
      if (typeof baseSha === "string" && baseSha !== "") args.push(PANEL_FLAGS.baseSha, baseSha);
      return new Promise((resolve) => {
        const child = spawn("node", args, { env });
        let stdout = "", stderr = "";
        child.stdout?.on("data", (d) => { stdout += d; });
        child.stderr?.on("data", (d) => { stderr += d; });
        // `args` travels with the result so a test can assert what the panel was
        // ACTUALLY told, and `baseShaPassed` so a consumer does not have to
        // re-derive the question the gate assertion turns on from the argv.
        const base = { outDir, args, baseShaPassed: args.includes(PANEL_FLAGS.baseSha) };
        child.on("error", (e) => resolve({ ...base, code: -1, stdout, stderr: stderr + String(e) }));
        child.on("close", (code) => resolve({ ...base, code, stdout, stderr }));
      });
    },

    /**
     * The panel's outputs, as what a run envelope records.
     *
     * TAKES THE RUN RESULT, NOT A DIRECTORY. That is the structural half of the
     * exit-code fix: the old signature was `captureArtifacts(outDir)`, so the
     * exit code, stdout and stderr had to be picked up by a caller that did not,
     * and nothing anywhere failed. A directory argument is now refused outright,
     * because a caller that reverts to the old call would otherwise silently lose
     * the same three fields again.
     *
     * Nothing here throws on the panel's own failures — this is a read path and
     * the states it reports ARE the findings. It throws only when its caller is
     * wrong.
     */
    captureArtifacts(runResult) {
      if (typeof runResult === "string" || !runResult || typeof runResult !== "object" || typeof runResult.outDir !== "string") {
        refuse(
          "captureArtifacts takes the result of runAgent, not an out directory — the old signature is how the panel's " +
            "exit code, stdout and stderr came to be discarded, and a non-zero exit could never become a non-ok item",
        );
      }
      const { outDir, code, stdout, stderr } = runResult;
      const at = (name) => path.join(outDir, name);

      const panelRead = readJsonState(at(PANEL_OUTPUT_FILES.panel));
      // A `panel.json` that parses but is not an array is as unusable as one that
      // does not parse, and the `for` loop below would treat it as empty.
      const panelState = panelRead.state === "present" && !Array.isArray(panelRead.value) ? "unreadable" : panelRead.state;
      const panel = panelState === "present" ? panelRead.value : null;
      const lensStats = readJsonState(at(PANEL_OUTPUT_FILES.lensStats));
      const execution = readJsonState(at(PANEL_OUTPUT_FILES.execution));

      // `null`, not `[]` and not `{}`, whenever the panel list is unusable. A
      // clean review genuinely produces `findings: []`, so the two must not share
      // a shape.
      let findings = null;
      let stageDetail = null;
      let lensesWithDetail = 0;
      let lensesWithDiff = 0;
      if (panel) {
        findings = [];
        stageDetail = {};
        for (const entry of panel) {
          const lensId = entry?.id;
          if (typeof lensId !== "string" || lensId === "") continue;
          const verdict = readJsonState(at(path.join(lensId, PANEL_OUTPUT_FILES.verdict))).value;
          for (const f of verdict?.findings ?? []) {
            // WIDEN, NEVER NARROW. The whole finding is copied and `lens` is
            // added — never rebuilt from a field list — so `lane`, `novelty`,
            // `unsettled` and anything a future round annotates all survive.
            //
            // `lens` LAST, overwriting, and that is upstream's own rule rather
            // than a convenience: `stampLens` documents why a fill-the-blank
            // version was "simply wrong" — a finding is model output, nothing
            // rejects an extra key, "so a fill-the-blank rule would let a finding
            // declare which lens raised it", which is origin spoofing. The
            // directory the verdict was read from is the authority on which lens
            // raised it.
            if (f && typeof f === "object") findings.push({ ...f, lens: lensId });
          }
          const detail = readJsonState(at(path.join(lensId, PANEL_OUTPUT_FILES.stageDetail))).value;
          // Absent for a lens that skipped, crashed or was inapplicable — no
          // sampling ran, so there is no round to record. Keyed only when present.
          if (detail && typeof detail === "object") {
            stageDetail[lensId] = detail;
            lensesWithDetail++;
            if ("lensDiff" in detail) lensesWithDiff++;
          }
        }
      }

      const diffContent = {
        state:
          lensesWithDetail === 0 ? "no-capture"
            : lensesWithDiff === lensesWithDetail ? "complete"
              : lensesWithDiff === 0 ? "absent" : "partial",
        lensesWithDetail,
        lensesWithDiff,
      };

      return {
        payload: {
          adapter: "reviewer",
          panel,
          lensStats: lensStats.value,
          findings,
          stageDetail,
          // Which of the panel's six outputs were actually there. Cheap
          // provenance that turns the 6/6 output contract from a point-in-time
          // audit result into something a stored run can be checked against.
          files: {
            [PANEL_OUTPUT_FILES.panel]: panelState,
            [PANEL_OUTPUT_FILES.lensStats]: lensStats.state,
            [PANEL_OUTPUT_FILES.execution]: execution.state,
            [PANEL_OUTPUT_FILES.timing]: existsSync(at(PANEL_OUTPUT_FILES.timing)) ? "present" : "absent",
          },
        },
        // The raw SDK result messages, for cost accounting. `null` when the log
        // is unusable, so `calls: 0` means "the panel made no calls" rather than
        // "we could not read whether it did".
        executionMessages: Array.isArray(execution.value) ? execution.value : null,
        // Hoisted out of `payload.files` so the classifier reads a named field
        // rather than indexing a map by a filename string it would have to re-type.
        panelState,
        // TRUE wall-clock, from the panel's own `review-timing.json` via #669's
        // reader. `null` when the file is absent or malformed — and the caller
        // must record the absence rather than substituting the summed value,
        // which is 3–5× high.
        wallMs: readWallMs(at(PANEL_OUTPUT_FILES.execution)),
        exitCode: code,
        gate: parseGateState(stdout),
        baseShaPassed: !!runResult.baseShaPassed,
        diffContent,
        stderr: String(stderr ?? ""),
      };
    },
  };
}
