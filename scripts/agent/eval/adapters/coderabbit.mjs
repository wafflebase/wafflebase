// The other arm, behind the same record seam: CodeRabbit's comments → finding
// records. The mirror of `adapters/panel.mjs`, deliberately shaped so the two can
// be read side by side.
//
// Pure and free. It reads the GitHub API and parses stored markdown; it spawns
// nothing, calls no model and needs no API key. Records are NOT stored, for the
// same reason the panel adapter does not store them: they are recomputable from an
// immutable source, so persisting them would spend the store's write-once rule on
// a shape that is cheap to recompute and expensive to correct.
//
// WHAT THIS FILE IS FOR. `harvest.mjs` reads CodeRabbit's two endpoints and
// returns what CodeRabbit wrote, in CodeRabbit's own vocabulary. That is the right
// output for a parser and the wrong input for a comparison: it carries a severity
// scale ours does not have, no notion of a gate, and no statement of WHICH
// SNAPSHOT of a pull request it is about. This file is the arm boundary where
// those three become the record's vocabulary, and every translation it performs is
// named on the record so a scorer can undo it.
//
// THE ASYMMETRY THAT SHAPES EVERY DECISION HERE. Every other module in this
// subsystem can only be wrong in a way that makes OUR numbers worse. This one
// decides which of the other arm's findings count, how its severities map onto
// ours, and what its text looks like before a matcher sees it — so it is the first
// one that can be wrong in a way that makes our numbers BETTER, and a rule that
// quietly drops CodeRabbit findings reads in a diff exactly like ordinary data
// cleaning. Hence the rule applied throughout: WHERE A CHOICE WOULD BENEFIT US,
// RECORD THE FACT AND LET THE SCORER CHOOSE. Nothing here excludes a finding that
// could have been carried, and every coercion is recoverable from the record
// without re-querying GitHub.
//
// WHEN, AS WELL AS WHAT. The same boundary answers how LONG the other arm's review
// took, because the instants that bracket it are CodeRabbit's own comments and the
// check runs on the frozen commit — facts about this arm, fetched the same way, and
// wrong in the same direction if this file is wrong. A scorer that acquired them
// itself would be a second reader of one arm's output. Two intervals are emitted, not
// one, each naming what it is measured from; see `SELF_TIMED_INTERVAL`.
//
// WHAT IS INERT TODAY, STATED PLAINLY. Nothing consumes a finding record yet, on
// either arm, so this module changes no number. What it changes is that the
// numbers CAN be computed, and that the two arms' findings are finally the same
// shape.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN } from "../../vendor/pipeline/severity.mjs";
import { CODERABBIT_LOGINS, classifyCodeRabbitComment, commitIndex, parseCodeRabbitReview } from "../../harvest.mjs";
import { commitCheckRuns, gh, parseArgs } from "../../vendor/pipeline/gh-checks.mjs";
import { ARM_ONLY_FIELDS, POPULATIONS, buildFindingRecord, gatingCensus, validateFindingRecord } from "../finding-record.mjs";

const refuse = (msg) => {
  throw new Error(`coderabbit adapter: ${msg}`);
};

const str = (v) => (typeof v === "string" ? v : "");

/** The first of `vals` that is a usable 1-based line number, else `null`. */
const firstLine = (...vals) => vals.find((v) => Number.isInteger(v) && v >= 1) ?? null;

/**
 * Whether the endpoint this record set was read from was READABLE at all.
 *
 *   present  it answered, including with NOTHING — which is a real answer. A pull
 *            request CodeRabbit reviewed cleanly genuinely has no findings, and a
 *            true negative treated as a failure deletes the other arm's clean
 *            reviews exactly as it would delete ours.
 *   absent   it did not answer, or answered with something that is not a list.
 *
 * Recorded PER ENDPOINT rather than once, because CodeRabbit's output is split
 * across two of them and 50% of it is not the population. A record set built from
 * inline comments alone, reported as though both endpoints had answered, is the
 * defect this whole PR series keeps finding: a count smaller than the truth with
 * nothing in the output saying so.
 */
export const POPULATION_STATES = Object.freeze(["present", "absent"]);

/**
 * WHICH SNAPSHOT of the pull request a CodeRabbit finding is about — the item
 * scoping rule, and the most consequential thing in this file.
 *
 * Our arm replays a pull request at ONE frozen commit — `review_point` says which
 * one, and it is a property of the corpus version rather than a constant — and the
 * panel sees exactly that diff. CodeRabbit reviewed the same pull request whenever
 * it got to it, which need not be that commit. So "every CodeRabbit comment on PR
 * #471" and "what our panel was shown" are two different questions, and a
 * comparison that pretends otherwise is comparing two reviewers on two different
 * inputs.
 *
 * FOUR values, and the measurement is why there are four rather than two. Measured
 * 2026-08-07 over a corpus frozen at `review_point: pr-open`, all seven pilot
 * items, n=30 findings: 3 in-window (10.0%) · 24 after-window (80.0%) ·
 * 3 unplaceable (10.0%). The split is a property of the FREEZE, not of the rule:
 * re-measured 2026-08-10 over the same seven items frozen instead at each pull
 * request's reviewed commit (`review_point: pinned`), the same n=30 reads
 * 30 in-window · 0 after-window · 0 unplaceable. Both are real answers about
 * different questions, which is why all four values still exist.
 *
 *   in-window     the commit this finding was written against IS the frozen
 *                 `review_commit`, or is before it. Our panel saw that snapshot.
 *   after-window  it is after. Our panel never saw that code.
 *   unplaceable   the finding names a commit that is neither the frozen one nor on
 *                 the pull request, or names none, or the frozen commit itself
 *                 cannot be located while the finding sits on some OTHER commit.
 *                 NOT a side of the line — a force-push rewrites history and leaves
 *                 `original_commit_id` pointing at an object no longer reachable
 *                 from the branch, which `harvest.mjs` already documents as a trap
 *                 and which really happens: PR #415's only CodeRabbit review sits
 *                 on `51c01826a`, and the PR's commit list no longer contains it
 *                 (`51c01826a` compares as `diverged` against the head, ahead 3 /
 *                 behind 1). What makes THAT case placeable anyway is that the item
 *                 is frozen at `51c01826a` too — see `commit-is-review-commit`.
 *   no-window     no frozen `review_commit` was supplied, so the question does not
 *                 apply. Separated from `unplaceable` for the same reason
 *                 `GATING` separates `not-applicable` from `unknown`: "this pull
 *                 request was never frozen" is a fact about the call, not
 *                 uncertainty about the finding, and pooling the two would make
 *                 "how much of our data could not be placed?" scale with how many
 *                 off-corpus pull requests somebody asked about.
 *
 * NOTHING IS EXCLUDED ON THIS BASIS. The rule TAGS; it does not filter. That is
 * the measurement's doing rather than a preference: on the `pr-open` freeze above,
 * a strict in-window rule would leave the CodeRabbit arm with 3 findings across the
 * entire pilot and would zero five of the seven items — and it would do so for a
 * reason that is not CodeRabbit's advantage. Excluding 80% of the comparator's
 * findings, in a comparison we are running about ourselves, is not a defensible
 * default.
 */
export const WINDOW = Object.freeze(["in-window", "after-window", "unplaceable", "no-window"]);

/**
 * WHY the `window` value is what it is — cause → answer, frozen so the two can
 * never be stated independently and disagree. The same construction as
 * `GATING_BASIS`, for the same reason: one fact stated twice is a fact that
 * eventually contradicts itself.
 */
export const WINDOW_BASIS = Object.freeze({
  /** The finding's commit IS `review_commit`. Answered from the two shas alone,
   *  which is why it is a basis of its own rather than a case of the next one: an
   *  ORDER needs the pull request's commit list, and identity does not. The list is
   *  mutable — a force-push rewrites it — so requiring the frozen commit to still be
   *  on the pull request would make an answer we already hold depend on something
   *  that can be taken away afterwards. It really is taken away: pr-415's 3 findings
   *  sit exactly on the commit that item is frozen at, on a pull request whose one
   *  remaining commit is a different one.
   *
   *  Not a corner either, on a corpus frozen at the reviewed commit: measured
   *  2026-08-10 over `2026-08-10-pilot-reviewed`, ALL 30 findings across the 7
   *  items carry this basis and none carries `commit-at-or-before-review`. That is
   *  a fact about the freeze, not about the rule — and it is why the two are
   *  separate keys. Pooled, the census could not say that no finding in this
   *  corpus version needed the commit list at all. */
  "commit-is-review-commit": "in-window",
  /** The finding's commit is at or before `review_commit` in the PR's commit list.
   *  In practice this now means strictly BEFORE — equality is answered above,
   *  before the list is consulted at all — and the name still describes every
   *  record that carries it. */
  "commit-at-or-before-review": "in-window",
  /** It is after it. */
  "commit-after-review": "after-window",
  /** The commit is not on the pull request at all — the force-push case. */
  "commit-not-on-pr": "unplaceable",
  /** The finding names no commit. Reachable: a review body carries one `commit_id`
   *  for the whole review and GitHub may return it empty. */
  "commit-absent": "unplaceable",
  /** The frozen `review_commit` is not on the pull request either, so there is no
   *  line to be on a side of — and the finding is not sitting on it, or the basis
   *  above would have answered. Distinct from `commit-not-on-pr`: this one means the
   *  WINDOW is unlocatable, which invalidates every finding on the item rather
   *  than one of them, and a CLI that prints the census will show all of them. */
  "review-commit-not-on-pr": "unplaceable",
  /** The PR's commit list could not be read. */
  "commits-unavailable": "unplaceable",
  /** No frozen `review_commit` was supplied — an off-corpus pull request. */
  "no-review-commit": "no-window",
});

