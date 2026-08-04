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

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSingleParentCommit } from "./rounds.mjs";
import { classifyFile } from "./review-panel.mjs";
import { HANDOFF_MARKER, hasDisclosureTrailer } from "./disclosure.mjs";
import { normalizeSeverity, BLOCKING, classify } from "./severity.mjs";
import { ORIGINS } from "./novelty.mjs";
import { latestLensRuns, parseReviewState } from "./review-state.mjs";
import { tagPriorFindings, lensCheckNames } from "./prior-findings.mjs";
import { bestMatch } from "./finding-match.mjs";
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
 *   - single-parent (`isSingleParentCommit`) — a `git merge main` to resolve conflicts
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
  if (!isSingleParentCommit(c)) return false;
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

/** The bot's login, in the two shapes GitHub returns it. */
const CODERABBIT_LOGINS = new Set(["coderabbitai[bot]", "app/coderabbitai"]);

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
  return {
    category,
    severity,
    lens: CR_CATEGORY_TO_LENS.get(category) ?? "",
    summary: title,
    detail: codeRabbitDetail(body),
  };
}

// Where a CodeRabbit body stops being prose. Verified against every inline
// finding on #548, #594 and #639: the body is always header → bolded title →
// prose → structured blocks, and prose never resumes after the first block.
const CR_PROSE_END = /^[ \t]*(?:<details>|```|<!--)/m;

/**
 * The part of a CodeRabbit comment worth comparing as TEXT: the title plus the
 * prose under it, stopping at the first `<details>`, fence or HTML comment.
 *
 * Two failure modes sit either side of this, and the boundary is what avoids both.
 *
 * The title ALONE is too thin. `summaryTokens` reduces a real one — "Guard public
 * mutation APIs at the read-only boundary." — to six tokens, and `findingSimilarity`
 * scores containment over the SMALLER token set, so two incidentally shared words
 * would clear the 0.3 bar. (`tokenOverlap` keeps `MIN_SHARED_TOKENS` for the same
 * reason; this is the other half of that defence.)
 *
 * The WHOLE body is worse, and worse in the dangerous direction. Every comment ends
 * with a `🤖 Prompt for AI Agents` block opening with the same boilerplate sentence
 * — "Verify each finding against current code. Fix only still-valid issues…" —
 * which alone contributes `code`, `fix`, `issues`, `changes`, `validate` to every
 * single comparison, plus committable-suggestion blocks that dump literal source.
 * Against a ~15-token panel summary that inflates containment on the vocabulary
 * every finding in the file already shares, producing false matches exactly where
 * the panel had the most findings — i.e. eating real misses where they are densest.
 *
 * The full body still reaches the ANCHOR layer (harvestPr passes it as `evidence`),
 * because `extractAnchor` mines structured items — backticked identifiers, the
 * `around lines N - M` range — where more text is strictly better.
 */
export function codeRabbitDetail(body) {
  const text = str(body);
  const cut = text.search(CR_PROSE_END);
  return (cut === -1 ? text : text.slice(0, cut))
    .replace(CR_HEADER, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- the panel's findings, as posted on a human PR ---------------------------
//
// `@claude review` runs the SAME lens panel on a human PR, and records no check
// runs at all — agent-review-on-demand.yml says so four times over ("purely
// advisory: it records NO check runs", `checks: read` and never `checks: write`).
// Its findings exist only as markdown in the comment it posts. `panelVerdictAt`
// reads check runs exclusively, so that entire population was invisible here: 14
// PRs carrying 1-38 blocking findings each, against 27 PRs' worth of CodeRabbit
// blockers, none of it reachable.
//
// So this reads the comment. It is a SECOND source for the same fact, not a
// replacement — `harvestPr` prefers check runs where they exist, because they are
// structured JSON rather than a rendering of it, and falls back to this.

/** The machine anchor `agent-review-on-demand.yml` writes as the comment's first
 *  line. The sha is the commit the panel actually reviewed. */
const PANEL_COMMENT_RE = /^<!--\s*agent-review:([0-9a-f]{40})\s*-->/;

/** The searchable substring of that anchor, used by `listCandidatePrs` to find the
 *  PRs a panel reviewed on demand. Kept beside the regex it belongs to so the two
 *  cannot drift; GitHub's comment search cannot express the sha, and does not need
 *  to — `parsePanelComment` re-checks the full anchor and the author on read. */
const PANEL_COMMENT_TAG = "agent-review:";

/**
 * Who may author a panel comment. EXACT logins, and this is a security gate, not
 * tidiness — the same discipline as `CODERABBIT_LOGINS`, for a sharper reason.
 *
 * Findings parsed here can SUPPRESS a CodeRabbit candidate. So anyone able to
 * forge a panel comment could silence real misses by posting text that matches
 * them — a deletion with no trace in the corpus. Matching on the marker alone is
 * not enough: any user can write that HTML comment. It must come from the App.
 *
 * Not hypothetical at this parse level: #578 carries a CODERABBIT comment whose
 * body contains "Review panel", so a content-only match already mis-fires on real
 * data before anyone tries.
 */
const PANEL_LOGINS = new Set(["yorkie-agent[bot]", "app/yorkie-agent"]);

// `renderSummaryMd` emits `### <heading> (<n>)` then one `- ` row per finding.
// Only the two BLOCKING headings are read; `Minor (non-blocking)`,
// `Nit (non-blocking)` and the demoted section all terminate a run of rows.
const PANEL_SECTION_RE = /^###\s+(Critical|Major|Minor|Nit|Demoted)\b/;
const PANEL_LENS_RE = /review:\s+\*\*/;
// `- \`file\` — summary`, the shape `section()` writes when a finding has a file.
// The em-dash is what `section()` emits; en-dash and hyphen are tolerated because
// this is a rendering being read back, not a wire format.
const PANEL_FINDING_RE = /^[-*]\s+`([^`]+)`\s*[—–-]\s*(.+)$/;

/**
 * Blocking findings from one panel comment body, or `null` if it is not one.
 *
 * Blocking ONLY, for the same reason `panelVerdictAt` filters: a CodeRabbit
 * blocker "already raised" by a minor note is not a gate hit, and suppressing it
 * on that basis would hide a real miss behind a passing remark.
 *
 * The trailing `_(verifier could not settle this)_` marker and the `<details>`
 * block of merged wordings are left in the summary text rather than stripped. They
 * are words the panel wrote about this finding, `summaryTokens` discards the
 * punctuation, and a stripper is one more thing to keep in step with the renderer.
 *
 * `file` keeps the rendered locator with any `:line` suffix removed, and the whole
 * locator is repeated into `evidence` so `extractAnchor` still sees the line
 * numbers — they are the sharpest location signal in the row.
 */
export function parsePanelComment(body) {
  const text = str(body);
  const m = PANEL_COMMENT_RE.exec(text);
  if (!m) return null;
  const findings = [];
  let severity = null;
  for (const line of text.split("\n")) {
    // A new lens's verdict line ends the previous lens's last section.
    if (PANEL_LENS_RE.test(line)) { severity = null; continue; }
    const sec = PANEL_SECTION_RE.exec(line);
    if (sec) {
      const h = sec[1].toLowerCase();
      severity = h === "critical" || h === "major" ? h : null;
      continue;
    }
    if (/^###/.test(line)) { severity = null; continue; }
    if (severity === null) continue;
    const row = PANEL_FINDING_RE.exec(line);
    if (!row) continue;
    const locator = row[1];
    findings.push({
      severity,
      file: locator.replace(/:[\d\s\-–—]+$/, ""),
      summary: row[2].trim(),
      evidence: `at ${locator}`,
    });
  }
  return { reviewedSha: m[1], findings };
}

/**
 * The panel's blocking findings across every on-demand review on this PR, or
 * `null` if it was never reviewed that way.
 *
 * The UNION of all reviews, not the newest. The record's claim is "the panel did
 * not raise this", and a finding the panel raised in an earlier review is one the
 * panel raised — filing it as a miss would put a false row in an eval corpus,
 * which this module's header calls worse than not tuning at all. That direction
 * does widen the suppression surface, which is why every suppression is counted
 * and logged with the finding it matched.
 */
export function panelFindingsFromComments(comments) {
  let seen = false;
  let reviewedSha = "";
  const findings = [];
  for (const c of Array.isArray(comments) ? comments : []) {
    if (!PANEL_LOGINS.has(str(c?.user?.login))) continue;
    const parsed = parsePanelComment(c?.body);
    if (!parsed) continue;
    seen = true;
    if (!reviewedSha) reviewedSha = parsed.reviewedSha;
    findings.push(...parsed.findings);
  }
  return seen ? { reviewedSha, findings } : null;
}

/** Verdicts `attributeToPanel` can reach. `""` is a fourth state and means the
 *  question was never asked — see `attributeToPanel`. */
export const MATCH_VERDICTS = new Set(["match", "maybe", "no"]);

/**
 * Did the panel already raise this CodeRabbit finding, in different words?
 *
 * `blockers` is the panel's blocking findings, or `null` when we could not
 * establish them (no readable check runs). Those are different questions and get
 * different answers: `null` yields verdict `""` — "not asked" — which emits the
 * candidate exactly as this module did before matching existed. An empty ARRAY is
 * a real answer: the panel raised nothing blocking, so a CodeRabbit blocker is by
 * definition unmatched.
 *
 * Both sides are compared LENS-NEUTRAL. CodeRabbit's lens is a category→lens guess
 * that is often `""`, and `findingSimilarity` scores any lens mismatch 0 outright.
 * `clusterFindings` already solved this upstream with a `{ ...f, lens: "" }` copy;
 * this is the same move, not a second one. The deeper reason is that a defect the
 * panel raised under a DIFFERENT lens is still a defect the panel raised.
 *
 * FAIL DIRECTION — `maybe`, deliberately in the middle. Suppressing on error would
 * silently drop a real miss, which is the one loss this corpus cannot recover
 * later; emitting unflagged would restore the noise the matcher exists to remove.
 * `maybe` honours "never throw" without choosing either.
 */
export function attributeToPanel(finding, blockers) {
  if (!Array.isArray(blockers)) return { verdict: "", score: 0, matchedSummary: "" };
  try {
    const neutral = (f) => ({
      lens: "",
      file: str(f?.file),
      summary: str(f?.summary),
      evidence: str(f?.evidence),
    });
    const best = bestMatch(neutral(finding), blockers.map(neutral), { crossSource: true });
    if (!best) return { verdict: "no", score: 0, matchedSummary: "" };
    return {
      verdict: best.result.verdict,
      score: Math.round(best.result.score * 100) / 100,
      matchedSummary: str(best.candidate.summary),
    };
  } catch (err) {
    return { verdict: "maybe", score: 0, matchedSummary: "", error: err.message };
  }
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
    // The match fields live INSIDE `panelSaw` rather than at the top level: they
    // are three more things we know about what the panel saw, and `schema` is
    // `wafflebase/miss@1`. They are present on every record, empty on the paths
    // that never ask the question, because a corpus read in diffs is easier to
    // scan when every line has the same shape.
    panelSaw: {
      reviewedSha: str(saw.reviewedSha),
      conclusion: str(saw.conclusion),
      blockingFindings: Number.isFinite(Number(saw.blockingFindings)) ? Number(saw.blockingFindings) : 0,
      matchVerdict: MATCH_VERDICTS.has(saw.matchVerdict) ? saw.matchVerdict : "",
      matchScore: Number.isFinite(Number(saw.matchScore)) ? Number(saw.matchScore) : 0,
      matchedSummary: str(saw.matchedSummary),
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
 * blockingFindings, blockers}`.
 *
 * `blockers` is the blocking findings THEMSELVES, and it is the whole reason
 * signature 2 can be more than a guess. This function used to compute the count
 * and drop the findings on the floor, so the CodeRabbit path could say the panel
 * raised three blockers but never whether one of them was the comment in hand —
 * every CodeRabbit blocker was filed as a miss by construction. `blockingFindings`
 * stays a count because callers and the record format depend on it.
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
  const classified = classify(findings);
  return {
    reviewedSha,
    conclusion,
    blockingFindings: classified.blockingCount,
    // The BLOCKING subset only. A CodeRabbit blocker "already raised" by a nit the
    // panel filed is not a gate hit, and matching against non-blocking findings
    // would suppress a real gate miss on the strength of a passing remark.
    blockers: classified.findings.filter((f) => BLOCKING.has(f.severity)),
  };
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
 * Returns `{records, skipped, suppressed}` — `skipped` is a human-readable reason
 * when the PR could not be examined at all, so the CLI can say WHY a PR produced
 * nothing. "Zero candidates" and "could not look" must never print the same way;
 * the whole point of the corpus is that an empty result is a claim, not a default.
 *
 * THE TWO SIGNATURES HAVE DIFFERENT PRECONDITIONS, and conflating them cost this
 * module its best data. Signature 1 is defined relative to a hand-off — "a human
 * changed reviewable code AFTER the panel approved" is meaningless without the
 * moment it approved — and only an agent PR promoted by `mark-ready.mjs` has one.
 * Signature 2 needs neither: "CodeRabbit flagged something our panel reviewed and
 * did not raise" is exactly as true on a human PR reviewed via `@claude review`,
 * where `handoffAt` is not merely unknown but MEANINGLESS — nothing was handed off.
 *
 * Gating both on `isAgentPr` plus a hand-off marker excluded, measurably: 18 of 33
 * agent PRs (opened ready, so they have neither a marker nor a `ready_for_review`
 * event), and every human PR — which is where the on-demand panel reviews and the
 * bulk of CodeRabbit's blocking findings both live. So each signature now checks
 * only what it actually needs, and `skipped` is set only when nothing could be
 * examined at all.
 */
