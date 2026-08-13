// Issue-category classification for the autonomous issue→PR pipeline.
//
// Applies GitHub labels (type:… always; bugclass:… for verified bug fixes) to
// the agent's PR — or the issue when no PR was produced — and records the full
// JSON behind them as a hidden `<!-- agent-class {json} -->` comment, in the
// same PR ledger metrics.mjs uses for agent run info. Two stages:
//   A) issue text -> Dimension A (type) + spec/test context     (Haiku, cheap)
//   B) PR diff    -> Dimension B (bug class) + localization      (Opus + verify)
// FAIL-SAFE: any error exits 0 so classification can never break the pipeline
// (the workflow step is also continue-on-error).
//
// The gh / PR-resolution / comment-listing helpers are shared from metrics.mjs
// rather than reinvented; only the upsert-a-single-comment behavior (metrics is
// append-only) and the label application are classification-specific.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { gh, ghJson, resolvePrByIssue, listAllComments } from "./vendor/pipeline/metrics.mjs";

const CLASS_PREFIX = "<!-- agent-class ";
const API = "https://api.anthropic.com/v1/messages";
const MODEL_A = "claude-haiku-4-5";
const MODEL_B = "claude-opus-5";

// `max_tokens` bounds thinking AND response text together, and Claude Opus 5
// runs adaptive thinking when the `thinking` parameter is omitted (Opus 4.8 did
// not — omitting it there meant no thinking at all). The previous budget of 400
// was sized for a no-thinking model and would now be consumed before the
// structured record was emitted, truncating the response and throwing in
// `JSON.parse`. Raised rather than disabling thinking: these are analysis calls,
// disabled thinking on Opus 5 carries its own failure modes, and the records
// themselves stay small so the extra ceiling is only ever headroom. MODEL_A
// (Haiku) has no adaptive default and simply never reaches it.
const MAX_TOKENS = 4000;

const TYPE_LABEL = {
  A1: "type:bug-fix", A2: "type:feature", A3: "type:refactor", A4: "type:performance",
  A5: "type:security", A6: "type:testing", A7: "type:build-ci", A8: "type:docs",
};
const BUG_LABEL = {
  B1: "bugclass:logic", B2: "bugclass:interface", B3: "bugclass:memory", B4: "bugclass:concurrency",
  B5: "bugclass:resource", B6: "bugclass:data-input", B7: "bugclass:config",
};
const TYPE_COLOR = "1d76db";
const BUG_COLOR = "d93f0b";

// --- pure helpers (exported for tests; no gh, no network) ------------------

/** One classification record as a self-contained HIDDEN comment. Fields are
 * machine-generated, but strip the terminator defensively so a rationale can
 * never break the parser. */
export function serializeClass(rec) {
  return `${CLASS_PREFIX}${JSON.stringify(rec).replaceAll("-->", "-- >")} -->`;
}

