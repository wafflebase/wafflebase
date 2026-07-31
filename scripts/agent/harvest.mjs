// Feedback corpus: the record of when the review panel was WRONG.
//
// Everything else in this pipeline measures effort (metrics.mjs), self-agreement
// (compareSampleAgreement) or process (rounds.mjs). Nothing records OUTCOMES, so
// every tuning decision the panel has ever taken — severity thresholds, sample
// counts, which lens reads which file class — was argued from intuition and two
// or three remembered incidents. `misses.jsonl` is the ledger that makes those
// arguments settleable; this module proposes entries for it.
//
// TWO SIGNATURES, both derived from what GitHub already records:
//
//   1. HUMAN COMMITS AFTER HANDOFF. `mark-ready.mjs` posts a hand-off comment
//      when the panel approves and the PR flips to ready. A human editing
//      REVIEWABLE CODE after that moment is the shape of a missed defect: the
//      panel said "no blocking findings" and a person disagreed with their hands.
//   2. CODERABBIT FINDINGS THE PANEL DID NOT RAISE. An independent reviewer
//      flagging a blocking-severity issue on a PR our panel passed is a second
//      vote that we missed something.
//
// CANDIDATES, NOT FACTS. Both signatures over-fire — humans also push style
// preferences, follow-up scope and rebases, and CodeRabbit is regularly wrong. So
// every record emitted here carries `verifiedBy: ""`, and NOTHING may consume a
// record until a human has put their name there. An auto-harvested, auto-trusted
// corpus is a corpus of noise, and tuning a reviewer against noise is worse than
// not tuning it at all: harvester noise is SYSTEMATIC (it follows whatever the
// matcher over-fires on), so it moves the panel somewhere specific and wrong
// rather than nowhere.
//
// THIS FILE MUST NEVER ENTER A LENS PROMPT — not as few-shot examples, not as
// "here are past misses to watch for". Three independent reasons, any one
// sufficient: it biases lenses toward historical bug shapes when the next defect
// is by definition a new one; it re-grows the prompt that incremental review
// exists to shrink; and it is a verbatim archive of ATTACKER-INFLUENCEABLE TEXT
// (CodeRabbit bodies, contributor commit messages, PR titles from forks). Feeding
// it to a reviewer is prompt injection with a curation step. If it ever must
// reach a model it goes in fenced as DATA, exactly like the diff.
//
// `misses.jsonl` is STRICT JSONL — one JSON object per line, no comment lines and
// no header. A `#` line would be an unreadable line, and an unreadable line makes
// `--append` refuse (below), so the format cannot carry its own documentation.
// It is described in docs/design/harness-engineering.md instead.
//
// FAIL DIRECTIONS, and there are two opposite ones here:
//   - Every READ path degrades to fewer candidates and never throws. A GitHub
//     hiccup costs this run's proposals, not the corpus.
//   - The one WRITE path (`--append`) refuses on any doubt. See `cmdHarvest`:
//     appending to a file we could not fully parse risks duplicating a record
//     whose id we never saw, and duplicate curated records silently double-count
//     in every downstream tally.

import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isFixerCommit } from "./rounds.mjs";
import { classifyFile } from "./review-panel.mjs";
import { HANDOFF_MARKER, hasDisclosureTrailer } from "./disclosure.mjs";
import { normalizeSeverity, BLOCKING, classify } from "./severity.mjs";
import { ORIGINS } from "./novelty.mjs";
import { latestLensRuns, parseReviewState } from "./review-state.mjs";
import { tagPriorFindings, lensCheckNames } from "./prior-findings.mjs";
import { gh, parseArgs, commitCheckRuns, withFullOutput } from "./gh-checks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MISSES_PATH = path.join(HERE, "misses.jsonl");
const LENSES_PATH = path.join(HERE, "lenses", "lenses.json");

/** Record-format version. A consumer that does not know this string must refuse
 *  the record rather than read it optimistically — the fields it would miss are
 *  the ones that decide whether the record counts. */
export const SCHEMA = "wafflebase/miss@1";

/** `miss` = the panel should have raised this. `false-positive` = it should not
 *  have. Both are panel errors and both belong in one corpus: a change that cuts
 *  misses by raising more findings has to pay for it in false positives, and a
 *  corpus holding only one of the two would score that change as pure progress. */
