// reliability-v1 scorer — CROSS-RUN reliability of the review gate.
//
// Question: re-running the same frozen diff K times under the SAME judge
// (config_hash) — does it reach the SAME gate verdict? This is a validity-free
// RELIABILITY signal (self-consistency), not a correctness claim.
//
// Metric choice (deliberate): the unit is the GATE VERDICT (block vs approve) —
// a binary classification over a fixed set of corpus items, K "raters" = the K
// replicate runs. That is exactly the setting where chance-corrected agreement
// (Fleiss' κ) is well-defined. We do NOT compute κ over the raw finding SETS —
// there the negative class is unbounded (open-ended detection), so κ is
// mis-specified; finding-level agreement, if ever added, uses positive overlap
// (Jaccard/F1), not κ. See the harness scorer notes.
//
// Pure core (computeReliability / fleissKappaBinary / gateVerdict) is exported
// and unit-tested; the store-backed CLI is a thin wrapper.

import path from "node:path";
import { fileURLToPath } from "node:url";

const BLOCKING = new Set(["critical", "major"]);

/** The gate verdict a run produced for one item: "block" iff any kept finding is
 * critical/major (mirrors severity.classify). Findings come from payload.findings. */
export function gateVerdict(payload) {
  const findings = Array.isArray(payload?.findings) ? payload.findings : [];
  return findings.some((f) => BLOCKING.has(String(f?.severity ?? "").toLowerCase())) ? "block" : "approve";
}

/**
 * Fleiss' κ for a binary rating (block/approve) with a FIXED number of raters K
 * per subject. `perItem` = [{ block, approve }] with block+approve === K for every
 * item. Returns κ ∈ [-1,1]; null when it is undefined (K<2, <2 items, or no
 * variance — a degenerate all-same table where P̄e = 1).
 */
export function fleissKappaBinary(perItem) {
  const rows = (perItem || []).filter((r) => r && (r.block + r.approve) > 0);
  const N = rows.length;
  if (N < 2) return null;
  const K = rows[0].block + rows[0].approve;
  if (K < 2 || rows.some((r) => r.block + r.approve !== K)) return null;

  // Per-item agreement Pi = (Σ n_cat^2 − K) / (K(K−1))
  const Pbar = rows.reduce((s, r) => s + (r.block * r.block + r.approve * r.approve - K) / (K * (K - 1)), 0) / N;
  // Category marginals → expected agreement P̄e = Σ p_cat^2
  const pBlock = rows.reduce((s, r) => s + r.block, 0) / (N * K);
  const pApprove = 1 - pBlock;
  const Pe = pBlock * pBlock + pApprove * pApprove;
  if (Pe >= 1) return null; // no variance (every rating identical) → κ undefined
  return (Pbar - Pe) / (1 - Pe);
}

/**
 * Cross-run reliability over K replicate runs. `runs` = [{ runId, verdicts:
 * { itemId: "block"|"approve" } }]. Only items present in ALL runs are scored
 * (fair comparison; partial items are reported as excluded).
 * Returns { per_item, aggregate }.
 */
export function computeReliability(runs) {
  const list = (runs || []).filter((r) => r && r.verdicts);
  const K = list.length;
  if (K < 2) return { per_item: {}, aggregate: { n: 0, k_runs: K, note: "need ≥2 runs" } };

  // Items common to every run.
  const itemSets = list.map((r) => new Set(Object.keys(r.verdicts)));
  const common = [...itemSets[0]].filter((it) => itemSets.every((s) => s.has(it))).sort();
  const excluded = new Set(itemSets.flatMap((s) => [...s])).size - common.length;

  const per_item = {};
  const perItemCounts = [];
  let unstable = 0;
  for (const it of common) {
    const verdicts = list.map((r) => r.verdicts[it]);
    const block = verdicts.filter((v) => v === "block").length;
    const approve = K - block;
    const stable = block === 0 || approve === 0;
    if (!stable) unstable++;
    per_item[it] = { verdict_stable: stable, block, approve, n_runs: K };
    perItemCounts.push({ block, approve });
  }

  const kappa = fleissKappaBinary(perItemCounts);
  return {
    per_item,
    aggregate: {
      n: common.length,
      k_runs: K,
      items_excluded: excluded,
      verdict_flip_rate: common.length ? unstable / common.length : 0,
      kappa,
      method: "Fleiss κ over replicate binary gate verdicts (block/approve)",
    },
  };
}

// --- store-backed CLI -------------------------------------------------------

async function main() {
  const { GitFsStore } = await import("./store.mjs");
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith("--")) { args[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
  }
  if (!args.out || !args["config-hash"] || !args["corpus-version"]) {
    console.error("usage: reliability.mjs --out <results-repo> --config-hash <h> --corpus-version <v> [--scorer-id reliability-v1]");
    process.exit(2);
  }
  const store = new GitFsStore(args.out);
  const scorerId = args["scorer-id"] ?? "reliability-v1";
  const runIds = store.listRuns({ configHash: args["config-hash"], corpusVersion: args["corpus-version"] });
  if (runIds.length < 2) { console.error(`need ≥2 replicate runs, found ${runIds.length}`); process.exit(1); }

  const runs = runIds.map((runId) => {
    const verdicts = {};
    for (const itemId of store.listItems(runId)) {
      const got = store.getItem(runId, itemId);
      if (got?.envelope?.status === "ok") verdicts[itemId] = gateVerdict(got.payload);
    }
    return { runId, verdicts };
  });

  const { per_item, aggregate } = computeReliability(runs);
  const scoreJson = {
    scorer_id: scorerId, scorer_version: "reliability-v1",
    computed: new Date().toISOString(), scope: "cross-run",
    config_hash: args["config-hash"], corpus_version: args["corpus-version"],
    run_ids: runIds, per_item, aggregate,
  };
  store.putScore({ scope: "cross-run", configHash: args["config-hash"], corpusVersion: args["corpus-version"] }, scorerId, scoreJson);
  console.log(`reliability: n=${aggregate.n} k_runs=${aggregate.k_runs} flip_rate=${aggregate.verdict_flip_rate.toFixed(3)} kappa=${aggregate.kappa ?? "n/a"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("reliability scorer failed:", e); process.exit(1); });
}
