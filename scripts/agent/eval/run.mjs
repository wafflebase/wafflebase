// Framework runner — role-agnostic orchestration behind the Target Adapter seam.
// Loops a corpus under one judge config, invoking the adapter per item and
// writing immutable artifacts via the store. Idempotent + resumable: a re-invoke
// with the same --run-id skips items already written, so a crash mid-run resumes.
//
// The runner never mentions "diff" or "lens" — that lives in the adapter. It
// knows only: corpus items, a config, run_ids, envelopes, and the store.
//
// Usage (a RUN INVOKES THE MODEL — costs money, needs CLAUDE_CODE_OAUTH_TOKEN):
//   node run.mjs --out <results-repo> --corpus-version <v> [--config-id baseline-opus-s2]
//        [--lenses-dir ../lenses] [--sdk-version 0.3.217] [--items pr-1,pr-2] [--run-id <id>]

import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GitFsStore } from "./store.mjs";
import { buildConfig, materializeLenses } from "./config-build.mjs";
import { reviewerAdapter } from "./adapters/reviewer.mjs";
import { sumExecutions } from "../metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const nowIso = () => new Date().toISOString();
const isoSafe = () => nowIso().replace(/[:.]/g, "-");

function countFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
}

/**
 * Fidelity (a): materialize the repo TREE at `commit` so lenses get the same
 * surrounding-code context they'd Read in production (vs an empty diff-only dir).
 * Cached per commit, reused across replicate runs (extract once). Returns the
 * checkout path, or null (→ caller falls back to diff-only) if unavailable.
 *
 * HARDENED: a naive `git archive | tar` masks a truncated archive (the pipe exits
 * 0 on partial input), which under corporate EDR / a partial fetch cached a
 * near-empty repo behind a `.materialized` flag — silently degrading context to
 * nothing. Now: archive to a FILE (git's non-zero exit can't be hidden), then
 * VERIFY the extracted file count matches the commit's tree before trusting it.
 * Anything short is discarded → honest diff-only fallback, not fake context.
 */
export function materializeRepoAt({ repoSource, commit, cacheRoot }) {
  if (!commit || !repoSource) return null;
  const dest = path.join(cacheRoot, commit);
  if (existsSync(path.join(dest, ".materialized"))) return dest; // cache hit (previously verified)
  try {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const tarf = path.join(dest, ".archive.tar");
    execFileSync("git", ["-C", repoSource, "archive", "-o", tarf, commit], { stdio: "pipe" });
    execFileSync("tar", ["-xf", tarf, "-C", dest], { stdio: "pipe" });
    rmSync(tarf, { force: true });
    // `git archive` legitimately omits export-ignore files, so don't require an
    // exact match — just catch GROSS truncation (the bug cached 19/2943 files).
    // The archive-to-file above is the real guard (git's non-zero exit throws);
    // this is a cheap structural backstop.
    const expected = execFileSync("git", ["-C", repoSource, "ls-tree", "-r", "--name-only", commit],
      { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\n").filter(Boolean).length;
    const actual = countFiles(dest);
    if (!expected || actual < expected * 0.5) {
      rmSync(dest, { recursive: true, force: true }); // grossly incomplete → don't cache a broken tree
      return null;
    }
    writeFileSync(path.join(dest, ".materialized"), `${commit} ${actual}/${expected}\n`);
    return dest;
  } catch {
    rmSync(dest, { recursive: true, force: true });
    return null; // commit not fetched / archive failed → diff-only fallback
  }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2); const n = argv[i + 1];
    if (n === undefined || n.startsWith("--")) a[k] = true; else { a[k] = n; i++; }
  }
  return a;
}

/**
 * Decide an item's outcome from the panel result — NOT from call count. The SDK
 * emits `result` messages even for API/auth/quota errors (is_error, cost 0), so
 * "calls > 0" is NOT proof the review ran. If any applicable lens carries an
 * `infraError` (auth/quota — the reviewer never actually ran), the gate verdict
 * is contaminated (fail-closed to "block"), so the item is an ERROR and must be
 * excluded from reliability, not counted as a real verdict.
 */
