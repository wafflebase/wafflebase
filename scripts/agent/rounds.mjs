// Round arithmetic for the review-round guard (agent-review-panel.yml's `fix`
// job), plus the comment markers that start and stop the loop.
//
// WHAT COUNTS AS A FIX ATTEMPT takes two filters, and for a long time it had only
// the first. A merge commit (2 parents, e.g. a human `git merge main` on an
// iterating PR) is not a fix attempt: PR #521 had 3 single-parent fixer commits
// and 3 merges, and all 6 counted. But parent count alone is not enough either —
// the implement workflow pushes its work, self-reviews, and pushes AGAIN, so two
// commits draw two panel rounds before the fix loop has run once. Both were
// counted, which on #648 and #605 consumed exactly 2 of the budget and left
// `MAX_REVIEW_ROUNDS: 3` meaning ONE real attempt.
//
// The second filter is time: a commit committed BEFORE the panel first spoke
// cannot be a response to it. Deliberately identity-independent, like the first —
// the bot identity behind fixer pushes has already changed once in this
// pipeline's history, so neither "who pushed" nor a name is a durable signal.
//
// It is a heuristic about ORDERING, not provenance, and the edge is worth naming:
// if a panel verdict lands before the implementer's self-review push, that push
// counts as an attempt. Nothing in the data distinguishes them, and the direction
// is the conservative one (it over-counts, which pages early and is undone by
// `@claude rerun`).

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

/**
 * Hidden marker `agent-rerun.yml` writes when a maintainer un-sticks a PR.
 *
 * `@claude rerun` (#650) already clears the paged latch and re-runs CI — it
 * DELETES the paged comments outright, so nothing here needs to out-date them.
 * What it could not do is give the loop its budget back: its own summary says
 * the PR is "still bounded by the pipeline's round/attempt caps", which on a PR
 * that reached the cap means one panel round and an immediate re-page. This
 * marker is the resume point that fixes that.
 *
 * A hidden marker rather than the visible prose, because the prose is a message
 * to a human and will be reworded; and on the RESULT comment rather than a new
 * one, so un-sticking stays a single comment in the thread.
 */
export const RERUN_MARKER = "<!-- agent-rerun -->";

/**
 * ISO timestamp of the newest rerun, or null.
 *
 * Author-checked for the same reason the paged latch is: this repo is PUBLIC, and
 * the marker GRANTS the loop a fresh budget. A body test alone would let any
 * account post it and hand the fixer unlimited attempts. Only the workflow's own
 * bot, or a human with write access, may move the floor.
 */
export function rerunPointFrom(comments) {
  const stamps = (Array.isArray(comments) ? comments : [])
    .filter(isRerunComment)
    .map((c) => Date.parse(String(c.created_at ?? "")))
    .filter((n) => Number.isFinite(n));
  return stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
}

/**
 * Does this comment grant the loop a fresh budget?
 *
 * TWO restrictions, both narrower than the paged latch's, because the direction is
 * the opposite one: the latch only ever stops work, while this RESTARTS a safety
 * cap.
 *
 * FIRST LINE, not a substring. A substring test is re-armable by anyone who merely
 * quotes the marker — this repo already proved it, when clearing #648 by hand
 * re-armed the paged latch with the sentence explaining its removal. Worse here:
 * `agent-summarize.yml`, `agent-review-on-demand.yml` and `agent-review-reply.yml`
 * all publish LLM output verbatim under an allow-listed bot login, so a substring
 * test makes "a model emitted the marker" enough to reset the cap. The real writer
 * puts it on line one; nothing else does.
 *
 * BOT ONLY — no `author_association` path. `agent-rerun.yml` is the sole writer and
 * posts as an allow-listed App, while a human's route is the `@claude rerun`
 * command, which gates on `getCollaboratorPermissionLevel` (actual write access).
 * Accepting `author_association` here would grant the budget on a strictly weaker
 * credential than the command enforces — `MEMBER` is org membership, not repo
 * write — so the hand-written path is refused rather than left as the soft
 * underbelly of the stronger one.
 */
export function isRerunComment(comment) {
  const c = comment && typeof comment === "object" ? comment : {};
  const firstLine = String(c.body ?? "").split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  if (firstLine !== RERUN_MARKER) return false;
  const user = c.user && typeof c.user === "object" ? c.user : {};
  return user.type === "Bot" && PAGE_AUTHOR_LOGINS.includes(user.login);
}

/** A commit has exactly one parent — i.e. it is not a merge commit.
 *
 * NOT "was pushed by the fixer", which is what the old name (`isFixerCommit`)
 * claimed and what every caller read it as. It cannot know that: the check is
 * deliberately identity-independent, because the bot identity behind fixer
 * pushes has already changed once in this pipeline's history. See
 * `countFailedReviewRounds` for what actually separates a fix attempt from the
 * implementer's own commits. */