/**
 * Where does this finding sit relative to the frozen snapshot? Pure, exported and
 * the one place the question is answered — deliberately not buried in the mapping
 * loop, because it decides what the comparison measures and therefore has to be
 * readable and arguable on its own.
 *
 * `commitIndex` is COMPOSED, not re-implemented: it is `harvest.mjs`'s own reader
 * of "position of a sha in the PR's commit list, or -1", and a second ordering
 * rule beside it is how the two would come to disagree about a force-push.
 *
 * ORDERING IS LOAD-BEARING. `no-review-commit` is tested first, so an off-corpus
 * call never reports a finding as `unplaceable` merely because nobody asked about
 * a window. The window's own resolvability is tested next, before the finding's:
 * if the frozen commit cannot be found, no answer about the finding is available,
 * and reporting `after-window` because the review commit resolved to -1 would put
 * every finding on the wrong side of a line that was never drawn.
 *
 * IDENTITY IS TESTED BEFORE EITHER COMMIT IS LOOKED UP, and that is the order this
 * function originally had backwards. Ordering exists to answer "is this commit
 * before or after that one?"; when the two are THE SAME COMMIT there is nothing to
 * order, and the commit list — which a force-push rewrites at any time — has no
 * bearing on the answer. Asking for the frozen commit's position first made
 * the function report `unplaceable` for a finding while looking at the exact commit
 * that finding's review was posted against: on the pilot corpus, all 3 of the
 * findings it could not place were pr-415's, every one of them sitting on the very
 * commit pr-415 is frozen at, unplaceable only because a force-push later left that
 * commit off the pull request.
 *
 * `commits-unavailable` DELIBERATELY still wins over identity, even though the
 * identity answer would be just as correct without the list. An unreadable commit
 * list is OUR failure and it costs the placement of every finding on the item; the
 * CLI says so in those words and asks for a re-run. Answering some of that item's
 * findings from identity would make a whole-item read failure look partial, for no
 * gain on any real input — a pull request whose commits could not be listed is one
 * we re-run, not one we harvest a few placements from.
 */
export function placeInWindow({ commits, reviewCommit, atCommit } = {}) {
  const basis = (b) => ({ window: WINDOW_BASIS[b], window_basis: b });
  if (str(reviewCommit).trim() === "") return basis("no-review-commit");
  const list = Array.isArray(commits) ? commits : null;
  if (list === null || list.length === 0) return basis("commits-unavailable");
  // The SAME comparison `commitIndex` makes, whole string against whole string, so
  // the two can never disagree about which shas are one commit. Nothing looser: an
  // abbreviation that prefix-matched would place a finding on a guess, and the fail
  // direction here is `unplaceable`, never a maybe. Both being empty cannot reach
  // this line — `no-review-commit` above is what stops it.
  if (str(atCommit) === str(reviewCommit)) return basis("commit-is-review-commit");
  const reviewIdx = commitIndex(list, reviewCommit);
  if (reviewIdx < 0) return basis("review-commit-not-on-pr");
  if (str(atCommit).trim() === "") return basis("commit-absent");
  const at = commitIndex(list, atCommit);
  if (at < 0) return basis("commit-not-on-pr");
  return basis(at <= reviewIdx ? "commit-at-or-before-review" : "commit-after-review");
}

/**
 * WHERE the record's `severity` came from. A third field beside the value and the
 * original word, because for a third of CodeRabbit's findings the value is a FLOOR
 * rather than a measurement, and a floor indistinguishable from a measurement is
 * this project's signature failure.
 *
 *   header-field  CodeRabbit wrote a severity in the finding's header. 1977 of
 *                 3001 findings, measured 2026-08-07 over the whole repository.
 *   tier-heading  it wrote none there, but filed the finding under a section whose
 *                 TITLE names a severity in its own vocabulary — "🧹 Nitpick
 *                 comments", "🟡 Minor comments". 635 findings. This is reading
 *                 CodeRabbit's label, not inventing one, and the data says so:
 *                 wherever a nitpick-tier finding ALSO carries a header severity,
 *                 that severity is `trivial` — on all 274 of them, never anything
 *                 else — and `trivial` is what `harvest.mjs` already maps to `nit`.
 *                 The heading and the field agree wherever both exist, 274/274 for
 *                 nitpick and 95/95 for minor.
 *   unstated      CodeRabbit stated no severity anywhere. 389 findings — both
 *                 retired inline vintages state none by construction (75), and so
 *                 does the whole Additional-comments tier (296). The record must
 *                 still carry one of `KNOWN`, so it carries the FLOOR (see
 *                 `UNSTATED_SEVERITY`) and says here that it is a floor.
 *
 * ⚠ NO SEVERITY-SEGMENTED NUMBER MAY POOL AN `unstated` RECORD WITH A STATED ONE.
 * That is the same instruction `panel.gate_state` carries on our side and for the
 * same reason: a default that is indistinguishable from a measurement.
 */
export const SEVERITY_BASIS = Object.freeze(["header-field", "tier-heading", "unstated"]);

/**
 * Review-body tiers whose section TITLE states a severity, in CodeRabbit's own
 * words. Exactly two entries, and both are corroborated rather than assumed —
 * see `SEVERITY_BASIS`.
 *
 * The tiers deliberately NOT here, and why each is left `unstated` instead:
 *
 *   additional          "Additional comments" names no severity, and none of its
 *                       296 findings carries one either. There is nothing to read.
 *   duplicate           its 69 findings carry critical, major AND minor, so the
 *                       heading demonstrably does not determine the severity.
 *   outside-diff-range  likewise: critical, major and minor all appear under it.
 *   combined            names three tiers at once, so it is ambiguous by
 *                       construction.
 *   failed-to-post      4 of its 5 findings state `minor`, which is unanimous and
 *                       meaningless — "Comments failed to post" describes a
 *                       delivery failure, not a severity, and a rule inferred from
 *                       four samples of an incidental agreement is a guess wearing
 *                       a measurement's clothes.
 *
 * This table lives HERE and not in `harvest.mjs` on purpose. It is not a second
 * copy of `CR_SEVERITY` — that maps CodeRabbit's severity WORDS and stays the
 * parser's — this maps CodeRabbit's SECTION HEADINGS, which is a judgement about
 * how to read one arm's output for comparison against another. Decision 17's rule:
 * a foreign vocabulary is translated where it crosses.
 */
export const TIER_SEVERITY = Object.freeze({ nitpick: "nit", minor: "minor" });

/**
 * The severity a record carries when CodeRabbit stated none anywhere.
 *
 * `nit` rather than `normalizeSeverity`'s `major`, and the choice is forced from
 * both sides. `major` is BLOCKING, so it would file 389 findings — 296 of them
 * from a tier CodeRabbit titles "Additional comments" — as gate-blocking defects
 * in the other arm; that is #714's 268-trivial-nits bug with a different
 * denominator. `nit` claims the least: it is the bottom of the scale, so it asserts
 * nothing CodeRabbit did not, and it cannot inflate the other arm's blocking count.
 *
 * It is NOT a neutral choice and this file does not pretend it is — it moves those
 * findings out of CodeRabbit's blocking population, which flatters us. That is
 * exactly why `severity_basis: "unstated"` is mandatory on every such record and
 * why the CLI counts them: the alternative to a visible floor is not a better
 * value, it is an invisible one.
 */
export const UNSTATED_SEVERITY = "nit";