/** Recover the record from a comment body; null if it isn't a class comment. */
export function parseClassComment(body) {
  const m = /<!-- agent-class ([\s\S]*?) -->/.exec(body || "");
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function truncate(s, n) {
  const t = String(s || "");
  return t.length <= n ? t : `${t.slice(0, n)}\n…[truncated]`;
}

/** Localization scope (Dimension C1) from the fix diff. */
/**
 * Pull the structured-output text out of a Messages API response, or throw with
 * a message naming the actual cause.
 *
 * `stop_reason` MUST be inspected BEFORE parsing. A truncated or declined
 * response still arrives as HTTP 200 with a partial or empty `content` array,
 * so parsing first collapses every distinct cause into one opaque
 * `Unexpected end of JSON input`. Both causes became materially more reachable
 * with Claude Opus 5: adaptive thinking draws on the same `max_tokens` budget
 * as the answer, and its safety classifiers can decline a request outright.
 *
 * Deliberately does NOT retry at a larger budget. `classify.mjs` already exits
 * 0 on any error (see `bail`) so the pipeline is never harmed — the actionable
 * output is a log line naming the cause. A retry would double spend on the
 * expensive Opus pass exactly when the model is being verbose, and would break
 * the b1/b2 two-pass agreement check by comparing passes produced under
 * different budgets.
 */
export function extractStructuredText(data, model = "model", maxTokens = 0) {
  const d = data && typeof data === "object" ? data : {};
  if (d.stop_reason === "max_tokens") {
    throw new Error(
      `${model} hit the ${maxTokens}-token budget before finishing the record ` +
        `(stop_reason=max_tokens) — raise MAX_TOKENS; refusing to parse a truncated response`,
    );
  }
  if (d.stop_reason === "refusal") {
    throw new Error(
      `${model} declined the request (stop_reason=refusal, category=${d.stop_details?.category ?? "unknown"})`,
    );
  }
  const text = (Array.isArray(d.content) ? d.content : []).find((b) => b && b.type === "text")?.text;
  if (typeof text !== "string" || text === "") {
    throw new Error(`${model} returned no usable text block (stop_reason=${d.stop_reason ?? "unknown"})`);
  }
  return text;
}

/**
 * How spread out a diff is. Also frozen into a corpus item's
 * `meta.localization_scope` (PR 687), which is what made the deletion case below
 * load-bearing: an item is write-once, so a wrong value there is permanent.
 *
 * `+++ b/<path>` alone does not name every changed file. A DELETION has
 * `+++ /dev/null`, and a pure rename has no `+++` line at all, so both were
 * invisible here — and not merely as `unknown`. A diff of one modified file plus
 * one deleted file in another module counted the deleted file's HUNKS but not the
 * file, and answered `single_file`: a reviewer reading two modules recorded as
 * reading one, which is worse than an honest `unknown` because it is plausible.
 * So the `diff --git a/… b/<path>` header is read too. Adding it unconditionally
 * is safe — for an ordinary modification it names the same path the `+++` line
 * does, and `files` is a Set, so a rename cannot be counted twice either.
 *
 * Still returns `unknown` for a diff that names no path at all, and for one whose
 * paths git C-quoted (`+++ "b/na\303\257ve.ts"`, when a path carries a special or
 * non-ASCII byte): decoding that is `changedFilesFromDiff`'s job in
 * `eval/extract-corpus.mjs` and duplicating it here would fork a second path
 * parser. Documented as the remaining cause of `unknown` in `eval/README.md`.
 */
export function localizationFromDiff(diff) {
  const files = new Set();
  let hunks = 0;
  for (const line of String(diff || "").split("\n")) {
    if (line.startsWith("+++ b/")) files.add(line.slice(6));
    else if (line.startsWith("@@")) hunks++;
    else {
      // Greedy `a/.+` so a path containing " b/" resolves to the LAST one, which
      // is the same rule `changedFilesFromDiff` uses. Quoted headers are skipped
      // deliberately (see above).
      const m = /^diff --git a\/.+ b\/(.+)$/.exec(line);
      if (m) files.add(m[1]);
    }
  }
  if (files.size === 0) return "unknown";
  if (files.size === 1) return hunks <= 1 ? "single_hunk" : "single_file";
  const modules = new Set([...files].map((f) => f.split("/").slice(0, 2).join("/")));
  return modules.size > 1 ? "cross_module" : "multi_file";
}

const A_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    primary_type: { type: "string", enum: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"] },
    secondary_types: { type: "array", items: { type: "string", enum: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"] } },
    spec_quality: { type: "string", enum: ["full", "partial", "underspecified"] },
    test_availability: { type: "string", enum: ["provided", "discoverable", "none"] },
    confidence: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["primary_type", "secondary_types", "spec_quality", "test_availability", "confidence", "rationale"],
};

const B_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bug_class: { type: "string", enum: ["B1", "B2", "B3", "B4", "B5", "B6", "B7"] },
    secondary_classes: { type: "array", items: { type: "string", enum: ["B1", "B2", "B3", "B4", "B5", "B6", "B7"] } },
    confidence: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["bug_class", "secondary_classes", "confidence", "rationale"],
};

const A_SYSTEM =
  "You classify a software issue by the PRIMARY work it asks for. The GitHub label is a hint only; the issue text is authoritative. Output strict JSON.\n" +
  "A1 bug_fix · A2 feature · A3 refactor · A4 performance · A5 security · A6 testing · A7 build_ci_config · A8 documentation.\n" +
  "Pick exactly one primary_type; put any others in secondary_types. spec_quality: full|partial|underspecified. test_availability: provided|discoverable|none. confidence 0-1. rationale <=25 words.";

const B_SYSTEM =
  "You classify the ROOT CAUSE of a fixed bug from the issue + the diff of the accepted fix. Judge from what the fix CHANGED, not just the symptom. Output strict JSON.\n" +
  "B1 logic_semantic · B2 interface_api · B3 memory_safety · B4 concurrency · B5 resource_mgmt · B6 data_input · B7 config_environment.\n" +
  "Adds a lock/atomic -> B4; adds null/bounds/validation guard -> B6 (B3 if memory-unsafe); changes a signature/serialization contract -> B2. One primary bug_class; others in secondary_classes. confidence 0-1. rationale <=25 words.";

const B_SKEPTIC =
  `${B_SYSTEM}\nA prior pass proposed a class. Argue for the single most likely ALTERNATIVE, then return your own best answer.`;

async function callModel(model, system, user, schema) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`messages API ${res.status}`);
  return JSON.parse(extractStructuredText(await res.json(), model, MAX_TOKENS));
}