export function isSingleParentCommit(commit) {
  return Array.isArray(commit?.parents) && commit.parents.length === 1;
}

/** Earliest completed panel verdict anywhere on the PR, or null. */
function firstVerdictAt(commits, names) {
  const stamps = [];
  for (const c of Array.isArray(commits) ? commits : []) {
    for (const r of c?.checkRuns ?? []) {
      // Same app guard every other lens-run consumer applies. Without it a
      // same-named check from another installed App lowers the floor, which
      // widens the count — the wrong direction for a value that gates a cap.
      if (!names.has(r?.name) || r?.app?.slug !== "github-actions") continue;
      const t = Date.parse(String(r?.completed_at ?? ""));
      if (Number.isFinite(t)) stamps.push(t);
    }
  }
  return stamps.length ? Math.min(...stamps) : null;
}

/**
 * How many times has the FIX LOOP tried and failed?
 *
 * This used to count every single-parent commit carrying a failing lens verdict,
 * which is not the same thing and was wrong on every agent PR measured. The
 * implement workflow pushes its work, self-reviews, fixes what it found, and
 * pushes AGAIN — two commits, each triggering CI, each drawing its own panel
 * round. Both were counted as failed fix rounds before the fix loop had run once.
 * On #648 and #605 alike that silently consumed exactly 2 of the budget, so when
 * #615 lowered `MAX_REVIEW_ROUNDS` from 5 to 3 believing it was trimming a
 * wasteful tail, the real effect was to cut the loop from three attempts to ONE.
 * #648 then reported "requested changes 3 times without converging" after a
 * single fix attempt.
 *
 * A commit committed BEFORE the panel first spoke cannot be a response to it.
 * That is the whole discriminator, it needs no identity, and it is already in the
 * data. `since` moves the floor forward again after a maintainer's `@claude rerun`, so a
 * hand-back grants a fresh budget rather than resuming one already spent.
 */
export function countFailedReviewRounds(commits, requiredCheckNames, { since = null } = {}) {
  const names = new Set(requiredCheckNames ?? []);
  const isFailingLensRun = (r) =>
    names.has(r.name) && r.app?.slug === "github-actions" && r.conclusion === "failure";
  // Epoch milliseconds, not ISO strings. Lexicographic comparison is only correct
  // for Z-normalised, equal-precision timestamps; GitHub happens to emit those
  // today, which makes a string compare a latent dependency on an API detail
  // rather than a property of the code.
  const first = firstVerdictAt(commits, names);
  const s = Date.parse(String(since ?? ""));
  const sinceMs = Number.isFinite(s) ? s : null;
  const floor = first === null ? null : sinceMs !== null && sinceMs > first ? sinceMs : first;
  // `Array.isArray`, not `?? []`: a non-array truthy value (a string from a
  // mis-wired caller) passes the nullish guard and then throws on `.filter`,
  // which fails the guard STEP rather than the round count — and a thrown guard
  // is a dead fix job, not a conservative one.
  return (Array.isArray(commits) ? commits : []).filter((c) => {
    if (!isSingleParentCommit(c)) return false;
    if (!(c.checkRuns ?? []).some(isFailingLensRun)) return false;
    // FAILS TOWARD COUNTING, and the direction matters more here than the
    // precision does. This number feeds a CAP: over-counting pages a round early,
    // which a maintainer can undo with `@claude rerun`, while under-counting means
    // the cap never trips and the loop is unbounded — recoverable only if someone
    // happens to notice. So a commit whose position cannot be established counts,
    // and if no verdict timestamp exists anywhere the whole floor is abandoned and
    // every failing commit counts, exactly as before this refinement.
    if (floor === null) return true;
    // Committer date, not author date: a rebased commit keeps an author date that
    // can predate a verdict it plainly followed.
    const at = Date.parse(String(c?.commit?.committer?.date ?? ""));
    if (!Number.isFinite(at)) return true;
    return at > floor;
  }).length;
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
        // `adjudication` rides along even though convergence never reads it:
        // review-round-guard.mjs reaches the rebuttal bound THROUGH this
        // projection, and a narrow projection that silently drops the field is
        // indistinguishable from "nothing was ever disputed" — the page simply
        // never fires. Inert for stall detection, which keys on lens/file/summary
        // and counts by severity.
        findings.push({
          lens,
          severity: f.severity,
          file: f.file,
          summary: f.summary,
          ...(f.adjudication ? { adjudication: f.adjudication } : {}),
          ...(Array.isArray(f.mergedFrom) ? { mergedFrom: f.mergedFrom } : {}),
        });
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