/**
 * The corpus item id for a pull request.
 *
 * `pr-<n>` is built inline by `buildItemMeta` and exported from nowhere, so this is
 * the one string this module re-types. It is pinned by a test that asserts
 * agreement with `buildItemMeta`'s own output rather than with this function's, so
 * the duplication cannot drift silently — the alternative was exporting a helper
 * out of `extract-corpus.mjs`, a file this change has no other reason to touch.
 *
 * It is always well-formed, which is what makes this adapter work on ANY pull
 * request rather than only the seven frozen ones: `pr-471` names the pull request
 * a finding is on, which is true whether or not that pull request was ever frozen.
 * Corpus membership is NOT implied by the id — it is reported by `window`, which
 * reads `no-window` for a pull request nobody froze.
 */
export function codeRabbitItemId(pr) {
  const n = String(pr ?? "").trim();
  if (!/^\d+$/.test(n)) refuse(`a pull request number is required, got ${JSON.stringify(pr)}`);
  return `pr-${Number(n)}`;
}

/**
 * CodeRabbit's severity, translated at the boundary, with the translation named.
 *
 * `harvest.mjs` owns the severity WORD table (`CR_SEVERITY`, `trivial` → `nit`) and
 * this function does not duplicate it: a parsed finding arrives with `severity`
 * already in our vocabulary or empty. What this adds is the tier reading and the
 * floor, and the ASSERTION that nothing foreign gets past here — because
 * `buildFindingRecord` runs `normalizeSeverity`, whose unknown → `major` fail-safe
 * is correct for our gate and catastrophic for this arm. If a fifth vintage
 * teaches the parser a word this module has never seen, it stops here loudly
 * instead of arriving in the corpus as a blocker.
 */
export function severityOf(parsed) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  const stated = str(p.severity).trim();
  const raw = str(p.severityRaw);
  if (stated !== "") {
    if (!KNOWN.includes(stated)) {
      refuse(
        `the parser returned severity ${JSON.stringify(stated)}, which is outside ${KNOWN.join(" | ")} — ` +
          `a foreign vocabulary is translated at the arm boundary and this is that boundary, so it must not reach ` +
          `buildFindingRecord, where normalizeSeverity would read it as a blocking major`,
      );
    }
    return { severity: stated, stated_severity: raw || stated, severity_basis: "header-field" };
  }
  const fromTier = TIER_SEVERITY[str(p.tier)];
  if (fromTier) return { severity: fromTier, stated_severity: raw, severity_basis: "tier-heading" };
  return { severity: UNSTATED_SEVERITY, stated_severity: raw, severity_basis: "unstated" };
}

/**
 * One inline review comment → the finding object handed to `buildFindingRecord`.
 *
 * WIDENS, NEVER NARROWS: the parser's whole output is spread and the three fields
 * only the API knows are added beside it. Never rebuilt from a field list — that
 * is the convention upstream fixed once in `normalizeFindings` and that three
 * copies of the same mistake outlived, and it is what puts `severityRaw`, `effort`,
 * `category` and `detail` into `record.coderabbit.raw` whether or not this file has
 * heard of them.
 *
 * THE LINE AND THE COMMIT ARE READ FROM THE SAME SNAPSHOT. `original_*` describes
 * the commit the comment was written on and `line`/`commit_id` describes where
 * GitHub places it now; taking the line from one and the commit from the other
 * would produce a location that exists in neither tree. GitHub also leaves `line`
 * NULL whenever the comment has gone outdated, which is most of them — of the four
 * pinned fixtures, three have `line: null` and a populated `original_line` — so the
 * original pair is the more complete one as well as the consistent one.
 *
 * The START of the range, not the end: `original_line` is the last line of a
 * multi-line comment, and the review-body path reads the start out of its `97-114`
 * locator, so taking the start on both keeps one meaning for `line` across
 * CodeRabbit's two halves.
 */
export function inlineFinding(rc) {
  const parsed = classifyCodeRabbitComment(rc?.body);
  if (!parsed) return null;
  const onOriginal = str(rc?.original_commit_id).trim() !== "";
  return {
    ...parsed,
    file: str(rc?.path),
    line: onOriginal ? firstLine(rc?.original_start_line, rc?.original_line) : firstLine(rc?.start_line, rc?.line),
    // The WHOLE body, matching `harvestPr`'s own call site and for its documented
    // reason: `extractAnchor` mines structured items out of it — the backticked
    // identifiers and the `around lines N - M` range inside the `🤖 Prompt for AI
    // Agents` block — where more text is strictly better. The prose-only cut lives
    // in `raw.detail`, which is what a token comparison should read instead.
    evidence: str(rc?.body),
  };
}

/**
 * One review → the findings nested in its body, each as a finding object.
 *
 * `parseCodeRabbitReview` already returns `file`, `locator`, `tier` and `detail`
 * per finding, so this adds only the two fields the record needs by name.
 *
 * `evidence` is the prose, not the whole body: the parser does not return the
 * per-finding SPAN it sliced, so the finding's own text is the most that is
 * available here. That is a real asymmetry with the inline path — the anchor layer
 * sees less on this half — and it is a field `harvest.mjs` does not return rather
 * than something to re-derive with a second parser in here.
 */
export function reviewBodyFindings(rv) {
  const { findings, declared, shortfall, unrecognised } = parseCodeRabbitReview(rv?.body);
  return {
    declared,
    shortfall,
    unrecognised,
    findings: findings.map((f) => ({
      ...f,
      // The locator's START, so `line` means the same thing on both halves. A
      // locator is not always numeric — `CR_LOCATOR` also matches a backticked
      // path — so a non-numeric one yields `null` rather than a coerced 0, which
      // `validateFindingRecord` would refuse anyway.
      line: firstLine(Number.parseInt(str(f.locator), 10)),
      evidence: str(f.detail),
    })),
  };
}

/**
 * The arm-namespace fields, from the finding plus the placement. Read, never
 * invented: a field CodeRabbit did not state stays `""` or `null` rather than being
 * defaulted into something a scorer would read as a measurement.
 *
 * The key set is ASSERTED against `ARM_ONLY_FIELDS.coderabbit` rather than
 * described by it. `finding-record.mjs` names the list so that "what could the
 * other arm not fill?" is answerable by reading the schema, and a list that only
 * documents what an adapter happens to emit is a list that goes stale the first
 * time somebody adds a field here — which is the whole failure mode
 * `ARM_ONLY_FIELDS` was introduced empty to avoid.
 */
function findingDetail(f, { source, ids, placement, reviewCommit, severity }) {
  return checkArmFields(buildDetail(f, { source, ids, placement, reviewCommit, severity }));
}

/**
 * Refuse an arm namespace whose keys are not exactly `ARM_ONLY_FIELDS.coderabbit`.
 *
 * EXPORTED so it can be tested against a drifted object. It is a guard against a
 * future edit rather than against today's code, so asserting the namespace's keys
 * on a correct record does not exercise it — remove the check and every such
 * assertion still passes. A guard nothing can prove fires is decoration, which is
 * this project's third lesson.
 *
 * It has already earned its place once: the first real invocation caught
 * `severity` — a TOP-LEVEL record field — being spread into the namespace, which
 * no hand-written key assertion would have caught, because I would have asserted
 * the keys I meant to emit.
 */
export function checkArmFields(detail) {
  const named = new Set(ARM_ONLY_FIELDS.coderabbit);
  const got = Object.keys(detail ?? {});
  const extra = got.filter((k) => !named.has(k));
  const missing = ARM_ONLY_FIELDS.coderabbit.filter((k) => !got.includes(k));
  if (extra.length || missing.length) {
    refuse(
      `the coderabbit namespace does not match ARM_ONLY_FIELDS.coderabbit in finding-record.mjs` +
        (extra.length ? ` — emitted but not named: ${extra.join(", ")}` : "") +
        (missing.length ? ` — named but not emitted: ${missing.join(", ")}` : "") +
        `. Both are one list; add the field in both places or in neither`,
    );
  }
  return detail;
}

