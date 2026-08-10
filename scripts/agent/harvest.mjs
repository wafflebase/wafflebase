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
 * When `mark-ready.mjs` posted its hand-off marker (ISO string), or null.
 *
 * FIRST marker comment, not the last: a PR that is un-readied and re-promoted has
 * two, and the human work we are looking for starts at the first one.
 *
 * A CORROBORATING signal only — `panelApprovedAt` prefers the panel's own check
 * runs and reaches for this when it has none. The marker genuinely means "the panel
 * approved" (that is the only thing that posts it), but it can be absent from a PR
 * that really was promoted: `mark-ready.mjs` posts it inside a `try/catch` AFTER
 * flipping the PR ready, so a failed comment cannot fail a successful promotion.
 *
 * `ready_for_review` USED TO BE the fallback here and has been removed outright, not
 * demoted. It answers a different question — "when did this PR leave draft" — and
 * fires whether or not the panel ever spoke, so on a manually-readied PR it made
 * every subsequent human commit a candidate. It was also unreachable for the 18 of
 * 33 agent PRs opened ready rather than promoted, i.e. it over-fired on the PRs it
 * covered and covered none of the PRs it was reached for. The timeline request it
 * needed is gone with it.
 */
export function markerHandoffAt(comments = []) {
  const marked = (Array.isArray(comments) ? comments : [])
    .filter((c) => str(c?.body).includes(HANDOFF_MARKER))
    .map((c) => str(c?.created_at))
    .filter((t) => t !== "" && Number.isFinite(Date.parse(t)))
    .sort();
  return marked.length > 0 ? marked[0] : null;
}

/**
 * When the panel APPROVED this PR (ISO string), or null.
 *
 * The panel's own check runs are the primary source, and the reason is that they
 * are the only signal which is present whenever the panel ran, carries a server
 * timestamp, and means what we need it to mean:
 *
 * |                                  | marker comment | ready_for_review | check runs |
 * |----------------------------------|----------------|------------------|------------|
 * | present whenever the panel ran   | no (try/catch) | no               | YES        |
 * | survives a rebase / force-push   | yes            | yes              | YES        |
 * | means "the panel approved"       | yes            | NO               | YES        |
 *
 * That third row is why `ready_for_review` is gone, and the first is why the marker
 * cannot be primary. The second row is the one that matters most in practice:
 * `completed_at` is stamped by GitHub on the check run, so a rebase that rewrites
 * every committer date on the PR cannot move it. The previous implementation keyed
 * the cutoff off a comment and then compared it against committer dates, so a
 * force-push after promotion pushed every commit past the cutoff, emptied the
 * before-handoff set, and left signature 2 with no comparison set at all.
 *
 * The FIRST all-success round, not the newest, and this is the one place where the
 * obvious choice is actively self-defeating. Every human fix pushed after an approval
 * opens a new round, and that round then approves too — so keying on the newest
 * approval moves the cutoff PAST the very commits the signature exists to catch.
 * Measured on #548: the newest-approval cutoff lands on 2026-07-28, four days after
 * the three human fixes of 2026-07-25, and loses all three — including the rows a
 * human has already curated into `misses.jsonl`.
 *
 * So this matches `markerHandoffAt`'s "FIRST marker, not the last" for the same
 * reason: the human work being looked for starts the first time the panel said the PR
 * was fine. A later re-approval does not un-say it.
 *
 * Rounds with `conclusion: "failure"` or `""` are not approvals, which is also what
 * keeps ADVISORY rounds out — an `@claude review` round carries `conclusion: ""`
 * because it reached no gate conclusion (see `panelRounds`).
 *
 * Returns null when the panel never approved. Callers must treat null as "cannot
 * classify", never as "approved at time zero" — that would make every commit on the
 * PR a candidate, which is precisely the over-fire this replaces.
 */