export const LABELS = new Set(["miss", "false-positive"]);

/** How the candidate was found. `manual` is a human writing a record by hand —
 *  the only source that may arrive pre-verified. */
export const SOURCES = new Set(["human-fix", "coderabbit", "manual"]);

/**
 * File classes a panel miss can meaningfully be about.
 *
 * The plan for this module specified a hand-written drop-list (`docs/**`, `*.md`,
 * `.github/**`). Using `classifyFile` instead means the harvester's notion of
 * "reviewable code" cannot drift from the panel's own — the same routing table
 * that decides which lens READS a file now decides which files can carry a miss.
 * A third copy of a glob list is how the second copy rots.
 *
 * Deliberately excludes `policy` even though `scripts/agent/lenses/*.md` and
 * `.github/**` land there: a human editing those after handoff is changing the
 * REVIEWER, which is a different (and often more interesting) event than the
 * reviewer missing a bug. Recording it here would mix the two populations in the
 * one number this corpus exists to produce.
 */
export const REVIEWABLE_CLASSES = new Set(["code", "code-adjacent"]);

// --- pure helpers (exported for tests; no gh) --------------------------------

const str = (v) => (typeof v === "string" ? v : "");

/**
 * Did the agent pipeline produce this PR?
 *
 * Two independent signals, either sufficient, because each has a hole the other
 * covers: the App identity misses PRs a human re-pushed on the agent's behalf,
 * and the branch prefix misses any future kickoff that names branches
 * differently. Both are pipeline conventions rather than guarantees, which is
 * why this is a candidate filter and not a gate.
 *
 * Accepts the two shapes GitHub hands back for the same fact: REST
 * (`user.login: "yorkie-agent[bot]"`) and `gh --json author`
 * (`author.login: "app/yorkie-agent"`).
 */
