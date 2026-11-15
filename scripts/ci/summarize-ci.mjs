// Render CI's lane reports into the block the CI-fix agent is shown first.
//
// WHO CALLS IT. The shared agent harness's `agent-iterate-ci.yml` (yorkie's
// core, which wafflebase is moving onto) downloads the artifact `ci.yml`
// uploads as `ci-lane-reports` and runs
//
//   node <main's copy of scripts>/ci/summarize-ci.mjs --dir <the download>
//
// from a copy of main's `scripts/` taken before the branch checkout. The name,
// the path and the flag are that workflow's, not this repository's choice
// (`.github/agent-harness/config.json` sets `ci.laneReports` to say the
// artifact exists). Until the switch, today's `agent-iterate-ci.yml` still runs
// `scripts/agent/summarize-ci.mjs` on the `harness-reports` artifact; both
// read the same files.
//
// THE CONTRACT IS "SAY NOTHING OR SAY SOMETHING USEFUL". This prints nothing
// on stdout and exits 3 unless a lane FAILED — including when the reports are
// missing, unreadable, or describe a run that died before any lane ran. The
// caller keys its fallback off exactly that: an empty capture means the failed
// step's log (`gh run view --log-failed`) is the better diagnosis. A note about
// why goes to stderr, which the caller leaves in its own log.
//
// THE REPORTS are what `scripts/verify-self.mjs` writes to `.harness-reports/`:
//   summary.json                 { overall, lanesTotal, lanes: [{ lane, status, durationMs }] }
//   <lane, ":" as "-">.json      { lane, status, durationMs, exitCode, failureSummary }
// The artifact may hold them at its root or under `.harness-reports/`
// (`ci-report.yml` reads both), so both are looked in.
//
// BOUNDED. The block is cut at `MAX_BLOCK_CHARS`; the lane table and the
// failing lanes come first, so a cut drops the least important part.
//
// Usage: node scripts/ci/summarize-ci.mjs [--dir <path>] [--max-chars <n>]
//   (default dir `.harness-reports`, relative to the working directory)

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "[ci:summarize]";

/** Exit code for "there is nothing here worth rendering". */
export const NOTHING_TO_RENDER = 3;

/** How large the rendered block may get, in characters. */
export const MAX_BLOCK_CHARS = 8000;

/** How much of one lane's failure summary is rendered. */
export const MAX_SUMMARY_CHARS = 3000;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The report file name `verify-self.mjs` gives a lane. */
export const laneFileName = (lane) => `${String(lane).replaceAll(":", "-")}.json`;

/**
 * Read `summary.json` and the failing lanes' reports from `dir`, or from its
 * `.harness-reports/` when the artifact kept that directory. A missing or
 * unparseable file is not an error: it is a report that does not exist.
 *
 * @returns {{ summary: object|null, reports: Map<string, object> }}
 */
export function loadReports(dir) {
  for (const base of [dir, path.join(dir, ".harness-reports")]) {
    const summary = readJson(path.join(base, "summary.json"));
    if (summary === null || typeof summary !== "object" || Array.isArray(summary)) continue;
    const reports = new Map();
    const lanes = Array.isArray(summary.lanes) ? summary.lanes : [];
    for (const row of lanes) {
      if (row?.status !== "fail" || typeof row.lane !== "string") continue;
      // A lane name is written by verify-self.mjs, but read here from an
      // artifact: never let it name a file outside the report directory.
      const name = laneFileName(row.lane);
      if (name !== path.basename(name) || name.startsWith(".")) continue;
      const report = readJson(path.join(base, name));
      if (report && typeof report === "object") reports.set(row.lane, report);
    }
    return { summary, reports };
  }
  return { summary: null, reports: new Map() };
}

const ICON = { pass: "✅", fail: "❌", skip: "⏭️", filtered: "⚪" };

const seconds = (ms) => (typeof ms === "number" && ms > 0 ? `${(ms / 1000).toFixed(1)}s` : "");

/** Escape what would break out of a markdown table cell. */
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\r?\n|\r/g, " ");

/** The same, for text inside a one-line code span: no backtick to close it early. */
const span = (text) => cell(text).replace(/`/g, "'");

/**
 * `block` with a fence it leaves open closed again. A cut can land inside a
 * fenced failure summary, and an open fence would swallow everything the
 * caller writes after the block — the closing tag of the diagnosis and the
 * instructions that follow it — into one code block.
 */
export function closeOpenFence(block) {
  let open = null;
  // CommonMark: a fence may be indented by up to three spaces.
  for (const line of block.split("\n")) {
    const m = /^ {0,3}(`{3,})/.exec(line);
    if (!m) continue;
    if (open === null) open = m[1];
    else if (m[1].length >= open.length && line.trim() === m[1]) open = null;
  }
  return open === null ? block : `${block}\n${open}`;
}