export function panelApprovedAt(rounds, markerAt = null) {
  // Ordered by PARSED TIME, for the reason `panelRoundAt` gives.
  const approvals = (Array.isArray(rounds) ? rounds : [])
    .filter((r) => str(r?.conclusion) === "success")
    .map((r) => str(r?.completedAt))
    .filter((t) => t !== "" && Number.isFinite(Date.parse(t)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  if (approvals.length > 0) return approvals[0];
  const marker = str(markerAt);
  return marker !== "" && Number.isFinite(Date.parse(marker)) ? marker : null;
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

// CodeRabbit's finding header has had FOUR vintages on this repository, and the
// classifier used to read one of them.
//
// The comment that stood here said the upstream vocabulary ("Potential issue" /
// "Refactor suggestion" / "Nitpick") had never been emitted here — "every inline
// finding back to #525 uses the header below". That is true back to #525 and
// wrong before it, and it was wrong in two directions at once: 470 inline
// findings carry `_Potential issue_ | _Major_` (the upstream vocabulary, in a
// TWO-field header), and another 64 carry it in a single italic field. Measured
// 2026-08-07 over every inline review comment in the repo: 935 three-field, 475
// two-field, 64 single-italic, 11 bold-title.
//
// The two-field header is NOT a retired vintage. Its most recent use is #692 on
// 2026-08-07, in the current CHILL vocabulary — CodeRabbit simply omits the
// effort field sometimes. A parser keyed on field COUNT is therefore blind to
// live output, not just to history, which is why fields are matched by
// vocabulary below rather than by position.
//
//   three-field   _<category>_ | _<severity>_ | _<effort>_
//   two-field     _<category>_ | _<severity>_
//   single-italic _<category>_   OR   _<effort>_        (ambiguous — see below)
//   bold-title    **Title.**                            (no category, no severity)
//
// The `_` delimiter also occurs INSIDE a field, because GitHub emoji shortcodes
// contain underscores (`_:hammer_and_wrench: Refactor suggestion_`). So a header
// line is split on `|` and each part unwrapped, rather than matched with one
// `[^_]+` regex — that regex stops at the first inner underscore and drops the
// finding.
const CR_FIELD = /^_(.+)_$/;

/** Field count → vintage name. Index 0 is unused; a zero-field header is not one. */
const CR_ARITY_VINTAGE = ["", "single-italic", "two-field", "three-field"];

/**
 * CodeRabbit's severity vocabulary, translated to ours AT THE ARM BOUNDARY.
 *
 * `normalizeSeverity` is deliberately NOT used here. It maps anything unknown to
 * `major` as a fail-safe for our own gate, and CodeRabbit's scale has a word ours
 * does not: `trivial`, its below-minor tier, which appears 307 times. Running it
 * through `normalizeSeverity` files every one as a BLOCKING major — findings
 * CodeRabbit marks as the lowest tier it has, entering the corpus as gate-blocking
 * defects. Adding `trivial` to `severity.mjs`'s `KNOWN` would fix it in the wrong
 * place: `KNOWN` is the shared source of truth for what blocks a PR in OUR panel,
 * our lenses never emit `trivial`, and a foreign vocabulary gets translated where
 * it crosses rather than absorbed into ours.
 */
const CR_SEVERITY = new Map([
  ["critical", "critical"],
  ["major", "major"],
  ["minor", "minor"],
  ["nit", "nit"],
  ["trivial", "nit"],
]);

// The two category vocabularies. WHICH ONE a finding used is kept on the finding:
// the switch was sharp (last upstream-vocabulary comment 2026-06-22T00:20:46Z,
// first CHILL one 2026-06-23T06:56:21Z) and it is a real confound in any count
// taken across it, so a parser that normalised both into one shape would make
// "did the format change?" unanswerable.
const CR_CHILL_CATEGORIES = new Set([
  "functional correctness",
  "security & privacy",
  "maintainability & code quality",
  "performance & scalability",
  "stability & availability",
  "data integrity & integration",
]);
const CR_UPSTREAM_CATEGORIES = new Set(["potential issue", "refactor suggestion", "nitpick", "verification agent"]);

// The effort field, enumerated for one reason: a SINGLE italic field is ambiguous.
// It carries a category in the 2025 vintage (`_⚠️ Potential issue_`) and an effort
// in the 2026-05 one (`_⚡ Quick win_`), and 212 of the 226 single-field headers in
// review bodies are efforts. Reading position 1 as "the category" would file
// "quick win" as a CodeRabbit category on 212 findings.
const CR_EFFORTS = new Set(["quick win", "low value", "heavy lift", "poor tradeoff"]);

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

/** Strip emoji/punctuation from a CodeRabbit header field, leaving the words.
 *  GitHub emoji shortcodes go first: `:hammer_and_wrench:` would otherwise
 *  survive as the word `hammerandwrench` and make the category unrecognisable. */
const headerWords = (s) =>
  str(s)
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/[^\p{Letter}\p{Number}&\s-]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Read one CodeRabbit header LINE, in any of the three italic vintages.
 * `null` when the line is not a header.
 *
 * Fields are assigned BY VOCABULARY, not by position — that is what makes one
 * function read all three arities, and what disambiguates the single-field case.
 *
 * `severity: ""` means CodeRabbit stated no severity we recognise, and it is a
 * deliberate third state rather than a default. Defaulting to `major` files nits
 * as blockers (the bug above); defaulting to `nit` silently demotes a real
 * blocker the day CodeRabbit adds a word. Both are silent; an empty severity is
 * not, because `BLOCKING.has("")` is false, so an unrecognised severity is
 * withheld from the corpus rather than guessed into it — and `severityRaw`
 * carries the word CodeRabbit actually wrote so the gap is nameable. A fifth
 * vintage will happen.
 */
export function classifyCodeRabbitHeader(line) {
  const parts = str(line).trim().split("|").map((p) => p.trim());
  if (parts.length > 3) return null;
  const fields = [];
  for (const p of parts) {
    const m = CR_FIELD.exec(p);
    if (!m) return null;
    fields.push(headerWords(m[1]));
  }
  let category = "", vocabulary = "", severity = "", severityRaw = "", effort = "";
  const unrecognised = [];
  for (const f of fields) {
    if (CR_CHILL_CATEGORIES.has(f)) { category = f; vocabulary = "chill"; }
    else if (CR_UPSTREAM_CATEGORIES.has(f)) { category = f; vocabulary = "upstream"; }
    else if (CR_SEVERITY.has(f)) { severity = CR_SEVERITY.get(f); severityRaw = f; }
    else if (CR_EFFORTS.has(f)) { effort = f; }
    else if (f !== "") unrecognised.push(f);
  }
  // Recognised NOTHING in any of the three vocabularies: an italic caption or an
  // emphasised sentence, not a finding header. Without this, any `_word_` line
  // becomes a severity-less finding.
  if (category === "" && severity === "" && effort === "") return null;
  return {
    vintage: CR_ARITY_VINTAGE[fields.length] ?? "",
    category,
    vocabulary,
    severity,
    severityRaw,
    effort,
    unrecognised,
  };
}

/**
 * Read one CodeRabbit inline comment as a finding, or `null` if it is not one.
 *
 * `null` covers the two things CodeRabbit posts that are not findings: threaded
 * replies to a maintainer ("@user, thanks for the fix…") and its auto-generated
 * walkthroughs. Neither opens with a header or a bolded title. Returning null on
 * a MISSING header rather than defaulting the severity is why severity is read
 * only after a header matched — see `classifyCodeRabbitHeader`.
 *
 * EVERY severity is returned, including non-blocking ones. The blocking-only
 * filter used to live here, and it now lives at the caller (`harvestPr`), where
 * it is visible as the corpus policy it is rather than a property of "what
 * CodeRabbit wrote". Widen at the parser, filter at the caller: this function is
 * the repo's only reader of CodeRabbit's format, and a second consumer that
 * wants nits must not have to re-implement the header to get them.
 */
export function classifyCodeRabbitComment(body) {
  const text = str(body);
  const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
  const head = classifyCodeRabbitHeader(first);
  // The 2024 vintage states no category and no severity at all — the body opens
  // straight on the bolded title. Accepted because a threaded reply never does
  // (verified: of 481 inline comments with no italic header, 376 open with
  // `@user`, 26 with `<details>`, and the 11 that open bold are all findings).
  const bold = head === null ? /^\s*\*\*(.+?)\*\*/s.exec(first) : null;
  if (head === null && bold === null) return null;
  const title = /\*\*(.+?)\*\*/s.exec(text)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  return {
    category: head?.category ?? "",
    vocabulary: head?.vocabulary ?? "",
    severity: head?.severity ?? "",
    severityRaw: head?.severityRaw ?? "",
    effort: head?.effort ?? "",
    vintage: head?.vintage ?? "bold-title",
    lens: CR_CATEGORY_TO_LENS.get(head?.category ?? "") ?? "",
    summary: title,
    detail: codeRabbitDetail(body),
  };
}

// Where a CodeRabbit body stops being prose. Verified against every inline
// finding on #548, #594 and #639: the body is always header → bolded title →
// prose → structured blocks, and prose never resumes after the first block.
const CR_PROSE_END = /^[ \t]*(?:<details>|```|<!--)/m;

/**
 * Leading blockquote markers, which are markup rather than words.
 *
 * CodeRabbit puts a tier section inside a GitHub alert block (`> [!CAUTION]`)
 * whenever its findings fall outside the diff, and that prefixes EVERY line of the
 * section with `> ` — sometimes `> > `. 96 of this repo's 558 CodeRabbit review
 * bodies look like that, back to 2026-04.
 *
 * Stripped ONCE, at the two entry points (`codeRabbitReviewSections` and
 * `codeRabbitDetail`), rather than tolerated with a `>` in each of the four
 * line-anchored patterns below. That was the first attempt and it does not work:
 * an EMPTY quoted line is `>` alone, which is not blank and matches no wrapper, so
 * the header-below-the-locator search stops on it and reads no header. Normalising
 * the text is one mechanism; four permissive character classes are four chances to
 * miss one.
 *
 * A marker must be followed by a SPACE, A TAB OR THE END OF THE LINE. That is what
 * separates markup from content, and without it the strip eats real `>` characters:
 * measured over this repo's 558 review bodies and 1891 inline comments, 6 lines
 * lose one — `> >= 0 and findPageLine(…)` becomes `= 0 and …`, and prose that wraps
 * onto `>=18.12.0 is used for canvas@^3.` or `>).value,` loses its first character.
 * A greedy `[ \t]*` between markers also swallowed the INDENTATION of quoted code
 * on 572 lines, which is content too.
 *
 * The `+` still allows a RUN, so genuinely nested quoting strips fully, and `$`
 * keeps the empty-line case above working. `>>= 3` and `>= 0` are left alone
 * because the character after the first `>` is neither a space nor a line end.
 */
const CR_BLOCKQUOTE_PREFIX = /^[ \t]*(?:>(?:[ \t]|$))+/gm;

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
  // Blockquote markers come off FIRST, before the prose boundary is searched for.
  // A review-body finding inside a `> [!CAUTION]` alert has `> ` on every line, so
  // `<details>` reads as `> <details>` and the boundary is never found — the detail
  // then runs to the end of the finding and swallows the `🤖 Prompt for AI Agents`
  // block, whose boilerplate is exactly what the docblock above says must never
  // reach the comparison. Measured before this strip: 146 of 1626 review-body
  // findings (9.0%) carried that boilerplate in `detail`, median length 1590.
  const text = str(body).replace(CR_BLOCKQUOTE_PREFIX, "");
  const cut = text.search(CR_PROSE_END);
  const prose = cut === -1 ? text : text.slice(0, cut);
  // Drop the header LINE if the first non-blank line is one, in any vintage. This
  // used to be a `.replace(CR_HEADER, "")` against the three-field regex, which
  // left a two-field or single-italic header sitting in the compared text — where
  // it contributes `potential`, `issue`, `major` to every comparison and inflates
  // containment on exactly the vocabulary every finding shares.
  const lines = prose.split("\n");
  const i = lines.findIndex((l) => l.trim() !== "");
  if (i !== -1 && classifyCodeRabbitHeader(lines[i]) !== null) lines.splice(i, 1);
  return lines.join("\n").replace(/\s+/g, " ").trim();
}

// --- CodeRabbit's OTHER half: the review body --------------------------------
//
// Most of what CodeRabbit writes is not an inline comment. It is nested inside the
// REVIEW body — `pulls/{n}/reviews`, an endpoint this module has never called —
// under collapsed `<details>` sections, one per tier:
//
//   <details><summary>🧹 Nitpick comments (2)</summary><blockquote>
//     <details><summary>path/to/file.ts (1)</summary><blockquote>
//       `97-114`: _📐 Maintainability & Code Quality_ | _🔵 Trivial_ | _⚡ Quick win_
//       **The title.**
//       prose…
//
// Measured 2026-08-07 over all 638 PRs: 1626 findings across 513 tier sections in
// 403 of the 558 CodeRabbit reviews that carry a body — against 436 the inline
// path returns.
//
// Each section DECLARES its own count in its title, and so does each file
// sub-section — which is the denominator this parser is checked against, per
// section, rather than a total nobody can falsify.

/**
 * Tier titles, matched against the `headerWords` form — lower-cased, emoji and
 * PUNCTUATION stripped, so the 2024 combined title has no comma here. Writing
 * these with the comma is a real mistake and it was made once while building
 * this: the section then matched no tier, and an unmatched section contributes
 * NEITHER its findings nor its declared count, so the shortfall check that is
 * supposed to catch exactly this reported a clean 0 of 0.
 *
 * The 2024 vintage names three tiers in one title, and a keyword match on
 * "Nitpick comments" misses it.
 */
const CR_TIERS = [
  [/^nitpick comments$/, "nitpick"],
  [/^additional comments$/, "additional"],
  [/^additional comments not posted$/, "additional"],
  [/^duplicate comments$/, "duplicate"],
  [/^outside diff range comments$/, "outside-diff-range"],
  [/^minor comments$/, "minor"],
  [/^comments failed to post$/, "failed-to-post"],
  [/^outside diff range codebase verification and nitpick comments$/, "combined"],
];

/**
 * Section titles that are NOT findings, so that anything matching neither this
 * list nor `CR_TIERS` can be REPORTED rather than silently skipped.
 *
 * This is the guard for the failure above. Without it a new tier name — and
 * CodeRabbit has introduced four of them on this repo already — reads as "this
 * review had no findings", which is the one conclusion this module must never
 * reach by accident.
 */
const CR_NON_FINDING_SECTIONS = [
  /^files selected for processing$/,
  /^files ignored due to path filters$/,
  /^files skipped from review as they are similar to previous changes$/,
  /^files skipped from review due to trivial changes$/,
  /^files with no reviewable changes$/,
  /^review profile/,
  /^commits$/,
  /^code graph analysis$/,
  /^additional context used$/,
];

/** `<summary>Title (N)</summary>` — used for both tier sections and the file
 *  sub-sections inside them. The `(N)` is the declared count. */
const CR_SUMMARY = /<summary>([^<]*?)\s*\((\d+)\)<\/summary>/g;

/**
 * Three locator shapes, all three live in this repository's history:
 *   `97-114`:              backticked — the common one
 *   62-75:                 bare — the "Comments failed to post" tier
 *   Line range hint `4-15`: prefixed — the 2024 vintage
 * Anchored to the start of a line so the `- Around line 39-43:` bullets inside the
 * `🤖 Prompt for AI Agents` blocks cannot match.
 */
const CR_LOCATOR = /^[ \t>]*(?:Line range hint[ \t]+)?(?:`([^`\n]{1,200})`|(\d+(?:-\d+)?))[ \t]*:[ \t]*(.*)$/gm;

/** HTML wrapping that sits between a locator and its header. Sees de-quoted text —
 *  `codeRabbitReviewSections` strips blockquote markers from the section body. */
const CR_WRAPPER = /^(?:<\/?details>|<summary>.*<\/summary>|<\/?blockquote>|-{3,})$/;

/** Slice from the first `<blockquote>` after `start` to its MATCHING close.
 *  Counted rather than searched: tier sections nest file sub-sections, and a
 *  non-counting scan ends the tier at the first inner `</blockquote>` — which
 *  silently truncates every multi-file section to its first file. */
function crBlockAt(text, start) {
  const open = text.indexOf("<blockquote>", start);
  if (open === -1) return null;
  let depth = 0;
  const re = /<\/?blockquote>/g;
  re.lastIndex = open;
  let m;
  while ((m = re.exec(text))) {
    depth += m[0] === "<blockquote>" ? 1 : -1;
    if (depth === 0) return text.slice(open + "<blockquote>".length, m.index);
  }
  // Unclosed section: keep the rest rather than dropping it. Read paths degrade to
  // fewer records and never throw, and a truncated tail loses findings silently.
  return text.slice(open + "<blockquote>".length);
}

/** A file sub-section title rather than a tier: `packages/slides/src/x.ts (1)`.
 *  Matched on "contains no whitespace" rather than on an extension, so `.gitignore`
 *  and `Dockerfile` are files too — every tier title is prose and has a space. */
const CR_FILE_TITLE = /^\S+$/;

/**
 * The tier sections of one review body, each with the count it declares, plus
 * `unrecognised` — titles that carry a count but match no tier and no known
 * non-finding section.
 *
 * `unrecognised` is the whole point of returning a second list. A tier this
 * parser does not know is indistinguishable, from the outside, from a review that
 * found nothing.
 */
export function codeRabbitReviewSections(body) {
  const text = str(body);
  const sections = [];
  const unrecognised = [];
  CR_SUMMARY.lastIndex = 0;
  let m;
  while ((m = CR_SUMMARY.exec(text))) {
    const raw = m[1].trim();
    const title = headerWords(raw);
    const hit = CR_TIERS.find(([re]) => re.test(title));
    if (!hit) {
      // A file sub-section, or a section that is not findings at all.
      if (!CR_FILE_TITLE.test(raw) && !CR_NON_FINDING_SECTIONS.some((re) => re.test(title))) {
        unrecognised.push({ title: raw, declared: Number(m[2]) });
      }
      continue;
    }
    const block = crBlockAt(text, m.index);
    if (block === null) continue;
    // De-quoted ONCE here, so every line-anchored pattern downstream sees plain
    // text. See `CR_BLOCKQUOTE_PREFIX`: an outside-diff tier arrives wrapped in a
    // `> [!CAUTION]` alert with `> ` on every line.
    sections.push({ tier: hit[1], title: raw, declared: Number(m[2]), body: block.replace(CR_BLOCKQUOTE_PREFIX, "") });
  }
  return { sections, unrecognised };
}

/**
 * Every finding in one CodeRabbit review body, with the tier it came from.
 *
 * Returns `{findings, declared, shortfall}`. `declared` is what CodeRabbit's own
 * section titles claim and `shortfall` is `declared - findings.length` — the
 * denominator travels with the count, so a consumer can tell "this review had no
 * nitpicks" from "this parser could not read them", which are the same number
 * today and must never be.
 *
 * The tier is kept ON each finding rather than pooled. They are different claims:
 * a ♻️ Duplicate is the same defect said twice and double-counts any volume
 * metric, and ⚠️ Outside diff range is a finding about code the PR did not touch,
 * which is a different comparison entirely. A scorer can pool later; it cannot
 * unpool.
 */
export function parseCodeRabbitReview(body) {
  const findings = [];
  let declared = 0;
  const { sections, unrecognised } = codeRabbitReviewSections(body);
  for (const section of sections) {
    declared += section.declared;
    const text = section.body;
    // Offset → enclosing file path, from the file sub-section titles.
    const files = [];
    CR_SUMMARY.lastIndex = 0;
    let f;
    while ((f = CR_SUMMARY.exec(text))) files.push({ at: f.index, path: f[1].trim() });
    CR_LOCATOR.lastIndex = 0;
    let m;
    const hits = [];
    while ((m = CR_LOCATOR.exec(text))) {
      let rest = m[3].trim();
      // The header is often below the locator, under some HTML wrapping.
      if (rest === "" || CR_WRAPPER.test(rest)) {
        const tail = text.slice(CR_LOCATOR.lastIndex, CR_LOCATOR.lastIndex + 600).split("\n");
        rest = (tail.find((l) => l.trim() !== "" && !CR_WRAPPER.test(l.trim())) ?? "").trim();
      }
      const head = classifyCodeRabbitHeader(rest);
      const bold = head === null ? /^\*\*(.+?)\*\*/s.exec(rest) : null;
      if (head === null && bold === null) continue;
      let file = "";
      for (const x of files) if (x.at < m.index) file = x.path; else break;
      hits.push({ at: m.index, locator: m[1] ?? m[2] ?? "", file, head });
    }
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      const span = text.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : text.length);
      findings.push({
        tier: section.tier,
        file: h.file,
        locator: h.locator,
        category: h.head?.category ?? "",
        vocabulary: h.head?.vocabulary ?? "",
        severity: h.head?.severity ?? "",
        severityRaw: h.head?.severityRaw ?? "",
        effort: h.head?.effort ?? "",
        vintage: h.head?.vintage ?? "bold-title",
        lens: CR_CATEGORY_TO_LENS.get(h.head?.category ?? "") ?? "",
        summary: /\*\*(.+?)\*\*/s.exec(span)?.[1]?.replace(/\s+/g, " ").trim() ?? "",
        detail: codeRabbitDetail(span.replace(CR_LOCATOR, "").trimStart()),
      });
    }
  }
  return { findings, declared, shortfall: declared - findings.length, unrecognised };
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

/**
 * Each on-demand review as a ROUND, in the same shape `panelRounds` produces.
 *
 * The point of expressing an advisory review this way is that everything downstream
 * — ordering, `roundsUpTo`, `panelApprovedAt`, `panelSaw` — then works on one kind of
 * thing. The previous code treated this channel as a whole-PR fallback, so an
 * on-demand PR got a single comparison set for every CodeRabbit finding on it no
 * matter which commit each was about; as a round it gets the same per-commit
 * treatment the gating arm does, for free.
 *
 * `conclusion` is `""`, and that is not a missing value — an advisory review reaches
 * no gate conclusion. It is also what keeps these rounds out of `panelApprovedAt`,
 * which selects on `"success"`: an `@claude review` is not an approval and must never
 * become signature 1's cutoff.
 *
 * `blockers` is carried already-parsed, so these rounds cost no second request. The
 * `index` is where the reviewed commit sits on the PR, or -1 when that commit is no
 * longer on the branch (see `roundsUpTo` for what -1 buys).
 */
export function commentRounds(comments, commits) {
  const out = [];
  for (const c of Array.isArray(comments) ? comments : []) {
    if (!PANEL_LOGINS.has(str(c?.user?.login))) continue;
    const parsed = parsePanelComment(c?.body);
    if (!parsed) continue;
    const sha = str(parsed.reviewedSha);
    out.push({
      sha,
      index: commitIndex(commits, sha),
      conclusion: "",
      reviewedSha: sha,
      completedAt: str(c?.created_at),
      blockers: parsed.findings,
      advisory: true,
    });
  }
  return out;
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
const asRunMap = (runsByLens) =>
  runsByLens instanceof Map ? runsByLens : new Map(Object.entries(runsByLens ?? {}));

/**
 * The CHEAP half of a verdict: `{reviewedSha, conclusion, completedAt}`.
 *
 * Split out because it is answerable from the check-runs LIST response, which omits
 * `output.text` — so establishing WHICH commits the panel reviewed costs one call per
 * commit, and the per-run refetch that carries the findings is spent only on the
 * rounds a candidate is actually compared against. See `harvestPr`.
 *
 * Not merely an optimisation. `conclusion`'s aggregate rule is load-bearing ("one
 * failing lens means the panel did not let it through") and this keeps it in ONE
 * place rather than growing a second copy for the cheap path to use.
 *
 * `completedAt` is the LATEST `completed_at` across the lens runs, because the round
 * is not over until its last lens is. It falls back to `started_at` on the same
 * per-run basis `latestLensRuns` orders by, and to `""` when neither parses.
 */
export function panelRoundAt(runsByLens) {
  const runs = asRunMap(runsByLens);
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
  // Compared as PARSED TIMES, not as strings. Lexicographic order happens to work for
  // the `…Z` form GitHub returns and silently stops working for any offset form, which
  // is the kind of latent bug a timestamp comparison should not have.
  let completedAt = "";
  let latest = -Infinity;
  for (const r of runs.values()) {
    const t = str(r?.completed_at) || str(r?.started_at);
    const at = Date.parse(t);
    if (t !== "" && Number.isFinite(at) && at > latest) {
      latest = at;
      completedAt = t;
    }
  }
  return { reviewedSha, conclusion, completedAt };
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
 *
 * The return shape deliberately does NOT carry `panelRoundAt`'s `completedAt`:
 * three callers `deepEqual` this object, and a field they do not use would make them
 * assert about the timestamp of a fixture.
 */
export function panelVerdictAt(runsByLens) {
  const runs = asRunMap(runsByLens);
  const { reviewedSha, conclusion } = panelRoundAt(runs);
  const classified = classify(tagPriorFindings(runs));
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

/**
 * Position of a sha in the PR's commit list, or -1.
 *
 * The list is chronological, so the index is an ordering usable for "at or before".
 * -1 means the sha is not on the PR at all, which is a real and reachable state: a
 * force-push rewrites history and leaves a CodeRabbit comment's
 * `original_commit_id` pointing at a commit no longer reachable from the branch.
 */
export function commitIndex(commits, sha) {
  const want = str(sha);
  if (want === "") return -1;
  return (Array.isArray(commits) ? commits : []).findIndex((c) => str(c?.sha) === want);
}

/**
 * Every ROUND of review on this PR: one entry per commit the panel concluded on,
 * chronological, each `{sha, index, conclusion, reviewedSha, completedAt, runs}`.
 *
 * `runs` is the `latestLensRuns` map for that commit, kept so the caller can spend
 * the expensive per-run refetch later without listing the commit's checks again.
 *
 * PURE, with `runsFor(sha)` injected: the whole ordering decision is testable
 * without an API, which is the same reason `prior-findings.mjs` injects its `api`.
 *
 * A commit whose checks cannot be READ yields an `unreadable: true` round rather
 * than nothing, and the distinction is load-bearing in two directions at once. It
 * must not count as evidence the panel reviewed anything — so it carries
 * `conclusion: ""`, which keeps it out of `panelApprovedAt` and makes `blockersOf`
 * refuse it — but the SHA is a fact we hold regardless, and dropping the round would
 * throw it away. "We know which commit the panel was looking at and we could not
 * read what it concluded" is a more honest record than an empty one, and it is what
 * tells an API hiccup apart from a PR the panel never touched.
 *
 * A commit with no lens runs AT ALL is not a round; that is a real, readable answer
 * ("the panel did not review this commit"), not a failure. Either way the walk
 * continues, so one bad commit never costs the rest of the PR.
 */
export function panelRounds(commits, runsFor, { log = () => {} } = {}) {
  const rounds = [];
  const list = Array.isArray(commits) ? commits : [];
  for (let index = 0; index < list.length; index++) {
    const sha = str(list[index]?.sha);
    if (sha === "") continue;
    let runs;
    try {
      runs = asRunMap(typeof runsFor === "function" ? runsFor(sha) : null);
    } catch (err) {
      log(`could not read the panel's verdict at ${sha} (${err.message}); recording it as unknown.`);
      rounds.push({ sha, index, conclusion: "", reviewedSha: "", completedAt: "", unreadable: true });
      continue;
    }
    if (runs.size === 0) continue;
    const { reviewedSha, conclusion, completedAt } = panelRoundAt(runs);
    if (conclusion === "") continue; // no lens actually completed here
    rounds.push({ sha, index, conclusion, reviewedSha, completedAt, runs });
  }
  return rounds;
}

/**
 * The rounds a finding on `index` may be compared against: every round AT OR BEFORE
 * it, newest last. `index < 0` (a sha not on the PR) yields ALL rounds.
 *
 * "At or before" is the correction this exists for. The comparison set used to be a
 * single set computed from the hand-off commit and then applied to every CodeRabbit
 * finding regardless of which commit it was about — so on a multi-round PR a finding
 * could be checked against a verdict the panel reached AFTER it, and suppressed as
 * "already raised" by a finding that did not exist yet.
 *
 * ONE rule covers both unplaceable directions: **what cannot be placed cannot be
 * excluded.** An `index < 0` finding sees every round; a round with `index < 0` (an
 * advisory review of a commit no longer on the branch) is eligible for every finding.
 * Both widen the set, and widening can only ever over-suppress a finding the panel
 * really did raise somewhere on this PR — whereas narrowing on a guess files a miss
 * against a reviewer that did raise it. The same middle-of-the-road direction
 * `attributeToPanel` takes with `maybe`, and it is logged either way.
 *
 * The UNION rather than the newest single round, which is deliberate and unchanged
 * from the behaviour `panelFindingsFromComments` documented: the record's claim is
 * "the panel did not raise this", and a finding raised in an earlier round is one the
 * panel raised. Narrowing to one round would file those as misses.
 */
export function roundsUpTo(rounds, index) {
  const all = Array.isArray(rounds) ? rounds : [];
  if (index < 0) return [...all];
  return all.filter((r) => Number(r?.index) < 0 || Number(r?.index) <= index);
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

/** The REVIEWS on a PR — a different endpoint from `pulls/{n}/comments`, and the
 *  one that carries the nitpick, duplicate and outside-diff-range tiers. See
 *  `parseCodeRabbitReview`: most of what CodeRabbit writes is in here. */
function listReviews(pr, api) {
  const out = api(["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/reviews?per_page=100`]);
  return Array.isArray(out) ? out : [];
}

function commitFiles(sha, api) {
  const out = api(["api", `repos/{owner}/{repo}/commits/${sha}`]);
  return Array.isArray(out?.files) ? out.files : [];
}

/**
 * How many of a PR's commits to read check runs for.
 *
 * One LIST call each, so this is the only place this module's cost grows with PR
 * size. Set well above the real distribution rather than tuned to it: the widest PR
 * this corpus has looked at carries 9 commits, and `pulls/{n}/commits` itself stops
 * at 250. A PR past this cap loses its OLDEST rounds, so a CodeRabbit finding down
 * there is compared against a wider set than it should be (see `roundsUpTo`) — which
 * is why exceeding it is logged rather than absorbed.
 */
const ROUND_WALK_LIMIT = 100;

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
 * module its best data twice over.
 *
 * Signature 1 is defined relative to an approval — "a human changed reviewable code
 * AFTER the panel approved" is meaningless without the moment it approved. Signature
 * 2 needs no approval at all: "CodeRabbit flagged something our panel reviewed and
 * did not raise" is exactly as true on a human PR reviewed via `@claude review`,
 * where nothing was ever handed off.
 *
 * Gating both on `isAgentPr` plus a hand-off marker excluded, measurably: 18 of 33
 * agent PRs (opened ready, so they have neither a marker nor a `ready_for_review`
 * event), and every human PR — which is where the on-demand panel reviews and the
 * bulk of CodeRabbit's blocking findings both live.
 *
 * The second conflation survived that fix and is what this rewrite removes:
 * signature 2 still reached the panel's findings THROUGH signature 1's cutoff. The
 * comparison set was read from whichever commit was head at hand-off, so a PR with
 * no hand-off produced no comparison set and withheld every CodeRabbit candidate —
 * even with perfectly readable check runs on every commit. `panelRounds` now
 * establishes the review history directly from the check runs, `roundsUpTo` resolves
 * a comparison set PER COMMENT, and the cutoff is one more thing derived from that
 * history rather than the thing it all depends on.
 */
export function harvestPr(pr, { api = gh, log = console.error, names = [] } = {}) {
  const records = [];
  // CodeRabbit comments the matcher attributed to a panel finding, so they were
  // NOT filed. Reported by the CLI: a suppression nobody can see is a deletion.
  let suppressed = 0;

  // Comments come FIRST and are load-bearing twice over: they carry the hand-off
  // marker (signature 1's corroborating cutoff) and every on-demand review, which
  // `commentRounds` turns into rounds. One call, both facts.
  let comments = [];
  try {
    comments = listComments(pr, api);
  } catch (err) {
    log(`#${pr}: could not list comments (${err.message}); no marker and no advisory rounds from this PR.`);
  }

  let prCommits = [];
  try {
    prCommits = listCommits(pr, api);
  } catch (err) {
    log(`#${pr}: could not list commits (${err.message}); no rounds and no human-fix candidates from this PR.`);
  }
  if (prCommits.length > ROUND_WALK_LIMIT) {
    log(
      `#${pr}: ${prCommits.length} commits exceeds the ${ROUND_WALK_LIMIT}-commit round walk; ` +
        `the oldest were NOT read, so a CodeRabbit finding on one is compared against a wider set than it should be.`,
    );
  }
  const walked = prCommits.slice(0, ROUND_WALK_LIMIT);

  // PHASE 1 — which commits did the panel conclude on, and when. One check-runs
  // LIST call per commit; the list response omits `output.text`, so this establishes
  // the review history WITHOUT paying for the findings. Advisory reviews join as
  // rounds of their own, already carrying their findings.
  const rounds = [
    ...panelRounds(walked, (sha) => latestLensRuns(commitCheckRuns(sha, { api }), names), {
      log: (m) => log(`#${pr}: ${m}`),
    }),
    ...commentRounds(comments, walked),
  ].sort((a, b) => a.index - b.index || (Date.parse(str(a.completedAt)) || 0) - (Date.parse(str(b.completedAt)) || 0));

  // The cutoff, from the panel's own check runs — not from a comment, and no longer
  // from `ready_for_review` at all. See `panelApprovedAt` for why that ordering is
  // the whole point of this function.
  const approvedAt = panelApprovedAt(rounds, markerHandoffAt(comments));
  if (approvedAt === null && rounds.length > 0) {
    log(`#${pr}: the panel reviewed this PR but never approved it; no human-fix candidates (the CodeRabbit signature still runs).`);
  }

  // PHASE 2 — the findings, fetched per round and ONLY for rounds a candidate is
  // actually compared against. `withFullOutput` is one request per lens run, so this
  // is the expensive half; caching by sha keeps a PR with many CodeRabbit comments
  // from re-fetching the same round once per comment.
  const blockersBySha = new Map();
  const blockersOf = (round) => {
    // An advisory round parsed its findings out of the comment already.
    if (Array.isArray(round?.blockers)) return round.blockers;
    // A round whose checks could not be listed has no findings to read and MUST NOT
    // resolve to `[]`. Falling through would hand `withFullOutput` an absent `runs`,
    // get an empty map back, and report "this round raised nothing blocking" about a
    // round nobody has seen — filing every CodeRabbit finding on the PR as a miss.
    if (round?.unreadable) return null;
    const key = str(round?.sha);
    if (blockersBySha.has(key)) return blockersBySha.get(key);
    let out = null;
    try {
      out = panelVerdictAt(withFullOutput(round.runs, { api, log })).blockers;
    } catch (err) {
      log(`#${pr}: could not read the panel's findings at ${key} (${err.message}); recording it as unknown.`);
    }
    blockersBySha.set(key, out);
    return out;
  };

  /**
   * The panel's blocking findings a candidate at `index` may be compared against, or
   * `null` when that cannot be established.
   *
   * `null` vs `[]` is the same distinction it has always been, now decided per
   * candidate: `[]` is a real answer ("the panel reviewed this and raised nothing
   * blocking"), `null` is the absence of one. A single unreadable round in the
   * eligible set collapses the whole set to `null` — a union missing one round would
   * claim the panel raised nothing where it may have raised exactly this.
   *
   * GATING AND ADVISORY ROUNDS ARE UNIONED, not ranked, and that is a change from the
   * fallback ordering this replaces. The record's claim is "the panel did not raise
   * this", and `@claude review` runs the SAME lens panel — so a finding it raised is a
   * finding the panel raised, whether or not a gating round also covered that commit.
   * Ranking check runs above the comment made sense when there was one set per PR and
   * the question was which rendering of ONE round to trust; across rounds it would
   * discard real findings and file them as misses.
   *
   * It does widen the suppression surface, which is the direction
   * `panelFindingsFromComments` already chose and for the same reason: a finding the
   * panel raised in an earlier round is one the panel raised. The mitigation is
   * unchanged — every suppression is counted and logged with the finding it matched.
   */
  const comparisonSetAt = (index) => {
    const eligible = roundsUpTo(rounds, index);
    if (eligible.length === 0) return null;
    const out = [];
    for (const r of eligible) {
      const b = blockersOf(r);
      if (b === null) return null;
      out.push(...b);
    }
    return out;
  };

  /**
   * What the panel had concluded as of `index`, for the record's `panelSaw`.
   *
   * The GATING round wins here, and only here. This is where "check runs are the
   * structured record and the comment is a rendering of one" is actually observable
   * in the output: a gating round carries a real `conclusion` and an `external_id`
   * state pointer, an advisory one carries `""` and the comment's sha. Letting an
   * advisory round supply these would report `conclusion: ""` for a PR the panel
   * demonstrably passed, which is a wrong measurement rather than a missing one.
   *
   * The COMPARISON SET above does not work this way, on purpose — see
   * `comparisonSetAt`. Which round is the better witness to "what did the panel
   * conclude" and which findings count as "the panel raised this" are two different
   * questions, and the old single-set code could only answer them the same way.
   */
  const panelSawAt = (index, blockers) => {
    const eligible = roundsUpTo(rounds, index);
    const newest = eligible.filter((r) => !r?.advisory).at(-1) ?? eligible.at(-1);
    return {
      // The round's own state pointer when it has one, else the commit it hung off.
      reviewedSha: str(newest?.reviewedSha) || str(newest?.sha),
      conclusion: str(newest?.conclusion),
      blockingFindings: Array.isArray(blockers) ? blockers.length : 0,
    };
  };

  // Signature 1's anchor is the round that FIRST approved — the same round
  // `panelApprovedAt` takes its timestamp from, so the record's `handoffAt` and its
  // `panelSaw` describe one event rather than two. Not the newest round: a push after
  // approval opens rounds that say nothing about the approval the human reacted to,
  // and one of them re-approving is what would drag the cutoff past their fix.
  const approvingRound = rounds
    .filter((r) => str(r?.conclusion) === "success")
    .sort((a, b) => (Date.parse(str(a.completedAt)) || 0) - (Date.parse(str(b.completedAt)) || 0))[0];

  // Signature 1 — human commits after the panel approved. Requires `approvedAt`:
  // without the moment the panel let go, "after" has no referent and every commit on
  // the PR would qualify. `isHumanFollowupCommit` returns false on an unusable
  // cutoff, so this loop is already a no-op then; the guard is here to say so out
  // loud and to keep the reason next to the code that depends on it.
  //
  // The cutoff is a check-run `completed_at`, which is why a rebase no longer breaks
  // this: it rewrites the committer dates on the left of the comparison but cannot
  // touch the timestamp on the right.
  const sig1PanelSaw = panelSawAt(approvingRound ? approvingRound.index : -1,
    approvingRound ? blockersOf(approvingRound) : null);
  if (approvedAt === null && rounds.length === 0) {
    log(`#${pr}: no panel round and no hand-off marker; no human-fix candidates (the CodeRabbit signature still runs).`);
  }
  for (const c of prCommits) {
    if (!isHumanFollowupCommit(c, approvedAt)) continue;
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
        handoffAt: str(approvedAt),
        evidence: { commitSha: c.sha, url: str(c.html_url) },
        files,
        summary: str(c.commit?.message).split("\n")[0],
        panelSaw: sig1PanelSaw,
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
  //
  // The evidence is now resolved PER COMMENT rather than once per PR, and that is the
  // correction this change exists for. The comparison set used to come from whichever
  // commit was head at hand-off, and was then applied to every CodeRabbit finding on
  // the PR — so on a multi-round PR a finding could be checked against a verdict the
  // panel reached AFTER it and suppressed as "already raised" by a finding that did
  // not exist yet. It also meant no hand-off (18 of 33 agent PRs) left the set at
  // `null` and withheld every candidate on a PR whose check runs were sitting right
  // there, readable. Signature 2 never needed a hand-off; now it does not consult one.
  let reviewComments = [];
  try {
    reviewComments = listReviewComments(pr, api);
  } catch (err) {
    log(`#${pr}: could not list review comments (${err.message}).`);
  }
  // An unreadable round is not evidence of anything — it is the absence of evidence
  // with a sha attached — so this counts only rounds we could actually read.
  if (rounds.filter((r) => !r?.unreadable).length === 0 && reviewComments.length > 0) {
    log(`#${pr}: ${reviewComments.length} review comment(s) but no evidence the panel ever reviewed this PR; no CodeRabbit candidates.`);
  }
  let panelReviewed = false;
  for (const rc of rounds.length === 0 ? [] : reviewComments) {
    // EXACT login, not a prefix. `startsWith("coderabbitai")` also accepts
    // `coderabbitai-x`, and anyone can register that name and comment on a public
    // PR — which would let a stranger write rows into the corpus. Curation is the
    // real defence, but a matcher that decides whose text gets archived should not
    // be the loose one.
    if (!CODERABBIT_LOGINS.has(str(rc?.user?.login))) continue;
    const finding = classifyCodeRabbitComment(rc.body);
    if (!finding) continue;
    // BLOCKING ONLY, and this filter lives HERE rather than in the parser.
    //
    // It used to sit inside `classifyCodeRabbitComment`, which made "what
    // CodeRabbit wrote" and "what this corpus files" the same function — so
    // widening the parser to read the vintages it was blind to would have
    // flooded this corpus with nits, in a change whose entire purpose is to READ
    // more. The parser now returns everything CodeRabbit wrote; the corpus policy
    // is stated here, where it is visible as a policy.
    //
    // The policy itself is unchanged: this corpus measures the GATE, and a minor
    // maintainability note our panel also happened not to raise is not a gate
    // failure. What changes is the INPUT — a two-field header carrying a major is
    // now readable, so more real blockers reach this line and none that were
    // reaching it stop.
    //
    // `severity: ""` (CodeRabbit stated a severity we do not recognise, or stated
    // none) is not blocking and is withheld here, which is the recoverable
    // direction: no row is written, so a later harvest re-proposes it once the
    // vocabulary is mapped.
    if (!BLOCKING.has(finding.severity)) continue;
    const files = interestingFiles([str(rc.path)]);
    if (files.length === 0) continue;

    // WHICH COMMIT this finding is about, so it is compared against what the panel
    // had concluded by then and not against a later round. `original_commit_id` is
    // the commit the comment was first written on; `commit_id` is where GitHub
    // currently places it, and is the fallback.
    const at = commitIndex(walked, str(rc.original_commit_id || rc.commit_id));
    if (at < 0) {
      log(
        `#${pr}: CodeRabbit comment ${rc.id} sits on a commit that is no longer on the PR; ` +
          `comparing it against every round (see roundsUpTo — what cannot be placed cannot be excluded).`,
      );
    }
    const panelBlockers = comparisonSetAt(at);
    if (panelBlockers === null) {
      // No round at or before this comment, or one of them was unreadable. Either
      // way there is no basis for "the panel did not raise this".
      log(`#${pr}: no readable panel round at or before CodeRabbit comment ${rc.id}; withheld.`);
      continue;
    }
    panelReviewed = true;

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
        handoffAt: str(approvedAt),
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
          ...panelSawAt(at, panelBlockers),
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
  // Nothing was examinable when the panel never approved (so signature 1 could not
  // run) AND no CodeRabbit comment reached the matcher with a round behind it (so
  // signature 2 had no input). Anything else produced a real, reportable zero.
  const noSignature1 = approvedAt === null;
  const noSignature2 = !panelReviewed;
  return {
    records,
    skipped:
      noSignature1 && noSignature2
        ? `#${pr} has no panel approval and no panel round to compare CodeRabbit against — nothing to examine`
        : "",
    suppressed,
  };
}

/**
 * What CodeRabbit actually wrote on one PR, from BOTH endpoints, counted against
 * the denominators CodeRabbit itself states.
 *
 * Reports rather than records: it writes nothing, proposes no candidate and does
 * not touch `misses.jsonl`. It exists because every defect this parser has had
 * was a smaller-than-truth count that looked like a working one — the three-field
 * regex returned findings, the keyword tier match returned zero, the severity
 * filter returned a clean list of blockers, and none of them errored. A count
 * whose denominator is printed beside it is the only version of this that can be
 * caught being wrong.
 *
 * `declared` is CodeRabbit's own per-section total. `shortfall` is what this
 * parser could not read out of that. NEVER throws: each endpoint is caught
 * separately and degrades to fewer records.
 */
export function auditCodeRabbit(pr, { api = gh, log = console.error } = {}) {
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  const inline = { comments: 0, findings: 0, byVintage: {}, bySeverity: {} };
  const review = { bodies: 0, withSections: 0, declared: 0, parsed: 0, byTier: {}, byVintage: {}, bySeverity: {} };
  try {
    for (const rc of listReviewComments(pr, api)) {
      if (!CODERABBIT_LOGINS.has(str(rc?.user?.login))) continue;
      inline.comments++;
      const f = classifyCodeRabbitComment(rc.body);
      if (!f) continue;
      inline.findings++;
      bump(inline.byVintage, f.vintage);
      bump(inline.bySeverity, f.severity === "" ? `(unrecognised: ${f.severityRaw || "none stated"})` : f.severity);
    }
  } catch (err) {
    log(`#${pr}: could not list review comments (${err.message}); inline counts are incomplete.`);
  }
  try {
    for (const rv of listReviews(pr, api)) {
      if (!CODERABBIT_LOGINS.has(str(rv?.user?.login))) continue;
      if (str(rv.body).trim() === "") continue;
      review.bodies++;
      const { findings, declared } = parseCodeRabbitReview(rv.body);
      if (declared === 0 && findings.length === 0) continue;
      review.withSections++;
      review.declared += declared;
      review.parsed += findings.length;
      for (const f of findings) {
        bump(review.byTier, f.tier);
        bump(review.byVintage, f.vintage);
        bump(review.bySeverity, f.severity === "" ? `(unrecognised: ${f.severityRaw || "none stated"})` : f.severity);
      }
      // Named, not summarised. A review whose sections declare more than this
      // parser read is the exact failure this module keeps re-shipping, so it is
      // reported per review with its own numbers rather than folded into a total.
      if (declared !== findings.length) {
        log(`#${pr}: review ${rv.id} declares ${declared} finding(s) in its section titles; this parser read ${findings.length}.`);
      }
    }
  } catch (err) {
    log(`#${pr}: could not list reviews (${err.message}); review-body counts are incomplete.`);
  }
  return { pr: String(pr), inline, review };
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

/** `--audit`: print what CodeRabbit wrote, per PR, with its own denominators.
 *  Read-only — it never writes `misses.jsonl` and proposes no candidate. */
function cmdAudit(args) {
  const api = gh;
  let prs;
  if (args.pr) {
    prs = [String(args.pr)];
  } else {
    try {
      prs = listCandidatePrs({ since: args.since, api });
    } catch (err) {
      console.error(`harvest: could not list PRs (${err.message}); nothing audited.`);
      process.exit(0);
    }
  }
  const total = { comments: 0, inline: 0, declared: 0, parsed: 0 };
  const tiers = {}, vintages = {};
  for (const pr of prs) {
    const a = auditCodeRabbit(pr, { api });
    total.comments += a.inline.comments;
    total.inline += a.inline.findings;
    total.declared += a.review.declared;
    total.parsed += a.review.parsed;
    for (const [k, v] of Object.entries(a.review.byTier)) tiers[k] = (tiers[k] ?? 0) + v;
    for (const o of [a.inline.byVintage, a.review.byVintage]) for (const [k, v] of Object.entries(o)) vintages[k] = (vintages[k] ?? 0) + v;
    console.log(
      `#${a.pr}\tinline ${a.inline.findings}/${a.inline.comments} comment(s)` +
        `\treview-body ${a.review.parsed}/${a.review.declared} declared across ${a.review.bodies} body(ies)`,
    );
  }
  const pct = total.declared === 0 ? "n/a" : `${((total.parsed / total.declared) * 100).toFixed(1)}%`;
  console.error(
    `harvest: ${prs.length} PR(s). Inline: ${total.inline} finding(s) from ${total.comments} CodeRabbit comment(s). ` +
      `Review bodies: ${total.parsed} of ${total.declared} declared (${pct}). ` +
      `Total ${total.inline + total.parsed}.`,
  );
  if (total.parsed !== total.declared) {
    console.error(`harvest: ${total.declared - total.parsed} declared review-body finding(s) were NOT read; each review is named above.`);
  }
  console.error(`harvest: by vintage ${JSON.stringify(vintages)}; by review-body tier ${JSON.stringify(tiers)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv, { booleans: ["append", "audit"] });
  if (args.pr !== undefined && !/^\d+$/.test(String(args.pr))) {
    console.error("harvest: --pr takes a PR number");
    process.exit(2);
  }
  if (args.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.since))) {
    console.error("harvest: --since takes an ISO date (YYYY-MM-DD)");
    process.exit(2);
  }
  if (args.audit) cmdAudit(args);
  else cmdHarvest(args);
}
