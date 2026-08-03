// Fixer-commit filter for the review-round guard (agent-review-panel.yml's
// `fix` job). A merge commit (2 parents, e.g. a human `git merge main` to
// resolve conflicts on an iterating PR) is NOT a review-fix attempt and must
// not count toward MAX_REVIEW_ROUNDS — only genuine single-parent commits
// pushed in response to a failing lens should. PR #521 demonstrated this: 3
// single-parent fixer commits + 3 two-parent merge commits, all 6 counted by
// the old (unfiltered) logic toward the round cap.
//
// Deliberately identity-independent (no author/bot-name check): the bot
// identity behind fixer pushes has already changed once in this pipeline's
// history, so parent count — not who pushed — is the durable signal.

/**
 * The marker that latches a PR as "handed to a human". Written by
 * review-round-guard.mjs's `page()` and by the `stalled` job, and read back by
 * BOTH of the pipeline's stop conditions:
 *
 *   - review-round-guard.mjs, to stop dispatching the fixer;
 *   - agent-review-panel.yml's `gate` job, to stop running the panel at all.
 *
 * It lives here, exported, because those two readers are a JS module and a
 * `github-script` step that cannot import one (the `gate` job does no checkout).
 * The workflow therefore carries a literal copy, and `rounds.test.mjs` asserts
 * the two are byte-identical — a drifted copy would not error, it would just
 * silently stop latching, which is the failure mode this constant exists to
 * prevent.
 */
export const PAGED_LATCH = "<!-- agent-review-paged -->";

/**
 * Bot identities allowed to WRITE the latch. Both are real: the guard and the
 * `stalled` job comment with `secrets.GITHUB_TOKEN` (`github-actions[bot]`),
 * while the fix job's branch-head page uses the App token (`yorkie-agent[bot]`).
 *
 * A login allow-list is sound because GitHub reserves the `[bot]` suffix for
 * Apps — no account can register one of these names.
 */
export const PAGE_AUTHOR_LOGINS = Object.freeze(["github-actions[bot]", "yorkie-agent[bot]"]);

/** Associations that mean "has write access to this repo". */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * Does this comment legitimately latch the PR as handed-to-a-human?
 *
 * The marker alone is NOT enough, and this repo is PUBLIC: anyone with a GitHub
 * account can comment on a PR, so a body test on its own lets a stranger post
 * `<!-- agent-review-paged -->` and permanently stop the fixer AND the review
 * panel on any agent PR. Denial of review, from an unauthenticated position.
 *
 * `author_association` cannot carry this on its own — the writing bots report
 * `CONTRIBUTOR`, the same value an arbitrary outside contributor gets. So trust
 * is either an allow-listed bot login, or a human who actually has write access
 * (a maintainer halting the pipeline by hand stays supported).
 *
 * Pure and total: any unknown shape is untrusted, which fails toward reviewing.
 */
export function isPagedLatchComment(comment) {
  const c = comment && typeof comment === "object" ? comment : {};
  if (!String(c.body ?? "").includes(PAGED_LATCH)) return false;
  const user = c.user && typeof c.user === "object" ? c.user : {};
  if (user.type === "Bot" && PAGE_AUTHOR_LOGINS.includes(user.login)) return true;
  return TRUSTED_ASSOCIATIONS.has(String(c.author_association ?? ""));
}

/** A commit is a "fixer" commit iff it has exactly one parent. */
export function isFixerCommit(commit) {
  return Array.isArray(commit?.parents) && commit.parents.length === 1;
}

/**
 * Count commits that are BOTH a fixer commit AND carry a failing required
 * lens check-run from OUR panel (exact name match + producing app, so a
 * same-named check from some other installed app can't inflate the count).
 *
 * `commits`: Array<{ sha, parents, checkRuns: Array<{name, app, conclusion}> }>
 * `requiredCheckNames`: string[]
 */