export function classifyItemOutcome(panel, calls) {
  const applicable = (Array.isArray(panel) ? panel : []).filter((p) => p && p.applicable);
  const infra = applicable.find((p) => p.infraError);
  if (infra) return { status: "error", reason: "infra", error: { message: infra.infraError, kind: "infra" } };
  if (!calls) return { status: "error", reason: "no-output", error: { message: "panel produced no SDK result messages", kind: "no-output" } };
  return { status: "ok", reason: null, error: null };
}

/** Recompute run totals/counts from the stored (immutable) item envelopes — so
 * resume and finalize are always consistent with what is actually on disk. */
function summarizeRun(store, runId, plannedIds) {
  const totals = { cost_usd: 0, weighted_tokens: 0, raw_tokens: 0, duration_ms: 0, turns: 0 };
  let ok = 0, error = 0, skipped = 0, present = 0;
  for (const itemId of plannedIds) {
    const got = store.getItem(runId, itemId);
    if (!got) continue;
    present++;
    const e = got.envelope;
    if (e.status === "ok") ok++; else if (e.status === "skipped") skipped++; else error++;
    totals.cost_usd += Number(e.cost_usd) || 0;
    totals.weighted_tokens += Number(e.weighted_tokens) || 0;
    totals.raw_tokens += Number(e.raw_tokens) || 0;
    totals.duration_ms += Number(e.duration_ms) || 0;
    totals.turns += Number(e.turns) || 0;
  }
  const status = present === plannedIds.length ? "complete" : "partial";
  return { totals, items_ok: ok, items_error: error, items_skipped: skipped, status };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.out || !args["corpus-version"]) {
    console.error("run.mjs: --out <results-repo> and --corpus-version <v> are required");
    process.exit(2);
  }
  const store = new GitFsStore(args.out);
  const lensesDir = path.resolve(args["lenses-dir"] ?? path.join(HERE, "..", "lenses"));
  const configId = args["config-id"] ?? "baseline-opus-s2";
  const sdkVersion = args["sdk-version"] ?? "0.3.217";
  const corpusVersion = args["corpus-version"];
  const panelScript = path.join(HERE, "..", "review-panel.mjs");
  // Fidelity (a): a local clone to check out repo context from (default: this
  // repo). --no-repo-context forces diff-only replay (empty --repo).
  const repoSource = args["no-repo-context"] ? null : path.resolve(args["repo-source"] ?? path.join(HERE, "..", ".."));
  const repoCache = path.join(tmpdir(), "eval-repo-cache");

  const { manifest, snapshot, config_hash } = buildConfig(lensesDir, {
    configId, sdkVersion, description: args.description ?? "",
  });
  store.putConfig(configId, manifest);

  const corpus = store.getCorpus(corpusVersion);
  if (!corpus) { console.error(`no corpus "${corpusVersion}" in ${args.out}`); process.exit(1); }
  const plannedIds = (args.items ? String(args.items).split(",").map((s) => s.trim()) : corpus.map((c) => c.id));

  const runId = args["run-id"] ?? `${isoSafe()}__${configId}`;
  const matLenses = materializeLenses(snapshot, mkdtempSync(path.join(tmpdir(), "eval-lenses-")));
  const started = nowIso();

  // Initial (partial) run.json + frozen config snapshot.
  store.putRun(runId, {
    runJson: {
      run_id: runId, target: "reviewer", config_id: configId, config_hash,
      corpus_version: corpusVersion, sdk_version: sdkVersion, started, finished: null,
      status: "partial", item_count: plannedIds.length, items_ok: 0, items_error: 0, items_skipped: 0,
      totals: { cost_usd: 0, weighted_tokens: 0, raw_tokens: 0, duration_ms: 0, turns: 0 }, notes: "",
    },
    configSnapshot: snapshot,
  });

  const adapter = reviewerAdapter({ panelScript });
  console.log(`run ${runId}: ${plannedIds.length} item(s), config_hash=${config_hash}`);

  for (const itemId of plannedIds) {
    if (store.hasItem(runId, itemId)) { console.log(`  = ${itemId} (already done, skip)`); continue; }
    const input = store.getCorpusItemInput(itemId);
    if (!input) { console.error(`  ! ${itemId} missing from corpus items, skipping`); continue; }

    const workDir = mkdtempSync(path.join(tmpdir(), "eval-item-"));
    const outDir = path.join(workDir, "out");
    mkdirSync(outDir, { recursive: true });
    // (a) repo context at the review commit; falls back to an empty dir (diff-only).
    const repoDir = materializeRepoAt({ repoSource, commit: input.meta?.review_commit, cacheRoot: repoCache })
      ?? path.join(workDir, "repo");

    let envelope, payload, transcript;
    try {
      const inputs = adapter.prepareInput(input, workDir);
      // Live progress: the panel is silent for minutes, but it writes each lens's
      // `conclusion` file as that lens finishes — poll for them so the terminal
      // shows N/total lenses + elapsed instead of a dead wait.
      const lensIds = snapshot.lenses.map((l) => l.id);
      const started = Date.now();
      const tty = process.stdout.isTTY;
      process.stdout.write(`  → ${itemId}: reviewing (${lensIds.length} lenses × samples)…${tty ? "" : "\n"}`);
      const hb = setInterval(() => {
        const done = lensIds.filter((id) => existsSync(path.join(outDir, id, "conclusion"))).length;
        const secs = Math.round((Date.now() - started) / 1000);
        const msg = `  → ${itemId}: ${done}/${lensIds.length} lenses · ${secs}s`;
        if (tty) process.stdout.write(`\r${msg}   `); else if (secs % 30 === 0) process.stdout.write(`${msg}\n`);
      }, tty ? 2000 : 5000);
      try {
        await adapter.runAgent(inputs, { lensesDir: matLenses, outDir, repoDir, env: process.env });
      } finally {
        clearInterval(hb);
        if (tty) process.stdout.write(`\r${" ".repeat(48)}\r`); // clear the heartbeat line
      }
      const cap = adapter.captureArtifacts(outDir);
      payload = cap.payload;
      transcript = cap.executionMessages;
      const cost = sumExecutions(cap.executionMessages, "review");
      const outcome = classifyItemOutcome(cap.payload.panel, cost.calls);
      envelope = {
        run_id: runId, item_id: itemId, config_hash, corpus_version: corpusVersion,
        status: outcome.status, reason: outcome.reason,
        cost_usd: cost.costUsd, weighted_tokens: cost.weightedTokens, raw_tokens: cost.tokens,
        duration_ms: cost.durationMs, turns: cost.turns, calls: cost.calls,
        timestamp: nowIso(), payload_ref: "payload.json", transcript_ref: "transcript.json.gz",
        error: outcome.error,
      };
    } catch (e) {
      envelope = {
        run_id: runId, item_id: itemId, config_hash, corpus_version: corpusVersion,
        status: "error", reason: "exception", cost_usd: 0, weighted_tokens: 0, raw_tokens: 0,
        duration_ms: 0, turns: 0, calls: 0, timestamp: nowIso(),
        payload_ref: "payload.json", transcript_ref: "transcript.json.gz",
        error: { message: e.message, kind: "exception" },
      };
      payload = { adapter: "reviewer", error: e.message };
      transcript = null;
    }
    store.putItem(runId, itemId, { envelope, payload, transcript });
    console.log(`  ${envelope.status === "ok" ? "+" : "!"} ${itemId}: ${envelope.status} ($${(envelope.cost_usd || 0).toFixed(2)})`);
  }

  const s = summarizeRun(store, runId, plannedIds);
  store.putRun(runId, {
    runJson: {
      run_id: runId, target: "reviewer", config_id: configId, config_hash,
      corpus_version: corpusVersion, sdk_version: sdkVersion, started, finished: nowIso(),
      status: s.status, item_count: plannedIds.length,
      items_ok: s.items_ok, items_error: s.items_error, items_skipped: s.items_skipped,
      totals: s.totals, notes: "",
    },
    configSnapshot: snapshot, // ignored (write-once) — snapshot already frozen
  });
  console.log(`run ${runId}: ${s.status} — ok=${s.items_ok} error=${s.items_error} cost=$${s.totals.cost_usd.toFixed(2)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("runner crashed:", e); process.exit(1); });
}