// --- gh-backed CLI ---------------------------------------------------------

// Classification must NEVER fail the pipeline: log and exit 0 on any problem.
function bail(msg) {
  console.error(`classify: ${msg}`);
  process.exit(0);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 3; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      a[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return a;
}

// Ensure a label exists (idempotent via --force) then leave adding it to the
// caller. Best-effort: a label failure must not abort the run.
function ensureLabel(name, color) {
  try {
    gh(["label", "create", name, "--color", color, "--force"]);
  } catch {
    // label may already exist with different metadata; --force covers it, and
    // any residual failure is non-fatal (the add below still works if present).
  }
}

/** Apply labels to a PR ("pr") or issue ("issue"). `labels` = [[name, color]]. */
function applyLabels(kind, n, labels) {
  for (const [name, color] of labels) ensureLabel(name, color);
  try {
    gh([kind, "edit", String(n), "--add-label", labels.map(([name]) => name).join(",")]);
  } catch (e) {
    console.error(`classify: label add failed on ${kind} #${n}: ${e.message}`);
  }
}

/** Upsert the single hidden class comment (metrics.mjs is append-only; the
 * classification is one fact per PR/issue, so we edit in place instead). */
function upsertClass(n, body) {
  const existing = listAllComments(n).find((c) => (c.body || "").includes(CLASS_PREFIX));
  if (existing) {
    gh(["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${existing.id}`, "-f", `body=${body}`]);
  } else {
    gh(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${n}/comments`, "-f", `body=${body}`]);
  }
}

async function cmdRecord(args) {
  const issue = args.issue;
  if (!issue) return bail("need --issue");
  if (!process.env.ANTHROPIC_API_KEY) return bail("ANTHROPIC_API_KEY unset");

  const iss = ghJson(["issue", "view", issue, "--json", "title,body,labels"]);
  const labels = (iss.labels || []).map((l) => l.name).join(", ");
  const userA = `LABELS: [${labels}]\nTITLE: ${iss.title}\nBODY:\n${truncate(iss.body, 6000)}`;

  const a = await callModel(MODEL_A, A_SYSTEM, userA, A_SCHEMA);
  const rec = { schema: 1, issue: Number(issue), ...a, bug: null, localization_scope: null, verified: null, pr: null };

  const pr = args.pr || resolvePrByIssue(issue);
  if (a.primary_type === "A1" && pr) {
    let diff = "";
    try {
      diff = gh(["pr", "diff", pr]);
    } catch {
      // no diff available — leave bug fields null
    }
    if (diff) {
      const userB = `${userA}\n\nDIFF (truncated):\n${truncate(diff, 8000)}`;
      const b1 = await callModel(MODEL_B, B_SYSTEM, userB, B_SCHEMA);
      const b2 = await callModel(MODEL_B, B_SKEPTIC, userB, B_SCHEMA);
      rec.bug = b1;
      rec.verified = b1.bug_class === b2.bug_class; // two-pass agreement
      rec.localization_scope = localizationFromDiff(diff);
    }
  }
  rec.pr = pr ? Number(pr) : null;

  // Label + store on the PR when there is one (same target the metrics ledger
  // uses); else the issue, so failed/no-PR runs still carry a type: label.
  const kind = pr ? "pr" : "issue";
  const n = pr || issue;
  const labelSet = [[TYPE_LABEL[a.primary_type], TYPE_COLOR]];
  if (rec.bug) labelSet.push([BUG_LABEL[rec.bug.bug_class], BUG_COLOR]);
  applyLabels(kind, n, labelSet);
  upsertClass(n, serializeClass(rec));

  console.error(`classify: labelled ${TYPE_LABEL[a.primary_type]}${rec.bug ? ` + ${BUG_LABEL[rec.bug.bug_class]}` : ""} on ${kind} #${n}`);
}

// Only run the CLI when executed directly (not when imported for tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "record") cmdRecord(parseArgs(process.argv)).catch((e) => bail(e.message));
  else bail(`unknown command: ${cmd}`);
}