export function countFailedReviewRounds(commits, requiredCheckNames) {
  const names = new Set(requiredCheckNames ?? []);
  const isFailingLensRun = (r) =>
    names.has(r.name) && r.app?.slug === "github-actions" && r.conclusion === "failure";
  return (commits ?? []).filter(
    (c) => isFixerCommit(c) && (c.checkRuns ?? []).some(isFailingLensRun),
  ).length;
}

// --- convergence detection ---------------------------------------------------
//
// MAX_REVIEW_ROUNDS is a blunt backstop: on PR #521 the loop burned all five
// rounds re-litigating overlapping findings before anyone was paged. This
// detects that shape earlier — but the obvious implementation is wrong, so the
// reasoning matters:
//
//   Overlap between rounds is NOT evidence of a stall. The prior-findings
//   carry-forward in review-panel.mjs deliberately re-merges every unresolved
//   prior finding into the current round, so a HEALTHY PR that fixed 2 of 5
//   findings still shows 3 identical findings next round. Keying on overlap
//   alone would page on essentially every PR.
//
// What separates #521 from a healthy PR is that the blocking count did not go
// DOWN. So a pair of rounds "stalls" only when it is both highly overlapping
// AND not shrinking, and we require two consecutive such pairs before paging.
//
// Fuzzy matching lives here and ONLY here. It must never be pushed into
// dedupeFindings (review-panel.mjs), which DROPS findings — over-merging two
// distinct bugs there is exactly the fail-open its own comment warns about.
// This path only ever reports.

// Common English + review-boilerplate words carry no signal for "is this the
// same finding", and leaving them in inflates every Jaccard score toward 1.
const STOPWORDS = new Set([
  "the", "and", "not", "but", "for", "with", "without", "this", "that", "these", "those",
  "are", "was", "were", "been", "being", "has", "have", "had", "its", "it's", "from",
  "into", "than", "then", "there", "here", "when", "which", "what", "who", "whom",
  "can", "could", "should", "would", "may", "might", "will", "shall", "does", "did",
  "done", "only", "also", "any", "all", "each", "every", "some", "more", "most",
  "actually", "still", "just", "even", "because", "since", "while", "however",
]);

/**
 * Significant tokens of an LLM-written summary: camelCase / snake_case / dotted
 * and slashed identifiers are split apart, punctuation dropped, stopwords
 * removed, then sorted + deduped. The point is stability across rephrasings —
 * the panel routinely emits several different wordings of one defect (PR #564's
 * design-fit lens produced four), and an exact-text key would treat those as
 * four distinct findings.
 *
 * Tokens shorter than 3 chars are dropped as noise (`ts`, `g4`, bare digits).
 */
