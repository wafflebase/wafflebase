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
// WHAT IS INERT TODAY, STATED PLAINLY. Nothing consumes a finding record yet, on
// either arm, so this module changes no number. What it changes is that the
// numbers CAN be computed, and that the two arms' findings are finally the same
// shape.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN } from "../../vendor/pipeline/severity.mjs";
import { CODERABBIT_LOGINS, classifyCodeRabbitComment, commitIndex, parseCodeRabbitReview } from "../../harvest.mjs";
import { gh, parseArgs } from "../../vendor/pipeline/gh-checks.mjs";
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

// --- the one side effect ----------------------------------------------------

/**
 * CodeRabbit's two endpoints plus the pull request's commit list, for one pull
 * request. The ONLY function here that touches the network; everything above is
 * pure so the tests need neither.
 *
 * Each call is caught separately and degrades to `null` — not `[]` — because "the
 * endpoint did not answer" and "CodeRabbit wrote nothing" are different facts and
 * `null` is what `codeRabbitRecords` reads as `absent`.
 */
export function fetchCodeRabbitPr(pr, { api = gh, log = console.error } = {}) {
  const n = String(pr ?? "").trim();
  const get = (what, endpoint) => {
    try {
      const out = api(["api", "--paginate", `repos/{owner}/{repo}/pulls/${n}/${endpoint}?per_page=100`]);
      return Array.isArray(out) ? out : null;
    } catch (err) {
      log(`#${n}: could not list ${what} (${err.message}); that half of CodeRabbit's output is absent, not empty.`);
      return null;
    }
  };
  return {
    pr: n,
    commits: get("commits", "commits"),
    comments: get("review comments", "comments"),
    reviews: get("reviews", "reviews"),
  };
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
      const fetched = fetchCodeRabbitPr(it.source_pr, { api, log });
      return {
        item_id: it.id,
        ...codeRabbitRecords({ pr: it.source_pr, reviewCommit: it.review_commit, commits: fetched.commits, comments: fetched.comments, reviews: fetched.reviews }),
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
  "is no snapshot to compare against. Pass a corpus version to get the placement.\n" +
  "--json prints the records to stdout.";

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
    perItem = [{ item_id: codeRabbitItemId(args.pr), ...codeRabbitRecords({ pr: args.pr, commits: fetched.commits, comments: fetched.comments, reviews: fetched.reviews }) }];
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
  if (args.json) console.log(JSON.stringify(all, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("coderabbit adapter failed:", e.message);
    process.exit(1);
  });
}