/** A fence long enough to survive a body that contains one. */
function fence(body) {
  let ticks = "```";
  while (body.includes(ticks)) ticks += "`";
  return `${ticks}\n${body}\n${ticks}`;
}

function clip(text, max) {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max)}\n…(${s.length - max} characters omitted)…`;
}

/** `summary.lanesTotal` when it is a count, else the number of rows: the artifact is the branch's. */
const laneTotal = (summary, rows) =>
  Number.isInteger(summary.lanesTotal) && summary.lanesTotal >= 0 ? summary.lanesTotal : rows.length;

/**
 * The block, or `""` when no lane failed.
 *
 * @param {{ summary: object|null, reports: Map<string, object> }} reading
 */
export function renderDiagnosis(reading, { maxChars = MAX_BLOCK_CHARS } = {}) {
  const { summary, reports } = reading;
  const rows = Array.isArray(summary?.lanes) ? summary.lanes.filter((r) => r && typeof r === "object") : [];
  const failed = rows.filter((r) => r.status === "fail");
  if (failed.length === 0) return "";

  const count = (status) => rows.filter((r) => r.status === status).length;
  const out = [];
  out.push("## CI lane report (`verify:self`)");
  out.push("");
  out.push(
    `${failed.length} failed, ${count("pass")} passed, ${count("skip")} skipped (an earlier lane failed), ` +
      `${count("filtered")} filtered (not applicable to this change), of ${laneTotal(summary, rows)}.`,
  );
  out.push("");
  out.push("| | lane | status | time |");
  out.push("| --- | --- | --- | --- |");
  for (const row of rows) {
    out.push(`| ${ICON[row.status] ?? ""} | \`${span(row.lane)}\` | ${cell(row.status)} | ${seconds(row.durationMs)} |`);
  }

  // Lanes run in order and stop at the first failure, so the first failed
  // lane is the root cause; the ones after it were skipped, not broken.
  for (const row of failed) {
    const report = reports.get(row.lane);
    out.push("");
    out.push(`### Failed lane: \`${span(row.lane)}\` (exit ${cell(report?.exitCode ?? "?")})`);
    out.push("");
    out.push(fence(clip(report?.failureSummary ?? "(no failure summary captured)", MAX_SUMMARY_CHARS)));
  }
  const skipped = rows.filter((r) => r.status === "skip");
  if (skipped.length > 0) {
    out.push("");
    out.push(
      `${skipped.length} lane(s) after it were skipped because an earlier lane failed; ` +
        "they are not independently broken.",
    );
  }
  out.push("");
  out.push("Reproduce with `pnpm verify:self`, or the failing lane's own command from `scripts/verify-self.mjs`.");

  const block = out.join("\n");
  if (block.length <= maxChars) return block;
  return `${closeOpenFence(block.slice(0, maxChars))}\n…(diagnosis truncated at ${maxChars} characters)…`;
}

/** Parse the command line: `{ dir, maxChars }`, or `{ error }`. */
export function parseArgs(args) {
  let dir = ".harness-reports";
  let maxChars = MAX_BLOCK_CHARS;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dir" && i + 1 < args.length) dir = args[++i];
    else if (arg.startsWith("--dir=")) dir = arg.slice("--dir=".length);
    else if (arg === "--max-chars" && i + 1 < args.length) maxChars = Number(args[++i]);
    else return { error: `unknown or incomplete option ${arg}` };
  }
  if (dir === "") return { error: "--dir is empty" };
  if (!Number.isInteger(maxChars) || maxChars <= 0) return { error: "--max-chars is not a positive integer" };
  return { dir, maxChars };
}

/**
 * Was this file run, or imported? Both sides through `realpath`: a script run
 * by a symlinked path (`/tmp` on macOS) would otherwise compare unequal and
 * silently do nothing.
 */
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(`${PREFIX} ${parsed.error}`);
    console.error(`${PREFIX} usage: summarize-ci.mjs [--dir <path>] [--max-chars <n>]`);
    process.exitCode = 2;
  } else {
    const dir = path.resolve(process.cwd(), parsed.dir);
    const block = renderDiagnosis(loadReports(dir), { maxChars: parsed.maxChars });
    if (block) {
      process.stdout.write(`${block}\n`);
    } else {
      // STDERR, so the caller's `$(…)` capture stays empty and its fallback fires.
      console.error(`${PREFIX} no failing lane in ${dir}; nothing to render.`);
      process.exitCode = NOTHING_TO_RENDER;
    }
  }
}