export function harvestPr(pr, { api = gh, log = console.error, names = [] } = {}) {
  const records = [];
  // CodeRabbit comments the matcher attributed to a panel finding, so they were
  // NOT filed. Reported by the CLI: a suppression nobody can see is a deletion.
  let suppressed = 0;

  // Comments come FIRST and are load-bearing twice over: they carry the hand-off
  // marker (signature 1's cutoff) and the on-demand panel's findings (signature
  // 2's comparison set). One call, both facts.
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

  let prCommits = [];
  try {
    prCommits = listCommits(pr, api);
  } catch (err) {
    log(`#${pr}: could not list commits (${err.message}); no human-fix candidates from this PR.`);
  }
  // `handoffAt` may be null now that signature 2 no longer requires one. NaN makes
  // every `at <= cutoff` false, so `beforeHandoff` empties and `headAtHandoff` goes
  // undefined — the same "could not establish it" state as an unreadable commit
  // list. Stated rather than relied upon, because it is load-bearing.
  const cutoff = handoffAt === null ? NaN : Date.parse(handoffAt);
  const beforeHandoff = prCommits.filter((c) => {
    const at = Date.parse(str(c?.commit?.committer?.date));
    return Number.isFinite(at) && at <= cutoff;
  });
  // NO fallback to the PR's last commit. If every commit post-dates the handoff
  // (a force-push or rebase after promotion rewrites committer dates), the last
  // commit is one the panel saw only AFTER the human's fix — recording its verdict
  // would describe a panel that had already been shown the answer. An empty
  // `panelSaw` says "we could not establish what the panel saw", which is true; a
  // post-handoff sha would be a wrong measurement that reads as a right one.
  const headAtHandoff = beforeHandoff[beforeHandoff.length - 1];

  // The sha is known for certain the moment we have the commit list, so it is
  // recorded OUTSIDE the check-run fetch. Only `conclusion` and
  // `blockingFindings` depend on the API call, and leaving those empty while the
  // sha is present says exactly what happened: we know which commit the panel was
  // looking at and we could not read what it concluded. Collapsing both into ""
  // would make an API hiccup indistinguishable from a PR with no panel at all.
  let panelSaw = { reviewedSha: str(headAtHandoff?.sha), conclusion: "", blockingFindings: 0 };
  // `null`, not `[]`: "we could not establish the panel's findings" is a different
  // claim from "the panel raised none", and `attributeToPanel` answers them
  // differently. Collapsing them would let an API hiccup read as a clean panel.
  let panelBlockers = null;
  if (headAtHandoff?.sha) {
    try {
      const runs = commitCheckRuns(headAtHandoff.sha, { api });
      const verdict = panelVerdictAt(withFullOutput(latestLensRuns(runs, names), { api, log }));
      panelSaw = {
        reviewedSha: verdict.reviewedSha || headAtHandoff.sha,
        conclusion: verdict.conclusion,
        blockingFindings: verdict.blockingFindings,
      };
      // Only a lens run that actually EXISTED is an answer. `conclusion === ""` is
      // `panelVerdictAt`'s own signal for "no lens runs on this commit", and its
      // `blockers` is then an empty array meaning "nothing to read" — not "the panel
      // raised nothing". Treating those alike is what kept the on-demand comment
      // below unreachable: a commit with zero lens runs looked like a clean panel.
      if (verdict.conclusion !== "") panelBlockers = verdict.blockers;
    } catch (err) {
      log(`#${pr}: could not read the panel's verdict (${err.message}); recording it as unknown.`);
    }
  }

  // FALLBACK to the on-demand panel's comment, and only a fallback: check runs are
  // the structured record, this is a rendering of one, so it is read exactly when
  // there is no structured record to prefer. `panelBlockers === null` is the test
  // rather than `.length === 0` — an autonomous panel that genuinely raised nothing
  // has already answered the question, and overwriting that with a comment from a
  // different review would answer a different one.
  if (panelBlockers === null) {
    const fromComment = panelFindingsFromComments(comments);
    if (fromComment) {
      panelBlockers = fromComment.findings;
      // Only fill what is still blank. A sha established from the commit list is
      // more precise than the comment's, and `conclusion` stays "" because an
      // advisory review reached no gate conclusion — that is not a missing value.
      panelSaw = {
        ...panelSaw,
        reviewedSha: panelSaw.reviewedSha || fromComment.reviewedSha,
        blockingFindings: panelSaw.blockingFindings || fromComment.findings.length,
      };
      log(
        `#${pr}: no lens check runs; using the on-demand panel comment ` +
          `(${fromComment.findings.length} blocking finding(s)) as the comparison set.`,
      );
    }
  }

  // Signature 1 — human commits after handoff. Requires `handoffAt`: without the
  // moment the panel let go, "after" has no referent and every commit on the PR
  // would qualify. `isHumanFollowupCommit` returns false on an unusable cutoff, so
  // this loop is already a no-op then; the guard is here to say so out loud and to
  // keep the reason next to the code that depends on it.
  if (handoffAt === null) {
    log(`#${pr}: no hand-off marker and no ready_for_review event; no human-fix candidates (CodeRabbit signature still runs).`);
  }
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
        handoffAt: str(handoffAt),
        evidence: { commitSha: c.sha, url: str(c.html_url) },
        files,
        summary: str(c.commit?.message).split("\n")[0],
        panelSaw,
        notes: "candidate: a human changed reviewable code after the panel approved",
      }),
    );
  }

  // Signature 2 — CodeRabbit findings the panel did not raise.
  //
  // REQUIRES evidence that the panel reviewed this PR, and that requirement is what
  // makes widening the population safe. "The panel did not raise this" is only a
  // claim about the panel if the panel looked; on a PR it never reviewed, every
  // CodeRabbit blocker files as a miss and the corpus fills with rows measuring
  // nothing.
  //
  // The evidence is EMPIRICAL — readable lens check runs, or a trusted on-demand
  // comment — and authorship is deliberately not part of it. `isAgentPr` looks like
  // a third signal ("the pipeline reviews every agent PR by construction") and it is
  // wrong: of 11 agent PRs carrying CodeRabbit blockers, 9 have no `agent-review-*`
  // check run on any commit, only `verify-*` and codecov. They match `isAgentPr` by
  // branch prefix but never went through the panel — the same 18-of-33 population
  // that has no hand-off marker because it was opened ready rather than promoted.
  // Trusting authorship would have filed 15 rows about a reviewer that never looked.
  //
  // Withholding is also the RECOVERABLE direction. No row is written, so a later
  // harvest re-proposes the candidate once the evidence exists; a wrong row, once
  // curated, is permanent.
  const panelReviewed = panelBlockers !== null;
  let reviewComments = [];
  try {
    reviewComments = listReviewComments(pr, api);
  } catch (err) {
    log(`#${pr}: could not list review comments (${err.message}).`);
  }
  if (!panelReviewed && reviewComments.length > 0) {
    log(`#${pr}: ${reviewComments.length} review comment(s) but no evidence the panel ever reviewed this PR; no CodeRabbit candidates.`);
  }
  for (const rc of panelReviewed ? reviewComments : []) {
    // EXACT login, not a prefix. `startsWith("coderabbitai")` also accepts
    // `coderabbitai-x`, and anyone can register that name and comment on a public
    // PR — which would let a stranger write rows into the corpus. Curation is the
    // real defence, but a matcher that decides whose text gets archived should not
    // be the loose one.
    if (!CODERABBIT_LOGINS.has(str(rc?.user?.login))) continue;
    const finding = classifyCodeRabbitComment(rc.body);
    if (!finding) continue;
    const files = interestingFiles([str(rc.path)]);
    if (files.length === 0) continue;

    // `rc.path` RAW, not the filtered `files` above: `interestingFiles` exists to
    // decide what may carry a miss, and reusing it here would silently hand the
    // matcher an empty file — i.e. no location evidence — for a comment we have a
    // path for. The panel side's `file` may legitimately be empty (the infra-record
    // shape), which `locationScore` reads as absent rather than as a match.
    // Prose for the token comparison, the whole body for the anchor layer.
    const attribution = attributeToPanel(
      { file: str(rc.path), summary: finding.detail, evidence: str(rc.body) },
      panelBlockers,
    );
    if (attribution.verdict === "match") {
      // Counted and logged rather than dropped in silence. A matcher that quietly
      // eats candidates is indistinguishable from a PR nobody reviewed, and this
      // is the number that says whether the matcher is earning its place.
      suppressed++;
      log(
        `#${pr}: CodeRabbit comment ${rc.id} restates a panel finding ` +
          `(score ${attribution.score}: "${attribution.matchedSummary}"); not filed as a miss.`,
      );
      continue;
    }

    records.push(
      toMissRecord({
        id: candidateId("coderabbit", pr, rc.id),
        label: "miss",
        source: "coderabbit",
        pr,
        handoffAt: str(handoffAt),
        evidence: {
          commitSha: str(rc.original_commit_id || rc.commit_id),
          commentId: String(rc.id ?? ""),
          url: str(rc.html_url),
        },
        files,
        lens: finding.lens,
        severity: finding.severity,
        summary: finding.summary,
        panelSaw: {
          ...panelSaw,
          matchVerdict: attribution.verdict,
          matchScore: attribution.score,
          matchedSummary: attribution.matchedSummary,
        },
        notes:
          `candidate: CodeRabbit raised a ${finding.severity} ${finding.category} finding` +
          (attribution.verdict === "maybe"
            ? ` — MAYBE already raised by the panel${attribution.error ? ` (matcher failed: ${attribution.error})` : ""}; needs a human decision`
            : ""),
      }),
    );
  }
  // `skipped` is reserved for "could not look", never "looked and found nothing".
  // Nothing was examinable when there was no hand-off (so signature 1 could not
  // run) AND no CodeRabbit review comment reached the matcher (so signature 2 had
  // no input). Anything else produced a real, reportable zero.
  const noSignature1 = handoffAt === null;
  const noSignature2 = !panelReviewed || reviewComments.length === 0;
  return {
    records,
    skipped:
      noSignature1 && noSignature2
        ? `#${pr} has no hand-off marker and no panel review to compare CodeRabbit against — nothing to examine`
        : "",
    suppressed,
  };
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