export function isAgentPr(pr) {
  const p = pr && typeof pr === "object" ? pr : {};
  const login = str(p.user?.login || p.author?.login)
    .replace(/^app\//, "")
    .replace(/\[bot\]$/, "");
  if (login === "yorkie-agent") return true;
  return str(p.head?.ref || p.headRefName).startsWith("agent/");
}

/**
 * When the pipeline handed this PR to humans (ISO string), or null.
 *
 * FIRST marker comment, not the last: a PR that is un-readied and re-promoted has
 * two, and the human work we are looking for starts at the first one.
 *
 * The `readyForReviewAt` fallback is load-bearing rather than belt-and-braces.
 * `mark-ready.mjs` posts the hand-off comment inside a `try/catch` AFTER the PR is
 * already flipped to ready, explicitly so a failed comment cannot fail a
 * successful promotion — which means a genuinely promoted PR can carry no marker
 * at all. Keying only on the comment would make those PRs invisible to the
 * harvester, and invisible is the one failure a corpus cannot recover from later.
 *
 * Returns null when neither is present. Callers must treat null as "cannot
 * classify this PR" and skip it LOUDLY, never as "handed off at time zero" —
 * that would make every commit on the PR a candidate.
 */
export function handoffTime({ comments = [], readyForReviewAt = null } = {}) {
  const marked = (Array.isArray(comments) ? comments : [])
    .filter((c) => str(c?.body).includes(HANDOFF_MARKER))
    .map((c) => str(c?.created_at))
    .filter((t) => t !== "" && Number.isFinite(Date.parse(t)))
    .sort();
  if (marked.length > 0) return marked[0];
  const ready = str(readyForReviewAt);
  return ready !== "" && Number.isFinite(Date.parse(ready)) ? ready : null;
}

/**
 * Is this commit a human fixing something after the panel let the PR through?
 *
 * Four conditions, each excluding a different non-miss:
 *   - lands after `handoffAt` — before it, the panel had not spoken yet;
 *   - single-parent (`isFixerCommit`) — a `git merge main` to resolve conflicts
 *     is not a fix, and it drags in every unrelated file on main;
 *   - no autonomous-disclosure trailer — the review-fix loop's own commits land
 *     after handoff too on a re-opened round, and they are the panel WORKING;
 *   - author is not a Bot.
 *
 * COMMITTER date, not author date: a rebased or cherry-picked commit keeps its
 * original author date, which can predate a handoff it plainly followed.
 *
 * An unattributed commit (no linked GitHub account, `author: null`) counts as
 * human. That direction is deliberate — this emits candidates a person curates,
 * so an extra row costs a moment's reading, while treating unknown as Bot would
 * drop a real miss with nothing to notice it.
 */
export function isHumanFollowupCommit(commit, handoffAt) {
  const c = commit && typeof commit === "object" ? commit : {};
  const cutoff = Date.parse(str(handoffAt));
  if (!Number.isFinite(cutoff)) return false; // no handoff → cannot classify
  const at = Date.parse(str(c.commit?.committer?.date) || str(c.commit?.author?.date));
  if (!Number.isFinite(at) || at <= cutoff) return false;
  if (!isFixerCommit(c)) return false;
  if (hasDisclosureTrailer(c.commit?.message)) return false;
  if (c.author?.type === "Bot") return false;
  return true;
}

/** Repo-relative paths from a commit/PR file list that could carry a panel miss.
 *  Accepts bare strings or GitHub's `{filename}` objects. */
export function interestingFiles(files) {
  const seen = new Set();
  for (const f of Array.isArray(files) ? files : []) {
    const p = typeof f === "string" ? f : str(f?.filename || f?.path);
    if (p !== "" && REVIEWABLE_CLASSES.has(classifyFile(p))) seen.add(p);
  }
  return [...seen].sort();
}

/** Sorted unique file classes for a path list. Kept as a LIST rather than one
 *  scalar: a record spanning `code` and `code-adjacent` is common (a fix plus its
 *  regression test) and collapsing that to "mixed" would lose the slice the
 *  corpus is for. */
export function fileClassesOf(files) {
  return [...new Set((Array.isArray(files) ? files : []).map((f) => classifyFile(f)))].sort();
}

// CodeRabbit on this repo (CHILL profile) opens every inline finding with a
// three-field italic header:  _<category>_ | _<severity>_ | _<effort>_
//
// The plan for this module specified the UPSTREAM CodeRabbit vocabulary instead
// ("Potential issue" / "Refactor suggestion" / "Nitpick"). Nothing in this
// repository has ever emitted those strings — every inline finding back to #525
// uses the header below — so that classifier would have matched zero comments and
// reported an empty corpus as a clean bill of health.
const CR_HEADER = /^\s*_([^_\n]+)_\s*\|\s*_([^_\n]+)_\s*\|\s*_([^_\n]+)_/;

// Only the two categories that map onto a lens WITHOUT judgement. The rest —
// Maintainability, Performance, Stability, Data Integrity — each plausibly belong
// to two of our lenses or to none, and a guessed mapping would corrupt the
// per-lens miss counts this corpus exists to produce. They are harvested with an
// empty `lens` for the curator to assign.
const CR_CATEGORY_TO_LENS = new Map([
  ["functional correctness", "correctness"],
  ["security & privacy", "security"],
]);

/** Strip emoji/punctuation from a CodeRabbit header field, leaving the words. */
const headerWords = (s) =>
  str(s)
    .replace(/[^\p{Letter}\p{Number}&\s-]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Read one CodeRabbit inline comment as a finding, or `null` if it is not one.
 *
 * `null` covers the two things CodeRabbit posts that are not findings: threaded
 * replies to a maintainer ("@user, thanks for the fix…") and its auto-generated
 * walkthroughs. Both lack the header. Returning null on a MISSING header rather
 * than defaulting the severity is the whole reason severities are read only after
 * a header matched: `normalizeSeverity` maps anything unknown to `major`
 * (fail-safe for a gate), so running every reply through it would file each one
 * as a blocking-severity candidate and bury the real ones.
 *
 * Non-blocking severities are dropped. This corpus measures the GATE, and a minor
 * maintainability note our panel also happened not to raise is not a gate
 * failure. Widening to minor is a one-line change if the blocking-only corpus
 * turns out too thin to learn from.
 */
export function classifyCodeRabbitComment(body) {
  const m = CR_HEADER.exec(str(body));
  if (!m) return null;
  const severity = normalizeSeverity(headerWords(m[2]));
  if (!BLOCKING.has(severity)) return null;
  const category = headerWords(m[1]);
  // First bolded line after the header is CodeRabbit's one-line title.
  const title = /\*\*(.+?)\*\*/s.exec(str(body))?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  return { category, severity, lens: CR_CATEGORY_TO_LENS.get(category) ?? "", summary: title };
}

/**
 * Build a corpus record with a STABLE field order.
 *
 * Field order matters because the corpus is a text file people read in diffs and
 * grep by eye; `JSON.stringify` preserves insertion order, so constructing the
 * object in one place is what keeps every line the same shape.
 *
 * `verifiedBy` defaults to `""` and neither harvest path ever passes it. It is
 * the one field that decides whether a record counts, so the harvester must not
 * be able to set it even by accident.
 */
export function toMissRecord(fields) {
  const f = fields && typeof fields === "object" ? fields : {};
  const files = interestingFiles(f.files);
  const prNum = Number.parseInt(String(f.pr ?? ""), 10);
  const saw = f.panelSaw && typeof f.panelSaw === "object" ? f.panelSaw : {};
  return {
    schema: SCHEMA,
    id: str(f.id),
    label: LABELS.has(f.label) ? f.label : "miss",
    source: SOURCES.has(f.source) ? f.source : "manual",
    pr: Number.isFinite(prNum) ? prNum : 0,
    handoffAt: str(f.handoffAt),
    evidence: {
      commitSha: str(f.evidence?.commitSha),
      commentId: str(f.evidence?.commentId),
      url: str(f.evidence?.url),
    },
    files,
    fileClasses: fileClassesOf(files),
    lens: str(f.lens),
    severity: f.severity == null || f.severity === "" ? "" : normalizeSeverity(f.severity),
    origin: ORIGINS.includes(f.origin) ? f.origin : "unknown",
    summary: str(f.summary),
    panelSaw: {
      reviewedSha: str(saw.reviewedSha),
      conclusion: str(saw.conclusion),
      blockingFindings: Number.isFinite(Number(saw.blockingFindings)) ? Number(saw.blockingFindings) : 0,
    },
    verifiedBy: str(f.verifiedBy),
    notes: str(f.notes),
  };
}

/**
 * Stable id for a candidate, so re-harvesting the same window is idempotent.
 *
 * `evidence` is stringified rather than required to be a string: GitHub returns
 * comment ids as NUMBERS, and a `typeof v === "string"` coercion turned every
 * CodeRabbit candidate on a PR into the same id (`coderabbit:548:`) — which
 * `dedupeById` would then collapse to one, silently discarding every finding
 * after the first.
 */
export function candidateId(source, pr, evidence) {
  return `${source}:${pr}:${evidence ?? ""}`;
}

/**
 * Parse JSONL, reporting every line it could not read.
 *
 * A corrupt line is NOT swallowed. This file is an eval set: silently dropping a
 * curated record makes every measurement taken against it quietly wrong, which is
 * strictly worse than a loud tool. But throwing would make one bad byte block all
 * reads, so the damage is reported and the caller decides — and `--append`
 * decides to refuse.
 */
export function parseJsonl(text, { log = () => {} } = {}) {
  const records = [];
  let bad = 0;
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    try {
      const parsed = JSON.parse(line);
      // A line that parses to `7`, `"x"` or `[…]` is valid JSON and an invalid
      // RECORD. Keeping it would put a number in the corpus that every consumer
      // then has to defend against; counting it as unreadable makes it visible
      // and makes `--append` refuse until someone looks.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("line is valid JSON but not a record object");
      }
      records.push(parsed);
    } catch (err) {
      bad++;
      log(`misses.jsonl line ${i + 1}: ${err.message}`);
    }
  }
  return { records, bad };
}

