// ReviewerAdapter — the review-panel target behind the Target Adapter seam.
// Framework-agnostic contract: prepareInput / runAgent / captureArtifacts.
// (Scoring is cross-run, done by reliability.mjs over a set of runs, not here.)
//
// prepareInput   corpus item inputs → files review-panel.mjs reads
// runAgent       spawn review-panel.mjs (ONE process, N lens subagents) → out dir
// captureArtifacts  read the panel's output files → { payload, executionMessages }
//
// FIDELITY NOTE (v1): replay is DIFF-ONLY — the panel runs against an empty
// --repo, so lenses reason from the diff, not the surrounding code they could
// Read in production. Reliability (self-consistency under identical conditions)
// is unaffected; production-fidelity (repo checked out at the PR head) is a
// documented future enhancement.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

export function reviewerAdapter({ panelScript }) {
  return {
    name: "reviewer",

    /** Write the panel's input files into workDir; return their paths. */
    prepareInput(itemInput, workDir) {
      mkdirSync(workDir, { recursive: true });
      const diffFile = path.join(workDir, "diff.patch");
      const changedFilesFile = path.join(workDir, "changed-files.txt");
      writeFileSync(diffFile, itemInput.diff ?? "");
      writeFileSync(changedFilesFile, (itemInput.changedFiles ?? []).join("\n") + "\n");
      let issueFile = null;
      if (itemInput.issueSpec) {
        issueFile = path.join(workDir, "issue-spec.md");
        writeFileSync(issueFile, itemInput.issueSpec);
      }
      return { diffFile, changedFilesFile, issueFile };
    },

    /** Spawn review-panel.mjs for this item. Async so a caller can show live
     * progress while it runs (the panel is quiet for minutes otherwise).
     * `lensesDir` is the materialized config; `repoDir` is the checked-out repo
     * context (or an empty dir for diff-only). */
    runAgent(inputs, { lensesDir, outDir, repoDir, env = process.env }) {
      mkdirSync(repoDir, { recursive: true });
      const args = [
        panelScript,
        "--diff-file", inputs.diffFile,
        "--changed-files", inputs.changedFilesFile,
        "--lenses-dir", lensesDir,
        "--repo", repoDir,
        "--out", outDir,
      ];
      if (inputs.issueFile) args.push("--issue-file", inputs.issueFile);
      return new Promise((resolve) => {
        const child = spawn("node", args, { env });
        let stdout = "", stderr = "";
        child.stdout?.on("data", (d) => { stdout += d; });
        child.stderr?.on("data", (d) => { stderr += d; });
        child.on("error", (e) => resolve({ outDir, code: -1, stdout, stderr: stderr + String(e) }));
        child.on("close", (code) => resolve({ outDir, code, stdout, stderr }));
      });
    },

    /** Read the panel's outputs into the artifact payload + the raw SDK messages
     * (for cost accounting via metrics.sumExecutions). */
    captureArtifacts(outDir) {
      const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
      const panel = readJson(path.join(outDir, "panel.json")) ?? [];
      const lensStats = readJson(path.join(outDir, "review-lens-stats.json")) ?? [];
      const executionMessages = readJson(path.join(outDir, "review-execution.json")) ?? [];

      // Kept/gate findings from each lens's verdict.json, tagged by lens.
      const findings = [];
      for (const entry of panel) {
        const verdict = readJson(path.join(outDir, entry.id, "verdict.json"));
        for (const f of verdict?.findings ?? []) {
          findings.push({ lens: entry.id, severity: f.severity, file: f.file, summary: f.summary, evidence: f.evidence });
        }
      }
      const payload = { adapter: "reviewer", panel, lensStats, findings };
      return { payload, executionMessages };
    },
  };
}