const PR_LIST_LIMIT = 200;

/** GitHub's search API maximum. Asking for more is a 422, not a clamp. */
const SEARCH_PAGE_LIMIT = 100;

/**
 * Merged agent PRs to examine. `--since` is passed straight to GitHub's search
 * rather than filtered client-side, so a wide window does not silently truncate
 * at the page limit.
 *
 * A result that exactly fills the limit is REPORTED. A silently capped list makes
 * a partial harvest read as a complete one, and "we found no misses in this
 * window" is precisely the conclusion this corpus must never reach by accident.
 */
export function listCandidatePrs({ since, api, log = console.error }) {
  const search = since ? `merged:>=${since}` : "";
  const argv = ["pr", "list", "--state", "merged", "--limit", String(PR_LIST_LIMIT), "--json", "number,headRefName,author"];
  if (search) argv.push("--search", search);
  const prs = api(argv);
  const all = Array.isArray(prs) ? prs : [];
  if (all.length >= PR_LIST_LIMIT) {
    log(
      `harvest: the PR list came back at the ${PR_LIST_LIMIT} cap, so older PRs in this ` +
        `window were NOT examined. Narrow --since and run again.`,
    );
  }
  const numbers = new Set(all.filter(isAgentPr).map((p) => p.number));

  // Plus every PR the panel reviewed on demand. `isAgentPr` is the wrong question
  // for signature 2 — "did our panel review this" is the right one, and a human PR
  // someone ran `@claude review` on is as much a panel subject as an agent PR. That
  // population is unreachable through `pr list` (authorship and branch name say
  // nothing about it), so it is found by the marker the panel itself writes.
  //
  // ONE search call, and its failure is survivable by design: the agent PRs above
  // are already in hand, so a search outage costs this run the on-demand PRs and
  // nothing else. Same fail direction as every other read here.
  try {
    // `gh` expands `{owner}/{repo}` in an endpoint PATH, not inside a `-f` value, so
    // the slug is resolved explicitly. Routed through the injected `api` (rather
    // than hunt.mjs's direct `execFileSync`) so this stays testable.
    const slug = str(api(["repo", "view", "--json", "nameWithOwner"])?.nameWithOwner);
    if (slug === "") throw new Error("could not resolve owner/repo");
    const found = api([
      "api", "-X", "GET", "search/issues",
      "-f", `q=repo:${slug} is:pr "${PANEL_COMMENT_TAG}" in:comments${since ? ` merged:>=${since}` : ""}`,
      // The search API caps `per_page` at 100 regardless of what is asked, and a
      // larger value is a 422 rather than a clamp.
      "-f", `per_page=${SEARCH_PAGE_LIMIT}`,
    ]);
    const items = Array.isArray(found?.items) ? found.items : [];
    if (Number(found?.total_count) > items.length) {
      log(
        `harvest: ${found.total_count} on-demand-reviewed PR(s) matched but only ${items.length} ` +
          `were returned, so some were NOT examined. Narrow --since and run again.`,
      );
    }
    let added = 0;
    for (const it of items) if (Number.isFinite(it?.number) && !numbers.has(it.number)) { numbers.add(it.number); added++; }
    if (added > 0) log(`harvest: ${added} additional PR(s) carry an on-demand panel review.`);
  } catch (err) {
    log(`harvest: could not search for on-demand-reviewed PRs (${err.message}); agent PRs only.`);
  }
  return [...numbers];
}