/** One record per line, trailing newline — append-safe. */
export function serializeJsonl(records) {
  const arr = (Array.isArray(records) ? records : []).filter((r) => r && typeof r === "object");
  return arr.length === 0 ? "" : arr.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/**
 * Drop records whose `id` was already seen. FIRST occurrence wins, and that
 * direction is load-bearing: existing curated records are passed ahead of fresh
 * candidates, so a re-harvest can never overwrite a human's `verifiedBy` with a
 * blank one. Records without an id are kept as-is (hand-written rows are not
 * required to have one, and dropping them would delete curation).
 */
export function dedupeById(records) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== "object") continue;
    const id = str(r.id);
    if (id === "") {
      out.push(r);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

/**
 * What the panel concluded on a given commit: `{reviewedSha, conclusion,
 * blockingFindings}`.
 *
 * `reviewedSha` comes from the lens run's `external_id` (incremental review's
 * state pointer) rather than from the commit the run is attached to, because on a
 * narrowed round those differ — the run hangs off the head commit while the
 * verdict covers only the delta. The commit sha is the fallback.
 *
 * `conclusion` is the AGGREGATE: `failure` if any lens failed, `success` only if
 * at least one ran and none failed, `""` if none ran. Aggregate rather than
 * per-lens because the question a miss record asks is "did the panel let this
 * through", and one failing lens means it did not.
 */
export function panelVerdictAt(runsByLens) {
  const runs = runsByLens instanceof Map ? runsByLens : new Map(Object.entries(runsByLens ?? {}));
  const findings = tagPriorFindings(runs);
  const conclusions = [...runs.values()].map((r) => str(r?.conclusion));
  const conclusion =
    conclusions.length === 0 ? "" : conclusions.includes("failure") ? "failure" : "success";
  // `parseReviewState` rather than a local JSON.parse: it validates the version,
  // the 40-hex shape and the mode, and returns null for ANY doubt. A hand-rolled
  // parse here would happily record `{"reviewed":"main"}` as the sha the panel
  // reviewed — a corpus field that is wrong is worse than one that is empty.
  let reviewedSha = "";
  for (const r of runs.values()) {
    const state = parseReviewState(str(r?.external_id));
    if (state) {
      reviewedSha = state.reviewed;
      break;
    }
  }
  return { reviewedSha, conclusion, blockingFindings: classify(findings).blockingCount };
}

// --- gh-backed collection ----------------------------------------------------

/** All issue comments on a PR, every page. Object-wrapped-endpoint rules do not
 *  apply here: `issues/{n}/comments` is a bare array, so plain `--paginate` is
 *  correct (see gh-checks.mjs for the endpoint that is not). */
function listComments(pr, api) {
  const out = api(["api", "--paginate", `repos/{owner}/{repo}/issues/${pr}/comments?per_page=100`]);
  return Array.isArray(out) ? out : [];
}

function listReviewComments(pr, api) {
  const out = api(["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/comments?per_page=100`]);
  return Array.isArray(out) ? out : [];
}

function listCommits(pr, api) {
  const out = api(["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/commits?per_page=100`]);
  return Array.isArray(out) ? out : [];
}

function commitFiles(sha, api) {
  const out = api(["api", `repos/{owner}/{repo}/commits/${sha}`]);
  return Array.isArray(out?.files) ? out.files : [];
}

/** The `ready_for_review` timeline event's timestamp, or "". */
function readyForReviewAt(pr, api) {
  const events = api(["api", "--paginate", `repos/{owner}/{repo}/issues/${pr}/timeline?per_page=100`]);
  const hit = (Array.isArray(events) ? events : []).find((e) => e?.event === "ready_for_review");
  return str(hit?.created_at);
}

/**
 * Propose miss records for one PR. NEVER throws: every collection step is
 * individually caught and degrades to fewer candidates.
 *
 * Returns `{records, skipped}` — `skipped` is a human-readable reason when the PR
 * could not be examined at all, so the CLI can say WHY a PR produced nothing.
 * "Zero candidates" and "could not look" must never print the same way; the whole
 * point of the corpus is that an empty result is a claim, not a default.
 */
export function harvestPr(pr, { api = gh, log = console.error, names = [] } = {}) {
  const records = [];
  let meta;
  try {
    meta = api(["api", `repos/{owner}/{repo}/pulls/${pr}`]);
  } catch (err) {
    return { records, skipped: `could not read PR #${pr} (${err.message})` };
  }
  if (!isAgentPr(meta)) return { records, skipped: `#${pr} is not an agent PR` };

  let comments = [];
  try {
    comments = listComments(pr, api);
  } catch (err) {
    log(`#${pr}: could not list comments (${err.message}); trying the timeline only.`);
  }
  let ready = "";
  try {
    ready = readyForReviewAt(pr, api);
  } catch (err) {
    log(`#${pr}: could not read the timeline (${err.message}).`);
  }
  const handoffAt = handoffTime({ comments, readyForReviewAt: ready });
  if (!handoffAt) {
    return { records, skipped: `#${pr} has no hand-off marker and no ready_for_review event` };
  }

  // The verdict that LET THE PR THROUGH: the newest lens runs on or before the
  // handoff. Runs from later rounds would describe a panel that had already seen
  // the human's fix.
  let prCommits = [];
  try {
    prCommits = listCommits(pr, api);
  } catch (err) {
    log(`#${pr}: could not list commits (${err.message}); no human-fix candidates from this PR.`);
  }
  const cutoff = Date.parse(handoffAt);
  const beforeHandoff = prCommits.filter((c) => {
    const at = Date.parse(str(c?.commit?.committer?.date));
    return Number.isFinite(at) && at <= cutoff;
  });
  const headAtHandoff = beforeHandoff[beforeHandoff.length - 1] ?? prCommits[prCommits.length - 1];

  // The sha is known for certain the moment we have the commit list, so it is
  // recorded OUTSIDE the check-run fetch. Only `conclusion` and
  // `blockingFindings` depend on the API call, and leaving those empty while the
  // sha is present says exactly what happened: we know which commit the panel was
  // looking at and we could not read what it concluded. Collapsing both into ""
  // would make an API hiccup indistinguishable from a PR with no panel at all.
  let panelSaw = { reviewedSha: str(headAtHandoff?.sha), conclusion: "", blockingFindings: 0 };
  if (headAtHandoff?.sha) {
    try {
      const runs = commitCheckRuns(headAtHandoff.sha, { api });
      const verdict = panelVerdictAt(withFullOutput(latestLensRuns(runs, names), { api, log }));
      panelSaw = { ...verdict, reviewedSha: verdict.reviewedSha || headAtHandoff.sha };
    } catch (err) {
      log(`#${pr}: could not read the panel's verdict (${err.message}); recording it as unknown.`);
    }
  }

  // Signature 1 — human commits after handoff.
  for (const c of prCommits) {
    if (!isHumanFollowupCommit(c, handoffAt)) continue;
    let files = [];
    try {
      files = interestingFiles(commitFiles(c.sha, api));
    } catch (err) {
      log(`#${pr}: could not read files for ${c.sha} (${err.message}); skipping that commit.`);
      continue;
    }
    if (files.length === 0) continue; // docs/policy-only follow-up: not a missed bug
    records.push(
      toMissRecord({
        id: candidateId("human-fix", pr, c.sha),
        label: "miss",
        source: "human-fix",
        pr,
        handoffAt,
        evidence: { commitSha: c.sha, url: str(c.html_url) },
        files,
        summary: str(c.commit?.message).split("\n")[0],
        panelSaw,
        notes: "candidate: a human changed reviewable code after the panel approved",
      }),
    );
  }

  // Signature 2 — CodeRabbit findings the panel did not raise.
  let reviewComments = [];
  try {
    reviewComments = listReviewComments(pr, api);
  } catch (err) {
    log(`#${pr}: could not list review comments (${err.message}).`);
  }
  for (const rc of reviewComments) {
    if (!str(rc?.user?.login).startsWith("coderabbitai")) continue;
    const finding = classifyCodeRabbitComment(rc.body);
    if (!finding) continue;
    const files = interestingFiles([str(rc.path)]);
    if (files.length === 0) continue;
    records.push(
      toMissRecord({
        id: candidateId("coderabbit", pr, rc.id),
        label: "miss",
        source: "coderabbit",
        pr,
        handoffAt,
        evidence: {
          commitSha: str(rc.original_commit_id || rc.commit_id),
          commentId: String(rc.id ?? ""),
          url: str(rc.html_url),
        },
        files,
        lens: finding.lens,
        severity: finding.severity,
        summary: finding.summary,
        panelSaw,
        notes: `candidate: CodeRabbit raised a ${finding.severity} ${finding.category} finding`,
      }),
    );
  }
  return { records, skipped: "" };
}

// --- CLI ---------------------------------------------------------------------

function loadLensNames() {
  try {
    return lensCheckNames(JSON.parse(readFileSync(LENSES_PATH, "utf8")));
  } catch (err) {
    console.error(`harvest: could not read ${LENSES_PATH} (${err.message}); panelSaw will be empty.`);
    return [];
  }
}

/**
 * Merged agent PRs to examine. `--since` is passed straight to GitHub's search
 * rather than filtered client-side, so a wide window does not silently truncate
 * at the page limit.
 */
function listCandidatePrs({ since, api }) {
  const search = since ? `merged:>=${since}` : "";
  const argv = ["pr", "list", "--state", "merged", "--limit", "200", "--json", "number,headRefName,author"];
  if (search) argv.push("--search", search);
  const prs = api(argv);
  return (Array.isArray(prs) ? prs : []).filter(isAgentPr).map((p) => p.number);
}

function cmdHarvest(args) {
  const api = (a) => JSON.parse(execFileSync("gh", a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
  const names = loadLensNames();
  let prs;
  if (args.pr) {
    prs = [String(args.pr)];
  } else {
    try {
      prs = listCandidatePrs({ since: args.since, api });
    } catch (err) {
      // Operational failure exits 0 (see the header): this may run on a schedule,
      // and a GitHub outage must not page anyone. A USAGE error still exits 2 —
      // the precedent metrics.mjs and prior-findings.mjs both set — because a
      // typo'd flag that exits 0 does nothing and says it succeeded.
      console.error(`harvest: could not list PRs (${err.message}); nothing harvested.`);
      process.exit(0);
    }
  }

  const found = [];
  for (const pr of prs) {
    const { records, skipped } = harvestPr(pr, { api, names });
    if (skipped) console.error(`harvest: skipped ${skipped}`);
    found.push(...records);
  }

  const existingText = existsSync(MISSES_PATH) ? readFileSync(MISSES_PATH, "utf8") : "";
  const { records: existing, bad } = parseJsonl(existingText, { log: (m) => console.error(`harvest: ${m}`) });
  const known = new Set(existing.map((r) => str(r?.id)).filter((id) => id !== ""));
  const fresh = dedupeById(found.filter((r) => !known.has(r.id)));

  if (!args.append) {
    process.stdout.write(serializeJsonl(fresh));
    console.error(
      `harvest: ${fresh.length} new candidate(s) across ${prs.length} PR(s); ` +
        `${existing.length} already recorded. Print-only — pass --append to write.`,
    );
    return;
  }

  // The one write path, and it refuses on any doubt. An unparseable line means we
  // do not know every id already in the file, so appending could duplicate a
  // curated record — and a duplicate double-counts in every tally taken against
  // the corpus, silently, forever.
  if (bad > 0) {
    console.error(
      `harvest: refusing to append — ${bad} unreadable line(s) in ${MISSES_PATH}. ` +
        `Fix them first; appending against a partial read can duplicate a curated record.`,
    );
    process.exit(0);
  }
  if (fresh.length === 0) {
    console.error(`harvest: nothing new to append (${existing.length} already recorded).`);
    return;
  }
  try {
    appendFileSync(MISSES_PATH, serializeJsonl(fresh));
  } catch (err) {
    console.error(`harvest: could not append to ${MISSES_PATH} (${err.message}).`);
    process.exit(0);
  }
  console.error(
    `harvest: appended ${fresh.length} candidate(s) to ${MISSES_PATH}. ` +
      `Every one has verifiedBy:"" — curate before anything reads them.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv, { booleans: ["append"] });
  if (args.pr !== undefined && !/^\d+$/.test(String(args.pr))) {
    console.error("harvest: --pr takes a PR number");
    process.exit(2);
  }
  if (args.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.since))) {
    console.error("harvest: --since takes an ISO date (YYYY-MM-DD)");
    process.exit(2);
  }
  cmdHarvest(args);
}