function buildDetail(f, { source, ids, placement, reviewCommit, severity }) {
  return {
    // WHICH ENDPOINT. CodeRabbit's two halves are not interchangeable: the inline
    // one carries a real diff position and a per-comment commit, the review-body
    // one carries a tier and one commit for the whole review. PR 8's decision 4
    // asked how a consumer dedupes across them; this is the field that lets it.
    source,
    // Kept per finding rather than pooled. A ♻️ Duplicate is the same defect said
    // twice and double-counts any volume metric; ⚠️ Outside diff range is a finding
    // about code the pull request did not touch, which is a different comparison
    // entirely. `""` for an inline comment, which has no tier.
    tier: str(f.tier),
    // The header vintage the finding was written in. A real confound in any count
    // taken across the 2026-06-22/23 vocabulary switch, so it rides on the record
    // rather than being normalised away.
    vintage: str(f.vintage),
    vocabulary: str(f.vocabulary),
    category: str(f.category),
    effort: str(f.effort),
    // `harvest.mjs` maps only the two categories that map onto one of our lenses
    // WITHOUT judgement, and leaves the rest `""` for a curator. Carried as-is: a
    // guessed lens would corrupt exactly the per-lens comparison it looks like it
    // enables.
    lens: str(f.lens),
    // The two translation fields ONLY. `severity` itself is a top-level field, and
    // spreading `severityOf`'s whole return here put a copy of it in the namespace
    // — caught by the key assertion above on its first run. A top-level field
    // duplicated into an arm namespace is two places for one fact to be read from,
    // and the namespace copy is the one nothing validates.
    stated_severity: severity.stated_severity,
    severity_basis: severity.severity_basis,
    ...ids,
    ...placement,
    // The frozen commit the window was drawn at, so which line a finding fell on
    // the wrong side of is answerable from the record alone.
    review_commit: str(reviewCommit) || null,
  };
}

/**
 * CodeRabbit's output on one pull request → finding records.
 *
 * A READ PATH, so it degrades to fewer records rather than throwing — but never
 * silently: whatever it could not build a record from comes back in `dropped` with
 * the id that names it, and the CLI prints every row. It throws only when its
 * CALLER is wrong: no pull request number, or a population CodeRabbit does not
 * have.
 *
 * `population` is always `reported`. `POPULATIONS`' other value, `sampled`, is our
 * arm's "what could this reviewer find across repeated tries?" — CodeRabbit posts
 * once and has no counterpart to it, so the honest answer is that the population
 * does not exist rather than that it is empty. Asking for it is a caller error.
 *
 * `run_id` is `null` on every record, which is a fact about this arm rather than a
 * missing value: `run_id` exists so K replicates stay distinguishable, and
 * CodeRabbit has no replicates. Its provenance — the review id, the comment id, the
 * url — is in the arm namespace, where arm-specific facts belong.
 */
export function codeRabbitRecords({ pr, reviewCommit = null, commits = null, comments = null, reviews = null } = {}, { population = "reported" } = {}) {
  if (!POPULATIONS.includes(population)) {
    refuse(`population must be one of ${POPULATIONS.join(" | ")}, got ${JSON.stringify(population)}`);
  }
  if (population !== "reported") {
    refuse(
      `population ${JSON.stringify(population)} does not exist in this arm — CodeRabbit posts once, so there is no ` +
        `pre-dedupe sample set to read. Zero records would read as "it found nothing", which is a different fact`,
    );
  }
  const itemId = codeRabbitItemId(pr);
  const dropped = [];
  const records = [];
  const sources = {
    inline: Array.isArray(comments) ? "present" : "absent",
    review_body: Array.isArray(reviews) ? "present" : "absent",
    // The commit list is the THIRD input and the one the whole window rule rests
    // on, so its state is reported beside the other two rather than folded into
    // them. Kept separate from `population_state` on purpose: an unreadable commit
    // list loses the PLACEMENT of every finding on the item while the findings
    // themselves are all present, and pooling "we could not read what CodeRabbit
    // wrote" with "we could not tell which snapshot it was about" is the same
    // mistake as pooling the causes of an absent lane.
    //
    // This is not hypothetical: the first live run of the CLI hit a network
    // timeout on pr-415's commits call and printed `window unplaceable=3` — which
    // was the right answer for the wrong reason, since that item's findings are
    // genuinely unplaceable for a force-push. Nothing in the output distinguished
    // the two, which is why the CLI now prints the BASIS rather than the value.
    commits: Array.isArray(commits) && commits.length > 0 ? "present" : "absent",
  };
  const declared = { review_body: 0, shortfall: 0, unrecognised: [] };

  const build = (f, ctx) => {
    const severity = severityOf(f);
    const placement = placeInWindow({ commits, reviewCommit, atCommit: ctx.atCommit });
    // The pair is checked here rather than trusted, exactly as
    // `validateFindingRecord` checks `gating` against `gating_basis`: two
    // expressions of one fact, and the point of checking is that a future edit to
    // `WINDOW_BASIS` has to survive it.
    if (WINDOW_BASIS[placement.window_basis] !== placement.window) {
      refuse(`window ${JSON.stringify(placement.window)} contradicts basis ${JSON.stringify(placement.window_basis)}`);
    }
    const finding = { ...f, severity: severity.severity };
    return buildFindingRecord({
      arm: "coderabbit",
      itemId,
      runId: null,
      population: "reported",
      finding,
      detail: findingDetail(f, { ...ctx, placement, reviewCommit, severity }),
    });
  };

  for (const rc of Array.isArray(comments) ? comments : []) {
    // EXACT login, and this is `harvest.mjs`'s own set rather than a second copy of
    // it. Attributing a comment to CodeRabbit is what `arm: "coderabbit"` claims,
    // and `startsWith("coderabbitai")` also accepts `coderabbitai-x`, which anyone
    // can register and comment on a public pull request with.
    if (!CODERABBIT_LOGINS.has(str(rc?.user?.login))) continue;
    const f = inlineFinding(rc);
    if (!f) {
      // Not a finding: a threaded reply to a maintainer, or a walkthrough. 6 of the
      // 22 CodeRabbit inline comments on the pilot items are replies of the form
      // "@user Thanks for confirming — that resolves …". Counted rather than
      // ignored, so "CodeRabbit said nothing here" and "this was not a finding" stay
      // apart.
      dropped.push({ source: "inline-comment", id: String(rc?.id ?? ""), reason: "not-a-finding" });
      continue;
    }
    records.push(
      build(f, {
        source: "inline-comment",
        atCommit: str(rc?.original_commit_id) || str(rc?.commit_id),
        ids: {
          comment_id: String(rc?.id ?? "") || null,
          review_id: String(rc?.pull_request_review_id ?? "") || null,
          posted_at: str(rc?.created_at) || null,
          url: str(rc?.html_url) || null,
          // BOTH commits, so a scorer can re-place a finding under the other rule
          // without re-querying GitHub. They differ on real data and the choice
          // moves the numbers: over the pilot's 16 inline findings,
          // `original_commit_id` first gives 3 in-window / 11 after / 2
          // unplaceable, and `commit_id` first gives 1 / 14 / 1.
          at_commit: str(rc?.original_commit_id) || str(rc?.commit_id) || null,
          current_commit: str(rc?.commit_id) || null,
        },
      }),
    );
  }

  for (const rv of Array.isArray(reviews) ? reviews : []) {
    if (!CODERABBIT_LOGINS.has(str(rv?.user?.login))) continue;
    if (str(rv?.body).trim() === "") continue;
    const parsed = reviewBodyFindings(rv);
    declared.review_body += parsed.declared;
    declared.shortfall += parsed.shortfall;
    for (const u of parsed.unrecognised) declared.unrecognised.push({ review_id: String(rv?.id ?? ""), ...u });
    for (const f of parsed.findings) {
      records.push(
        build(f, {
          source: "review-body",
          // One commit for the whole review — the review body has no per-finding
          // commit, which is why a review-body finding can only ever be placed as
          // precisely as its review.
          atCommit: str(rv?.commit_id),
          ids: {
            comment_id: null,
            review_id: String(rv?.id ?? "") || null,
            posted_at: str(rv?.submitted_at) || null,
            url: str(rv?.html_url) || null,
            at_commit: str(rv?.commit_id) || null,
            current_commit: str(rv?.commit_id) || null,
          },
        }),
      );
    }
  }

  // Validated here rather than trusted, for the reason `panel.mjs` gives:
  // `buildFindingRecord` and the validator are two expressions of one schema, and
  // the point of running both is that a future edit to one has to survive the other.
  for (const r of records) validateFindingRecord(r);
  return {
    population: "reported",
    // `present` only when BOTH endpoints answered. Half of CodeRabbit's output
    // reported as all of it is precisely the defect this series keeps finding.
    population_state: sources.inline === "present" && sources.review_body === "present" ? "present" : "absent",
    sources,
    declared,
    records,
    dropped,
  };
}

// --- latency: when the review landed, and what the clock is measured FROM -----