function cmdHarvest(args) {
  const api = gh;
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
  let suppressed = 0;
  for (const pr of prs) {
    const result = harvestPr(pr, { api, names });
    if (result.skipped) console.error(`harvest: skipped ${result.skipped}`);
    found.push(...result.records);
    suppressed += result.suppressed ?? 0;
  }
  if (suppressed > 0) {
    console.error(
      `harvest: ${suppressed} CodeRabbit finding(s) attributed to a panel finding and NOT filed. ` +
        `Each one is named above with the panel finding it matched.`,
    );
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
  //
  // The missing-newline case is the same class of damage and `parseJsonl` cannot
  // see it: a file whose last line has no trailing `\n` parses perfectly (split
  // yields the same records), but appending to it CONCATENATES the last existing
  // record with the first new one, destroying BOTH. Verified: appending to
  // `{"id":"a"}\n{"id":"b"}` yields `{"id":"b"}{"id":"c"}` on one line, and the
  // next read reports 1 unreadable line — by which point the data is gone. So the
  // boundary is checked BEFORE the write, not inferred from a later parse.
  if (existingText !== "" && !existingText.endsWith("\n")) {
    console.error(
      `harvest: refusing to append — ${MISSES_PATH} does not end with a newline. ` +
        `Appending would join its last record to the first new one and destroy both. ` +
        `Add a trailing newline and run again.`,
    );
    process.exit(0);
  }
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