export function summaryTokens(summary) {
  return [
    ...new Set(
      String(summary ?? "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase → camel Case
        .toLowerCase()
        .split(/[^a-z0-9]+/) // paths, dots, underscores, punctuation all separate
        .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
    ),
  ].sort();
}

const trimmed = (s) => String(s ?? "").trim();

// A couple of incidentally-shared words is never a match, however short the
// shorter summary is. Calibrated below: real same-defect pairs share 7-17
// tokens; real different-defect pairs share at most 1.
export const MIN_SHARED_TOKENS = 3;

/** Default similarity threshold — see the calibration note on `findingSimilarity`. */
export const DEFAULT_SIMILARITY = 0.3;

/**
 * How alike are two findings, in [0, 1]? GATED first: a different lens or a
 * different file scores 0 outright. That gate is what stops "three distinct
 * bugs in one file, fixed one per round" from reading as the same finding three
 * times — similarity is only ever asked within a single (lens, file) pair.
 *
 * The metric is the OVERLAP (containment) coefficient — shared tokens over the
 * smaller token set — not Jaccard. The panel restates one defect at different
 * levels of detail, and Jaccard penalises the extra specifics in the longer
 * wording, which is precisely the wrong behaviour here.
 *
 * Calibrated against real data rather than guessed: PR #564's design-fit lens
 * emitted four wordings of ONE defect, measured against four unrelated real
 * findings from #564/#548.
 *
 *   metric    same-defect        different-defect
 *   jaccard   0.19 - 0.52        0.00 - 0.04
 *   dice      0.32 - 0.68        0.00 - 0.09
 *   overlap   0.39 - 0.71        0.00 - 0.08   <- widest margin
 *
 * Hence `DEFAULT_SIMILARITY = 0.3`: 1.3x under the lowest true positive and
 * 3.75x over the highest true negative. (An initial guess of 0.6 with Jaccard
 * would have matched none of the four real rephrasings.)
 *
 * When either token set degenerates to empty (a punctuation-only or
 * all-stopword summary, or coerceFindings' `(malformed finding …)`
 * placeholder), fall back to exact case-insensitive text equality so a
 * placeholder still matches itself across rounds rather than scoring 0.
 */
export function findingSimilarity(a, b) {
  if (!a || !b) return 0;
  if (trimmed(a.lens) !== trimmed(b.lens)) return 0;
  if (trimmed(a.file) !== trimmed(b.file)) return 0;
  const ta = summaryTokens(a.summary);
  const tb = summaryTokens(b.summary);
  if (ta.length === 0 || tb.length === 0) {
    return trimmed(a.summary).toLowerCase() === trimmed(b.summary).toLowerCase() ? 1 : 0;
  }
  const B = new Set(tb);
  let shared = 0;
  for (const t of ta) if (B.has(t)) shared++;
  if (shared < MIN_SHARED_TOKENS) return 0;
  return shared / Math.min(ta.length, tb.length);
}

/**
 * Fraction of `curr` findings that match ANY finding in `prev` at or above
 * `threshold`. Empty `curr` → 0, so a clean round never counts as a repeat.
 *
 * Matching is deliberately many-to-one: several current findings may all match
 * the same prior. A greedy one-to-one pairing was tried first and is wrong for
 * this question — the panel routinely emits multiple wordings of one defect
 * (PR #564's design-fit lens turned 2 priors into 4 rephrasings), and
 * consuming each prior once scored that 0.5, under-reporting the very case
 * where the loop is most obviously spinning. The question here is "how much of
 * this round is recycled prior material", and when four findings are four
 * wordings of two priors the honest answer is "all of it".
 *
 * The inflation risk that one-to-one guarded against is instead handled by the
 * caller's count test: a round that genuinely found NEW distinct problems has a
 * rising count of *unmatched* findings, and `detectStalledRounds` only treats a
 * pair as stalling when the count also fails to fall.
 */
export function repeatRatio(prev, curr, threshold = DEFAULT_SIMILARITY) {
  const p = Array.isArray(prev) ? prev : [];
  const c = Array.isArray(curr) ? curr : [];
  if (c.length === 0) return 0;
  const matched = c.filter((f) => p.some((q) => findingSimilarity(q, f) >= threshold)).length;
  return matched / c.length;
}

// The two synthetic summaries review-panel.mjs writes when a lens never
// produced a real verdict. Their blocking finding is an infrastructure signal,
// not a review finding, and two consecutive quota outages must not read as a
// stall — the guard already pages separately on the INFRA path.
const INFRA_SUMMARY = /^\s*(Review could not run|Reviewer did not produce a valid verdict)/i;

/**
 * Group the commits + check runs the round guard ALREADY fetched into review
 * rounds, oldest first. One round per commit carrying any of our lens checks;
 * `findings` is the union of each lens's LATEST run's persisted blocking
 * findings, tagged with its lens id.
 *
 * `partial: true` marks a round we could not fully read — a lens with no
 * machine-readable payload, unparseable JSON, or an infra/quota round. A
 * partial round breaks the stall run rather than contributing to it, so an
 * unreadable round can never manufacture a page.
 *
 * `commits`: Array<{ sha, checkRuns: Array<{name, app, output, started_at, completed_at}> }>
 */
export function groupReviewRounds(commits, lensCheckNames) {
  const names = new Set(lensCheckNames ?? []);
  const rounds = [];
  for (const c of Array.isArray(commits) ? commits : []) {
    const runs = (c?.checkRuns ?? []).filter(
      (r) => r && names.has(r.name) && r.app?.slug === "github-actions",
    );
    if (runs.length === 0) continue; // no panel verdict here → not a round
    // Latest run per lens: a re-run supersedes the earlier attempt.
    const latest = new Map();
    for (const r of runs) {
      const t = new Date(r.completed_at || r.started_at || 0).getTime();
      const cur = latest.get(r.name);
      if (!cur || t >= cur.t) latest.set(r.name, { run: r, t });
    }
    const findings = [];
    let partial = false;
    for (const [name, { run }] of latest) {
      const lens = name.replace(/^agent-review-/, "");
      const text = run.output?.text;
      // A CLEAN lens legitimately persists "[]", so an ABSENT payload is not
      // "found nothing" — it means we cannot see what this lens found.
      if (typeof text !== "string" || text === "") {
        partial = true;
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        partial = true;
        continue;
      }
      if (!Array.isArray(parsed)) {
        partial = true;
        continue;
      }
      for (const f of parsed) {
        if (!f || typeof f !== "object" || INFRA_SUMMARY.test(String(f.summary ?? ""))) {
          partial = true;
          continue;
        }
        findings.push({ lens, severity: f.severity, file: f.file, summary: f.summary });
      }
    }
    rounds.push({ sha: c.sha, findings, partial });
  }
  return rounds;
}

/**
 * Is the fix loop re-litigating the same findings instead of converging?
 *
 * Walks CONSECUTIVE round pairs backwards from the newest. A pair stalls iff
 * the blocking count did NOT go down AND `repeatRatio` is at or above
 * `similarity` (default 0.3, calibrated on real findings). `minRepeats` consecutive stalling pairs (default 2, so three
 * rounds of evidence) is the trigger — earliest page at round 3, versus the
 * round-5 cap, while tolerating one noisy round.
 *
 * FAILS TOWARD NOT PAGING. Malformed input, a partial round, or too little
 * history all return `stalled: false`. This is the one place in this pipeline
 * where the safe default is "keep going": MAX_REVIEW_ROUNDS is still the
 * backstop, and a spurious page — summoning a human when the loop was in fact
 * converging — is the more expensive error.
 */
export function detectStalledRounds(rounds, { minRepeats = 2, similarity = DEFAULT_SIMILARITY } = {}) {
  const list = (Array.isArray(rounds) ? rounds : []).filter((r) => r && typeof r === "object");
  const base = { stalled: false, stalls: 0, rounds: list.length, repeated: [] };
  if (list.length < minRepeats + 1) return { ...base, reason: "too-few-rounds" };

  const count = (r) => (Array.isArray(r.findings) ? r.findings.length : 0);
  let stalls = 0;
  const repeated = new Map();

  for (let i = list.length - 1; i >= 1 && stalls < minRepeats; i--) {
    const curr = list[i];
    const prev = list[i - 1];
    if (curr.partial || prev.partial) break; // unreadable → end the trailing run
    if (count(curr) < count(prev)) break; // findings went down → real progress
    if (repeatRatio(prev.findings, curr.findings, similarity) < similarity) break;
    stalls++;
    for (const f of curr.findings) {
      if (!prev.findings.some((p) => findingSimilarity(p, f) >= similarity)) continue;
      repeated.set(`${f.lens}::${trimmed(f.file)}::${trimmed(f.summary).toLowerCase()}`, {
        lens: f.lens,
        file: f.file,
        summary: f.summary,
      });
    }
  }

  const stalled = stalls >= minRepeats;
  return {
    ...base,
    stalled,
    stalls,
    repeated: stalled ? [...repeated.values()] : [],
    reason: stalled ? "repeat-without-reduction" : stalls > 0 ? "partial-stall" : "progressing",
  };
}