/**
 * The TWO intervals, named in the field rather than in a comment.
 *
 * Neither is "CodeRabbit's latency", and that is the whole reason there are two.
 * A duration is a pair of instants, both arms have several instants available, and
 * this project has now recorded the same metric as *3–5× too high against us* and
 * as *not computable* within one day — both times by reasoning about which instants
 * exist rather than by fetching them. So each interval carries the name of what it
 * is measured from, everywhere it travels, and a consumer that wants "the latency"
 * has to pick one and say so.
 *
 *   SELF_TIMED   CodeRabbit's OWN clock: the marker comment it posts when it takes
 *                the job → its first finding on the frozen snapshot. Measured
 *                2026-08-12 over the pilot: 2.6–14.4 min, median 6.8, n=7/7. This
 *                is the one to prefer, for two measured reasons — it needs no guess
 *                about what triggered the review, and it is the only one of the two
 *                that survives an on-demand re-review (see `TRIGGERS`).
 *   PUSH_PROXY   the earliest check run on the frozen commit → the same finding.
 *                A PROXY for the push, and it UNDERSTATES the true push→comment
 *                interval, because CI queueing sits between the push and a run
 *                starting. Kept because it is independently derived: it comes off
 *                our CI's clock rather than CodeRabbit's, so agreement between the
 *                two is evidence and disagreement is a question. On the pilot's five
 *                automatic reviews the two agree to within 0.1–0.4 min.
 */
export const SELF_TIMED_INTERVAL = "coderabbit-start-marker-to-first-finding";
export const PUSH_PROXY_INTERVAL = "earliest-check-run-start-to-first-finding";

/**
 * WHAT CAUSED the review — and it is not always a push, which is the finding that
 * makes this whole module more than a subtraction.
 *
 * `pr-549` reads 183.7 min from the earliest check run on its frozen commit to
 * CodeRabbit's review — 26× the median of the other six. Pooled, it drags the mean
 * from 7.0 to 32.6 and reads as a three-hour review. It is not one. The pull
 * request's timeline says a maintainer wrote `@coderabbitai review this.` at
 * 03:58:27, CodeRabbit acknowledged it at 03:58:37 and posted at 04:06:25:
 * **8.0 min from the ask, 7.8 min from CodeRabbit's own acknowledgement.** The
 * other 176 minutes are a human deciding to ask. `pr-605` is the same shape (two
 * asks, review 7.6 min after the second acknowledgement) and looks innocent only
 * because the ask happened to land 74 s after the push.
 *
 * So a push-anchored figure is not merely noisy on those items, it is measuring a
 * different thing — and both items would have passed any outlier rule that kept
 * pr-605. The trigger is therefore READ, from CodeRabbit's own marker, and the
 * push-anchored figure is marked `poolable: false` wherever the push is not what
 * the review answered.
 *
 *   automatic   CodeRabbit reviewed on its own, off the pull request's own events.
 *   on-demand   a `@coderabbitai review` command was acknowledged. 2 of 7 pilot
 *               items, and the only reason the pilot has an "outlier" at all.
 *   unknown     no marker was readable, so nothing may be pooled on either basis.
 */
export const TRIGGERS = Object.freeze(["automatic", "on-demand", "unknown"]);

/**
 * The two markers CodeRabbit stamps into its own comment bodies, verbatim, and
 * what each one implies about the trigger.
 *
 * Both are HTML comments CodeRabbit writes for its own bookkeeping, so they are
 * exact substrings rather than prose patterns — the vintage churn that gave
 * `harvest.mjs` four header formats does not touch them, and a prose match would
 * break the first time the visible wording is localised.
 *
 *   review-command-invocation  one comment PER INVOCATION, created when CodeRabbit
 *                              accepts an explicit review command. 434 bytes on the
 *                              pilot's two, carrying a uuid. Because it is per
 *                              invocation it is the correct start marker for the
 *                              SECOND review of a pull request, which the next entry
 *                              is not.
 *   status-comment             the per-PR summary comment, created once when
 *                              CodeRabbit first reviews and EDITED in place
 *                              afterwards. ⚠ Its `created_at` is the start of the
 *                              FIRST review on the pull request, so on a second
 *                              automatic review it would overstate the interval —
 *                              which is why the LATEST marker before the finding
 *                              wins, and why a disagreement with `PUSH_PROXY` is
 *                              worth printing rather than resolving here.
 *
 * ⚠ `updated_at` is deliberately NOT used, and this is where an earlier plan for
 * this metric pointed: the pair (`created_at`, `updated_at`) on the status comment
 * looks like a self-timed duration and is not one, because the last edit is the last
 * edit of anything. Measured on pr-415: created 12:14:20, review posted 12:20:55,
 * `updated_at` 13:08:00 — the pair reads 53.7 min against a true 6.6, an 8× error.
 * On the per-invocation ack it happens to be right (549: created 03:58:37, updated
 * 04:06:29, review 04:06:25 — 4 s out), and a rule that is right on one comment
 * kind and 8× wrong on the other is not a rule.
 */
export const START_MARKERS = Object.freeze({
  "review-command-invocation": "<!-- CodeRabbit review command invocation:",
  "status-comment": "<!-- This is an auto-generated comment: summarize by coderabbit.ai -->",
});

/** Marker → what it says about the trigger. Frozen beside the markers so the two
 *  cannot be stated independently and disagree, as `WINDOW_BASIS` is to `WINDOW`. */
export const MARKER_TRIGGER = Object.freeze({
  "review-command-invocation": "on-demand",
  "status-comment": "automatic",
});

/**
 * WHY a latency figure is missing — twelve answers, none of them zero.
 *
 * Lesson 6, applied to a duration, where it bites harder than anywhere else in this
 * subsystem: a missing latency read as 0 makes the other arm look instantaneous, and
 * `null` pooled into a mean makes it look like whatever the rest of the sample says.
 * Three of these in particular are the same words in English and different facts:
 * *"CodeRabbit reviewed this snapshot cleanly"* (`no-finding`), *"we could not read
 * what CodeRabbit wrote"* (`findings-unavailable`) and *"CodeRabbit reviewed a later
 * snapshot"* (`no-in-window-finding`).
 *
 * The first six end the interval and therefore kill BOTH figures. The rest are
 * per-interval: a missing start marker costs the self-timed figure and leaves the
 * proxy, and a commit our CI never ran costs the proxy and leaves the self-timed
 * one. That is the point of carrying two.
 *
 *   findings-unavailable    an endpoint did not answer. OUR failure, and the fix is
 *                           to re-run — never a data point.
 *   no-finding              both endpoints answered and CodeRabbit wrote nothing on
 *                           this pull request. A true negative: a clean review is
 *                           not a zero-length one.
 *   no-review-commit        no frozen window was supplied, so "the review of this
 *                           snapshot" has no referent. The `--pr` path.
 *   finding-unplaceable     findings exist but none could be placed against the
 *                           frozen commit — the force-push case, or an unreadable
 *                           commit list. Which one is in `window_basis`.
 *   no-in-window-finding    findings exist and every one is after the frozen commit.
 *                           CodeRabbit reviewed later code; there is no review OF
 *                           THIS SNAPSHOT to time.
 *   posted-at-absent        an in-window finding carries no usable timestamp.
 *   issue-comments-unavailable  the endpoint carrying CodeRabbit's own markers did
 *                           not answer.
 *   no-start-marker         it answered and carried no marker before the finding.
 *   check-runs-unavailable  the check-runs endpoint did not answer.
 *   no-check-run            it answered with none: OUR CI never ran on that commit,
 *                           which is a fact about our repository and not about
 *                           CodeRabbit. All seven pilot items have runs; a future
 *                           corpus item may not, and it must not read as fast.
 *   check-run-start-absent  runs exist and none states a `started_at`.
 *   start-after-finding     the start instant is AFTER the finding. Reachable on the
 *                           proxy without anything being broken — CodeRabbit can
 *                           post before a queued CI run starts — and a negative
 *                           duration must never be emitted as a duration.
 */
export const LATENCY_ABSENT = Object.freeze([
  "findings-unavailable",
  "no-finding",
  "no-review-commit",
  "finding-unplaceable",
  "no-in-window-finding",
  "posted-at-absent",
  "issue-comments-unavailable",
  "no-start-marker",
  "check-runs-unavailable",
  "no-check-run",
  "check-run-start-absent",
  "start-after-finding",
]);

/** Epoch ms for an API timestamp, or `null`. `Date.parse` returns NaN for junk and
 *  NaN propagates silently through arithmetic into a plausible-looking figure. */
const at = (v) => {
  const ms = Date.parse(str(v));
  return Number.isFinite(ms) ? ms : null;
};

/**
 * WHEN CodeRabbit's review of the frozen snapshot landed, off the arm's own records.
 *
 * The end of the interval is read from `codeRabbitRecords`' output rather than from
 * the API a second time, and that is not just reuse — it is what makes the interval
 * end at a finding this comparison actually counts. Three properties come with it
 * for free: the author gate has already run, so no other bot's comment can end the
 * clock; the window rule has already run, so a finding about later code cannot; and
 * `posted_at` already spans BOTH halves of CodeRabbit's output (`created_at` on an
 * inline comment, `submitted_at` on a review body), so an item where CodeRabbit
 * wrote only a review body still has an end.
 *
 * WHICH `t1`, SETTLED BY MEASUREMENT. The two candidates — the first inline
 * comment's `created_at` and the review's `submitted_at` — differ by **1–2 seconds
 * on 7 of 7** pilot items, because GitHub submits the review immediately after the
 * comments it carries. The choice moves no figure by more than 0.02 min, so it is
 * made on meaning rather than on effect: the EARLIEST of the two is the first moment
 * any of CodeRabbit's output was visible to a human, and `ended_source` says which
 * half it came from so the alternative stays recoverable from the record.
 */
export function endOfReview(item) {
  const records = Array.isArray(item?.records) ? item.records : [];
  const absent = (a) => ({ ended_at: null, ended_source: null, absent: a });
  if (records.length === 0) {
    // The population state, not the record count: "no records" is the same array
    // whether CodeRabbit was silent or the endpoint was unreadable.
    return absent(item?.population_state === "present" ? "no-finding" : "findings-unavailable");
  }
  // ⚠ WITH ONE ENDPOINT ABSENT THIS END IS AN UPPER BOUND, not a measurement of a
  // different thing: the earliest finding we can see may not be the earliest one
  // CodeRabbit posted, so the interval reads LONG. Not a thirteenth absence, because
  // the effect is the 1–2 s by which an inline comment precedes its own review and
  // because the item already reports `population_state` and `sources` beside this —
  // making the item absent over that would throw away a usable figure to describe a
  // two-second bias. Read the two together, as the CLI prints them.
  const inWindow = records.filter((r) => r.coderabbit?.window === "in-window");
  if (inWindow.length === 0) {
    const windows = new Set(records.map((r) => r.coderabbit?.window));
    // Ordered by how much the caller can do about it: no window asked for, then a
    // window we could not place against, then a placement that is simply later.
    if (windows.has("no-window")) return absent("no-review-commit");
    if (windows.has("unplaceable")) return absent("finding-unplaceable");
    return absent("no-in-window-finding");
  }
  const timed = inWindow
    .map((r) => ({ ms: at(r.coderabbit?.posted_at), r }))
    .filter((x) => x.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (timed.length === 0) return absent("posted-at-absent");
  return { ended_at: str(timed[0].r.coderabbit.posted_at), ended_source: str(timed[0].r.coderabbit.source), absent: null };
}

/**
 * CodeRabbit's own start marker for the review that ended at `before`.
 *
 * The LATEST qualifying marker before the finding, which is the whole rule: the
 * status comment is created once per pull request and a command ack once per
 * invocation, so on a re-reviewed pull request the correct start is the most recent
 * marker rather than the first. On pr-549 that is the difference between 7.8 min and
 * 1048.6 min.
 *
 * THE AUTHOR GATE IS NOT OPTIONAL HERE. `CODERABBIT_LOGINS` is `harvest.mjs`'s own
 * set (#739) and the markers are public strings — anyone may paste
 * `<!-- CodeRabbit review command invocation: -->` into a comment on a public pull
 * request, and an ungated read would let them move the start of the other arm's
 * clock to any instant they like. Same reasoning as the exact-login check in the
 * record loop: this is a gate, not tidiness.
 */
export function startMarkerOf(issueComments, { before = null } = {}) {
  const absent = (a) => ({ started_at: null, marker: null, trigger: "unknown", absent: a });
  if (!Array.isArray(issueComments)) return absent("issue-comments-unavailable");
  if (before === null) return absent("no-start-marker");
  let best = null;
  for (const c of issueComments) {
    if (!CODERABBIT_LOGINS.has(str(c?.user?.login))) continue;
    const marker = Object.keys(START_MARKERS).find((k) => str(c?.body).includes(START_MARKERS[k]));
    if (!marker) continue;
    const ms = at(c?.created_at);
    // STRICTLY before: a marker stamped in the same second as the finding is not a
    // start, and `<=` would let a zero-length interval through as a measurement.
    if (ms === null || ms >= before) continue;
    if (best === null || ms > best.ms) best = { ms, marker, created_at: str(c.created_at) };
  }
  if (best === null) return absent("no-start-marker");
  return { started_at: best.created_at, marker: best.marker, trigger: MARKER_TRIGGER[best.marker], absent: null };
}

/**
 * The push-time proxy: the earliest check run on the frozen commit.
 *
 * `min(started_at)`, over OUR CI's runs, because CodeRabbit posts no check run at
 * all — verified on `51c01826a`, where the only apps posting any are `codecov` and
 * `github-actions` and the commit-status API is empty. So the obvious symmetric
 * measurement, each reviewer's own process time off its own check run, does not
 * exist on this arm and this is the nearest available anchor.
 *
 * ⚠ IT UNDERSTATES THE INTERVAL IT NAMES. CI queueing sits between the push and the
 * first run starting, so the true push→finding interval is LONGER than every figure
 * derived from this. Stated on the record rather than in a footnote, because the
 * direction of a bias is the part a chart drops first.
 */
export function pushProxyStartOf(checkRuns) {
  const absent = (a) => ({ started_at: null, check_runs: 0, absent: a });
  if (!Array.isArray(checkRuns)) return absent("check-runs-unavailable");
  if (checkRuns.length === 0) return { started_at: null, check_runs: 0, absent: "no-check-run" };
  let best = null;
  for (const r of checkRuns) {
    const ms = at(r?.started_at);
    if (ms === null) continue;
    if (best === null || ms < best.ms) best = { ms, started_at: str(r.started_at) };
  }
  if (best === null) return { started_at: null, check_runs: checkRuns.length, absent: "check-run-start-absent" };
  return { started_at: best.started_at, check_runs: checkRuns.length, absent: null };
}

/**
 * How long CodeRabbit's review of the frozen snapshot took, on both bases.
 *
 * Pure. It takes what `codeRabbitRecords` already produced plus the two timing
 * reads, so the whole rule is testable from fixtures and the only network in this
 * file is still `fetchCodeRabbitPr`.
 *
 * NO RATIO, AND NO PANEL NUMBER, ANYWHERE HERE OR DOWNSTREAM OF IT. Our arm's
 * `duration_ms` is the panel PROCESS's elapsed time on an offline replay of a
 * historical commit; it starts after the lane fetched refs and materialised a
 * worktree, and it queued for nothing. Neither figure below is that. Publishing the
 * pair on one axis would credit us for every queue the other arm paid and we skipped
 * — measured, and in the direction that flatters us: our replay process median is
 * 9.3 min (n=21) against this arm's 6.8, while the two pilot commits where our panel
 * ran IN PRODUCTION on the same commit took 18.7 and 19.0 min from the same anchor
 * this file proxies. So the arms are reported under separate keys, in separate
 * blocks, each naming its own interval, and nothing here divides one by the other.
 */
export function latencyOf(item, { issueComments = null, checkRuns = null } = {}) {
  const end = endOfReview(item);
  const t1 = at(end.ended_at);
  const marker = startMarkerOf(issueComments, { before: t1 });
  const push = pushProxyStartOf(checkRuns);
  // The end's absence wins over the start's, on both intervals: without an end there
  // is no interval to be missing a start of, and reporting `no-start-marker` for a
  // pull request CodeRabbit never reviewed would file our own scoping decision as a
  // gap in CodeRabbit's output.
  const span = (interval, start, extra) => {
    if (end.absent !== null) return { interval, ms: null, started_at: null, ...extra, absent: end.absent, poolable: false };
    if (start.absent !== null) return { interval, ms: null, started_at: null, ...extra, absent: start.absent, poolable: false };
    // NON-NULL BY CONSTRUCTION, so there is no null branch below. Both producers set
    // `started_at` from the very string whose `at()` they already found finite, and
    // both return `absent: null` only in that case — which the line above has just
    // checked. A guard here could not be made to fire, and this file's own rule for
    // that is `checkArmFields`: a guard nothing can prove fires is decoration.
    const t0 = at(start.started_at);
    if (t0 > t1) return { interval, ms: null, started_at: start.started_at, ...extra, absent: "start-after-finding", poolable: false };
    return { interval, ms: t1 - t0, started_at: start.started_at, ...extra, absent: null, poolable: true };
  };
  const self_timed = span(SELF_TIMED_INTERVAL, marker, { marker: marker.marker });
  const push_proxy = span(PUSH_PROXY_INTERVAL, push, { check_runs: push.check_runs });
  return {
    ...end,
    trigger: marker.trigger,
    self_timed,
    // POOLABLE ONLY WHEN THE PUSH IS WHAT THE REVIEW ANSWERED. An on-demand review
    // did not answer the push this anchor comes from, and an unreadable trigger
    // cannot say that it did — so both are emitted with their number and excluded
    // from any central figure. The number is kept rather than dropped because
    // dropping it silently is how pr-549's 183.7 min became a three-hour review in
    // one document and a deleted row in the next.
    push_proxy: { ...push_proxy, poolable: push_proxy.poolable && marker.trigger === "automatic" },
  };
}

/**
 * The census, with every declared absence printed at n=0 — the zeros are the point.
 *
 * `no-check-run` has never occurred: all seven pilot items carry `verify-self`,
 * `verify-integration` and `verify-browser` on their frozen commit. That is exactly
 * the state in which a mishandled absence goes unnoticed, so the row is printed at
 * zero rather than omitted, on both intervals, every run.
 *
 * NO CENTRAL FIGURE IS COMPUTED HERE. Counts and the poolable population only: a
 * median belongs to a scorer, which owns one definition of it for every metric in
 * this subsystem, and an adapter that grew a second one is how two tables of the
 * same run come to disagree.
 */
export function latencyCensus(perItem) {
  const zeros = () => Object.fromEntries(LATENCY_ABSENT.map((f) => [f, 0]));
  const out = {
    n: 0,
    ended: 0,
    triggers: Object.fromEntries(TRIGGERS.map((t) => [t, 0])),
    self_timed: { measured: 0, poolable: 0, absent: zeros() },
    push_proxy: { measured: 0, poolable: 0, absent: zeros() },
  };
  for (const it of Array.isArray(perItem) ? perItem : []) {
    const l = it?.latency;
    if (!l) continue;
    out.n += 1;
    if (l.ended_at !== null) out.ended += 1;
    if (Object.hasOwn(out.triggers, l.trigger)) out.triggers[l.trigger] += 1;
    for (const key of ["self_timed", "push_proxy"]) {
      const s = l[key];
      if (s?.ms !== null && s?.ms !== undefined) out[key].measured += 1;
      if (s?.poolable) out[key].poolable += 1;
      // An unrecognised flavour gets its own key rather than being counted as one of
      // the twelve, for the reason `DURATION_SOURCES` does the same: a new absence
      // must appear as an unexplained bucket, not disappear into a known one.
      if (s?.absent) out[key].absent[s.absent] = (out[key].absent[s.absent] ?? 0) + 1;
    }
  }
  return out;
}

// --- the one side effect ----------------------------------------------------

/**
 * CodeRabbit's two endpoints, the pull request's commit list, and — when a frozen
 * commit is supplied — the two timing reads. The ONLY function here that touches
 * the network; everything above is pure so the tests need neither.
 *
 * Each call is caught separately and degrades to `null` — not `[]` — because "the
 * endpoint did not answer" and "CodeRabbit wrote nothing" are different facts and
 * `null` is what `codeRabbitRecords` reads as `absent`.
 *
 * ONE FAILURE IS NOT PER-CALL AND MUST NOT DEGRADE: see `assertRepoResolved`.
 */
export function fetchCodeRabbitPr(pr, { reviewCommit = null, api = gh, log = console.error } = {}) {
  const n = String(pr ?? "").trim();
  const getPath = (what, endpoint) => {
    try {
      const out = api(["api", "--paginate", `repos/{owner}/{repo}/${endpoint}?per_page=100`]);
      return Array.isArray(out) ? out : null;
    } catch (err) {
      assertRepoResolved(err);
      log(`#${n}: could not list ${what} (${err.message}); that half of CodeRabbit's output is absent, not empty.`);
      return null;
    }
  };
  const get = (what, endpoint) => getPath(what, `pulls/${n}/${endpoint}`);
  return {
    pr: n,
    commits: get("commits", "commits"),
    comments: get("review comments", "comments"),
    reviews: get("reviews", "reviews"),
    // CodeRabbit's start markers live on the ISSUE comments endpoint, which is a
    // bare array — plain `--paginate` is correct here, and `harvest.mjs` says so at
    // its own reader. The check-runs endpoint below is the one that is not.
    issueComments: getPath("issue comments", `issues/${n}/comments`),
    // Only with a frozen commit: the proxy anchors to the commit our panel was
    // shown, and `commitCheckRuns` is `gh-checks.mjs`'s own reader rather than a
    // fourth copy of the `--slurp` incantation that endpoint needs — it returns an
    // OBJECT per page, so plain `--paginate` concatenates raw objects into text that
    // is not valid JSON. `null` when nobody asked, which reads as
    // `check-runs-unavailable` rather than as a commit with no runs.
    checkRuns: str(reviewCommit).trim() === "" ? null : checkRunsFor(str(reviewCommit).trim(), { api, log }),
  };
}

/** Check runs for the frozen commit, degrading to `null` on a failed read. */
function checkRunsFor(sha, { api, log }) {
  try {
    return commitCheckRuns(sha, { api });
  } catch (err) {
    assertRepoResolved(err);
    log(`${sha}: could not read check runs (${err.message}); the push-time proxy is absent, not zero.`);
    return null;
  }
}

/**
 * REFUSE when `gh` could not expand `{owner}/{repo}` — lesson 1, on the one failure
 * in this file that is total rather than per-endpoint.
 *
 * `gh api repos/{owner}/{repo}/…` expands those placeholders from the CURRENT
 * DIRECTORY's git remote, so run from anywhere else with no `GH_REPO` set and every
 * call fails identically. Degrading each one to `absent` then produces a complete,
 * plausible, entirely empty result: previously measured as 0 CodeRabbit records
 * across a whole corpus version, with nothing in the output distinguishing it from a
 * repository CodeRabbit had never reviewed.
 *
 * The repository fixed the CI half of this in #790, which sets a workflow-level
 * `GH_REPO` and asserts it in `checks.test.mjs`. That assertion cannot see a local
 * invocation, which is where this CLI runs — so the same footgun is closed here, at
 * the point of failure, by the message `gh` itself emits.
 */
export function assertRepoResolved(err) {
  if (/unable to expand placeholder/i.test(str(err?.message))) {
    refuse(
      `gh could not expand {owner}/{repo} (${err.message.trim()}). Every read here would fail the same way and be ` +
        `reported as "CodeRabbit's output is absent", which is indistinguishable from a clean review — so this ` +
        `refuses instead. Set GH_REPO=wafflebase/wafflebase, or run from a checkout that has that remote`,
    );
  }
}

// --- CLI: read a PR or a corpus version, print records. Writes nothing. ------

/**
 * Records for every item of a corpus version, in manifest order.
 *
 * The manifest is what supplies each item's frozen `review_commit`, which is the
 * whole reason a corpus version is a useful unit here rather than a list of pull
 * request numbers: without it every record reads `no-window`.
 */
export function corpusRecords(store, corpusVersion, { itemId = null, api = gh, log = console.error } = {}) {
  const items = store.getCorpus(corpusVersion);
  if (items === null) refuse(`corpus version ${JSON.stringify(corpusVersion)} does not exist under this root`);
  return items
    .filter((it) => !itemId || it.id === itemId)
    .map((it) => {
      const fetched = fetchCodeRabbitPr(it.source_pr, { reviewCommit: it.review_commit, api, log });
      const records = codeRabbitRecords({ pr: it.source_pr, reviewCommit: it.review_commit, commits: fetched.commits, comments: fetched.comments, reviews: fetched.reviews });
      return {
        item_id: it.id,
        ...records,
        // Beside the records rather than inside them: a latency is a property of the
        // ITEM's review, not of any one finding, and putting it on 30 records would
        // be 30 places for one fact to drift.
        latency: latencyOf(records, { issueComments: fetched.issueComments, checkRuns: fetched.checkRuns }),
      };
    });
}

const USAGE =
  "usage: coderabbit.mjs (--pr <n> | --root <eval-data-root> --corpus-version <v> [--item <item-id>]) [--json]\n" +
  "\n" +
  "Derives finding records from CodeRabbit's review comments and review bodies.\n" +
  "Reads only; writes nothing, spawns nothing and costs nothing.\n" +
  "\n" +
  "--pr places every finding as `no-window`: without a frozen review_commit there\n" +
  "is no snapshot to compare against, and no review of one to time either. Pass a\n" +
  "corpus version to get the placement and the latency.\n" +
  "--json prints the records to stdout; the report, including latency, goes to stderr.\n" +
  "\n" +
  "GH_REPO must name the repository unless the working directory has it as a remote:\n" +
  "gh expands {owner}/{repo} from git, and this refuses rather than reporting a\n" +
  "corpus-wide absence that reads like a repository CodeRabbit never reviewed.";

/**
 * One item's latency line. Exported so the wording is testable without a network,
 * and because the caveats below are the deliverable rather than decoration: a figure
 * whose interval is named three lines away from it gets quoted without the name.
 */
export function latencyLine(l) {
  const m = (s) => (s.ms === null ? `n/a (${s.absent})` : `${(s.ms / 60000).toFixed(1)}m${s.poolable ? "" : " NOT POOLABLE"}`);
  return (
    `latency: self-timed ${m(l.self_timed)}${l.self_timed.marker ? ` [${l.self_timed.marker}]` : ""}` +
    ` · push-proxy ${m(l.push_proxy)} (${l.push_proxy.check_runs} check run(s), UNDERSTATES: CI queue excluded)` +
    ` · trigger ${l.trigger}` +
    (l.ended_at === null ? "" : ` · ended ${l.ended_at} [${l.ended_source}]`) +
    (l.trigger === "on-demand" ? " · ⚠ ON-DEMAND: the push proxy measures a human's delay in asking, not a review" : "")
  );
}

/**
 * One interval's absence census as a line: every DECLARED flavour at its count, then
 * anything else the census saw, marked.
 *
 * Exported for the same reason `latencyLine` is, and it has already earned it: the
 * first version iterated `LATENCY_ABSENT` alone, which silently undid the one thing
 * `latencyCensus` goes out of its way to do. Giving an unrecognised flavour its own
 * key is worthless if the only thing that prints the census cannot show that key —
 * the bucket would exist, be counted, and never be seen, which is lesson 1 with an
 * extra step. `cost-latency.mjs` marks its unrecognised `duration_source` values the
 * same way, and the wording matches so the two reports read alike.
 *
 * Declared order first and always, so the stable rows stay comparable between runs.
 */
export function latencyAbsentLine(absent) {
  const o = absent ?? {};
  const declared = LATENCY_ABSENT.map((f) => `${f}=${o[f] ?? 0}`);
  const extra = Object.keys(o).filter((f) => !LATENCY_ABSENT.includes(f)).map((f) => `UNRECOGNISED ${f}=${o[f]}`);
  return [...declared, ...extra].join(" ");
}

/** `key=n` over a record list, for the CLI's census lines. */
function tallyOf(records, pick) {
  const o = {};
  for (const r of records) {
    const k = pick(r) ?? "(none)";
    o[k] = (o[k] ?? 0) + 1;
  }
  return Object.entries(o).map(([k, n]) => `${k}=${n}`).join(" ") || "(none)";
}

/** One item's line of the report, plus its census. Every proportion here carries
 *  its `n`, and the zero rows are printed rather than omitted: "no findings
 *  because the review was clean" and "no findings because an endpoint did not
 *  answer" are different facts and only one of them is a data point. */
function reportItem(item) {
  const c = gatingCensus(item.records);
  console.error(
    `${item.item_id}: ${c.n} record(s)` +
      ` · inline ${item.sources.inline}, review-body ${item.sources.review_body}, commits ${item.sources.commits}` +
      // The BASIS, not the value: `unplaceable` has four causes and one of them is
      // "the commit list did not load", which is our failure rather than a fact
      // about the finding.
      ` · window ${tallyOf(item.records, (r) => r.coderabbit?.window_basis)}` +
      ` · severity ${tallyOf(item.records, (r) => r.coderabbit?.severity_basis)}` +
      (item.dropped.length ? ` · ${item.dropped.length} not a finding` : ""),
  );
  if (item.latency) console.error(`  ${latencyLine(item.latency)}`);
  if (item.sources.commits === "absent" && c.n > 0) {
    console.error(
      `  ! ${item.item_id}: the commit list is absent, so all ${c.n} finding(s) are unplaceable because WE could not read it, ` +
        `not because CodeRabbit wrote them outside the frozen window. Re-run before quoting any window split.`,
    );
  }
  // A review whose own section titles declare more than this parser read, named
  // per item rather than folded into a total.
  if (item.declared.shortfall !== 0) {
    console.error(`  ! ${item.item_id}: review bodies declare ${item.declared.review_body} finding(s); ${item.declared.shortfall} were not read`);
  }
  for (const u of item.declared.unrecognised) {
    console.error(`  ! ${item.item_id}: review ${u.review_id} has section ${JSON.stringify(u.title)} (declares ${u.declared}) matching no known tier`);
  }
  return c.n;
}

async function main() {
  const args = parseArgs(process.argv, { booleans: ["json", "help"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const byPr = Boolean(args.pr);
  // `--root` is REQUIRED for the corpus path and has no default anywhere in this
  // directory: git history is permanent, so one flag that fell back to a path
  // inside this repository would commit benchmark data into `wafflebase` for good.
  if (byPr === Boolean(args.root && args["corpus-version"])) {
    console.error(USAGE);
    process.exit(2);
  }
  let perItem;
  if (byPr) {
    const fetched = fetchCodeRabbitPr(args.pr);
    const records = codeRabbitRecords({ pr: args.pr, commits: fetched.commits, comments: fetched.comments, reviews: fetched.reviews });
    // `no-review-commit` on both intervals, and printed rather than skipped: the
    // reason this path cannot time a review is the same reason it cannot place a
    // finding, and seeing the two absences agree is how a reader learns that the
    // frozen commit — not the pull request — is the unit of this comparison.
    perItem = [{ item_id: codeRabbitItemId(args.pr), ...records, latency: latencyOf(records, { issueComments: fetched.issueComments, checkRuns: fetched.checkRuns }) }];
  } else {
    const { EvalStore } = await import("../store.mjs");
    perItem = corpusRecords(new EvalStore(args.root), args["corpus-version"], { itemId: args.item ?? null });
  }
  if (perItem.length === 0) {
    console.error("no items to read");
    process.exit(1);
  }
  const all = [];
  for (const item of perItem) {
    all.push(...item.records);
    reportItem(item);
  }
  const census = gatingCensus(all);
  const tally = (pick) => tallyOf(all, pick);
  console.error(
    `\n${census.n} record(s) across ${perItem.length} item(s), population reported` +
      // Every one of these must be `not-applicable` / `no-gate-in-arm`. CodeRabbit
      // does not gate anything, ever, so the boring answer is the correct one and
      // printing it is how a wrong one becomes visible.
      `\n  gating:   ${Object.entries(census.gating).map(([g, n]) => `${g}=${n}`).join(" ")}` +
      `\n  basis:    ${Object.entries(census.basis).map(([b, n]) => `${b}=${n}`).join(" ") || "(none)"}` +
      `\n  window:   ${tally((r) => r.coderabbit?.window)}` +
      `\n  severity: ${tally((r) => r.severity)}` +
      `\n  stated:   ${tally((r) => r.coderabbit?.severity_basis)}` +
      `\n  source:   ${tally((r) => r.coderabbit?.source)}` +
      `\n  tier:     ${tally((r) => r.coderabbit?.tier || "(inline)")}` +
      `\n  vintage:  ${tally((r) => r.coderabbit?.vintage)}`,
  );
  const lat = latencyCensus(perItem);
  console.error(
    // EVERY declared absence, at zero, on both intervals. `no-check-run=0` is the row
    // that matters: it has never happened, so it is the one whose mishandling nobody
    // would notice.
    `\nlatency over ${lat.n} item(s), ${lat.ended} with a review of the frozen snapshot to time` +
      `\n  trigger:      ${Object.entries(lat.triggers).map(([t, n]) => `${t}=${n}`).join(" ")}` +
      `\n  self-timed:   ${lat.self_timed.measured} measured, ${lat.self_timed.poolable} poolable · ${SELF_TIMED_INTERVAL}` +
      `\n    absent:     ${latencyAbsentLine(lat.self_timed.absent)}` +
      `\n  push-proxy:   ${lat.push_proxy.measured} measured, ${lat.push_proxy.poolable} poolable · ${PUSH_PROXY_INTERVAL}` +
      `\n    absent:     ${latencyAbsentLine(lat.push_proxy.absent)}` +
      // The two sentences a reader needs before quoting any of it, in the same output
      // as the numbers rather than in a document they may not open.
      `\n  ! the push proxy UNDERSTATES: CI queueing sits between the push and the first check run starting` +
      `\n  ! neither figure is comparable with our panel's duration_ms, which times a PROCESS on an offline replay` +
      ` — different intervals, separate keys, and no ratio is computed anywhere`,
  );
  if (args.json) console.log(JSON.stringify(all, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("coderabbit adapter failed:", e.message);
    process.exit(1);
  });
}
