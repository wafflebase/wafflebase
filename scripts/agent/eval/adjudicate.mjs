// THE ADJUDICATION CLI — present a finding for judgement, blind to what the
// reviewer decided about it, and make ~275 readings survivable.
//
// Adjudication, not money, is the scarce resource here. The pilot's three replicates
// cost $95.42 and are bought; what is not bought is the answer to "is any of this
// true", and every validity metric — precision, relative recall, the false-positive
// profile, verifier validity — is computed against human labels and nothing else.
// So the cost that matters is a person's attention, and this file exists to spend it
// well: a triage queue that puts the most-covering judgement first, a presentation
// that a reader can act on without opening five files, and resumability, because
// nobody does 275 of anything in one sitting.
//
// 🔴 EVERY SHORTCUT THAT MAKES THIS FASTER ALSO MAKES IT MORE CIRCULAR, and the fast
// version is always the one that looks reasonable. Showing the panel's severity
// saves the reader a decision. Pre-filling from cross-arm agreement saves them a
// hundred. Both produce a dataset that grades the panel against itself, and the
// resulting precision figure would be higher, publishable, and wrong — with nothing
// downstream able to detect it. This project's recurring failure is silent
// degradation: code that works, prints evidence of not working, and nobody reads the
// evidence. HERE THE DEGRADATION WOULD NOT EVEN PRINT EVIDENCE.
//
// So the guard is structural rather than a convention. `admitRecord` projects each
// finding record onto an ALLOWLIST of nine fields, once, at the boundary; the panel's
// severity, its verifier outcome, its lane and its gating verdict are not withheld
// downstream — THEY ARE NOT IN THE PIPELINE. Nothing after that line can show what
// nothing after that line has. `labels.mjs` then refuses, at write time, any label
// whose own `presented_fields` admits one of them was on screen. Two independent
// doors, because lesson 7 of this project is that a validator only guards the door it
// stands in.
//
// ⚠ THIS FILE DELIBERATELY NARROWS, which is the opposite of the convention the
// adapters follow ("WIDENS, NEVER NARROWS — copy the whole finding and add fields").
// That convention exists so that no annotation a later round adds is lost on the way
// to a SCORER. This projection is on the way to a HUMAN, where carrying a field "just
// in case" is exactly the circularity above. Nothing is lost: the whole record stays
// in the store and the label joins back onto it by `finding_key`.
//
// WHAT IT DOES NOT DO. It computes no precision, no recall and no agreement — those
// are a scorer's job, and one that must not be written until labels exist. It writes
// no judgement of its own: every label it stores names the annotator who made the
// call, and there is no code path that invents one.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "../gh-checks.mjs";
import { KNOWN } from "../severity.mjs";
import { ARMS, validateFindingRecord } from "./finding-record.mjs";
import { groupFindings } from "../finding-match.mjs";
import {
  BLINDED_FROM_ADJUDICATION,
  CONFIDENCE,
  LABELS_DIR,
  STRATA,
  VERDICT_LABELS,
  armKeyOf,
  buildFindingLabel,
  buildItemLabel,
  labelCensus,
  labelPathFor,
  validateLabel,
} from "./labels.mjs";
import { contentSha256 } from "./store.mjs";

const refuse = (msg) => {
  throw new Error(`adjudicate: ${msg}`);
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/**
 * THE ALLOWLIST. Nine fields, and the reason each is on it:
 *
 *   finding_key            the label's key. Never shown; carried so a judgement can
 *                          be written against the right identity.
 *   item_id                which pull request's diff to read.
 *   arm, run_id, lens      the matcher's own gate operands — `groupFindings` selects
 *                          a same-run vs cross-source rule from arm and run, and the
 *                          same-run half reads the lens (#780). Needed to BUNDLE;
 *                          `arm` and `run_id` are withheld from what is printed.
 *   file, line             where to look.
 *   summary                the claim — WHAT IS BEING JUDGED. A claim you cannot read
 *                          is not a claim you can adjudicate, which is why blinding is
 *                          about the reviewer's verdict and never about the finding.
 *   evidence               the reviewer's own prose: the panel's evidence, or
 *                          CodeRabbit's comment body. Judged against the code, not
 *                          believed.
 *
 * WHAT IS ABSENT IS THE POINT: `severity`, `severity_raw`, `gating`, `gating_basis`,
 * `panel.lane`, `panel.verification`, `panel.unsettled`, `coderabbit.stated_severity`
 * — and every field a future PR adds, because an allowlist drops what it has not
 * heard of. A denylist would have to be updated by whoever adds the next field, and
 * they will not know to.
 */
export const CARD_FIELDS = Object.freeze(["finding_key", "item_id", "arm", "run_id", "lens", "file", "line", "summary", "evidence"]);

/**
 * The four card fields `findingSimilarity` reads BY NAME, kept as a named list because
 * renaming one of them silently disables all bundling.
 *
 * That is not hypothetical — this file did it. The first draft carried the claim as
 * `claim` and the prose as `detail`, which read better on screen; `groupFindings` then
 * found no tokens on either side of any pair, its "never merge on no evidence" rule
 * (G0) rejected every one, and the queue came out at 428 classes for 428 records
 * instead of 245. Nothing threw, and 428 is a perfectly plausible number. The
 * presentation names are applied in `presentBundle` instead, where they cost nothing.
 */
export const MATCHER_OPERAND_FIELDS = Object.freeze(["file", "line", "summary", "evidence"]);

/**
 * What the adjudicator is shown, recorded into every label as
 * `adjudication.presented_fields` — the pair-label session's `adjudication_basis`
 * precedent, promoted to a required field. A verdict is only interpretable if the
 * basis it rested on is on the record.
 */
export const PRESENTED_FIELDS = Object.freeze(["item", "file", "line", "claim", "reviewer-prose", "kind-suggestion", "diff-on-request"]);

/**
 * What is withheld, and it is the four things in `BLINDED_FROM_ADJUDICATION` plus two
 * more this CLI chooses to hold back:
 *
 *   arm      which reviewer raised the claim. Not required by the guide; withheld
 *            because a reader who knows whose finding it is can be systematically
 *            kinder to one arm, and the judgement does not need it. ⚠ PARTIAL, and
 *            not claimed as more: CodeRabbit's prose and ours read differently, so an
 *            experienced reader will often infer the arm from the claim itself.
 *   run_id   which replicate. A defect judged once serves all three; showing which
 *            run the wording came from invites "the panel said this twice" — a
 *            reliability prior standing in for a validity judgement.
 */
export const WITHHELD_FIELDS = Object.freeze([...BLINDED_FROM_ADJUDICATION, "arm", "run_id"]);

/**
 * The triage orders. Each is a policy about WHOSE ATTENTION IS SAVED, and none of
 * them can see the panel's verdict, because by this point nothing does.
 *
 *   coverage   most records covered per judgement first. Measured on the pilot: 428
 *              panel records collapse into 245 defect classes — 56 of size 3, 71 of
 *              size 2, 118 singletons — so the first 127 judgements settle 310 of the
 *              428 records. This is the default because it is the only ordering that
 *              changes the total amount of work rather than its sequence.
 *   locality   item, then file, then line. The dominant cost of a judgement is
 *              READING THE DIFF, not typing the answer, so grouping every claim about
 *              one file together is worth more than it looks.
 *   none       no prior at all — the honest baseline. ⟳ It was called `arrival` and
 *              documented as "input order", and BOTH were wrong: `groupFindings` sorts
 *              its own groups by `(item, id)` (`finding-match.mjs:967`), so a bundle
 *              list is already content-ordered before any comparator here runs. A test
 *              asserting that a reversed input reversed the queue is what caught it.
 *              The real property is better than the claimed one: every order this
 *              module offers, including this one, is independent of input order.
 */
export const ORDERS = Object.freeze(["coverage", "locality", "none"]);

/**
 * Orderings this CLI REFUSES, each with the leak it would produce.
 *
 * They are unreachable anyway — the queue holds cards, and a card has no severity to
 * sort by — so this map is not a safety mechanism. It is the reason written down at
 * the place someone would come to add one, because the next person to want
 * "blocking findings first" will have a good argument and no way to see the cost.
 */
export const REFUSED_ORDERS = Object.freeze({
  severity: "sorting by the panel's severity leaks it — position in the queue tells the reader what the panel thought",
  gating: "sorting by whether a finding gated leaks the gate outcome, which is what verdict validity is measured against",
  lane: "same as gating: the lane IS the gate's decision",
  verifier: "sorting by the verifier's outcome leaks the answer to is_real, and makes the verifier's confusion matrix a tautology",
  agreement: "sorting by cross-arm agreement leaks the shared-hallucination prior — the one that looks most like evidence",
});

/**
 * One validated finding record → one card. THE BLINDING BOUNDARY, and the only place
 * a record is read.
 *
 * Throws on anything that is not a finding record: this is the point where a caller's
 * mistake is cheap to report. Whole-batch degradation is `buildQueue`'s job, which
 * counts what it dropped rather than shrinking the queue silently.
 */
export function admitRecord(record) {
  validateFindingRecord(record);
  const armed = isPlainObject(record[record.arm]) ? record[record.arm] : {};
  return {
    finding_key: record.finding_key,
    item_id: record.item_id,
    arm: record.arm,
    run_id: record.run_id ?? null,
    lens: typeof armed.lens === "string" ? armed.lens : null,
    file: record.file ?? null,
    line: record.line ?? null,
    // Verbatim, under the record's own names. See `MATCHER_OPERAND_FIELDS`.
    summary: record.summary ?? null,
    evidence: record.evidence ?? null,
  };
}

/**
 * Cards → bundles, where a bundle is one defect and every wording of it.
 *
 * THIS IS WHERE THE 275 FIGURE COMES FROM, and it is not the figure the plan assumed.
 * The premise was that `findingKey` — `(file, lowercased summary)` — would repeat
 * across replicates, so a defect found in k1 and k3 would carry one key and one
 * label. MEASURED ON THE PILOT'S 428 PANEL RECORDS: 426 distinct keys, of which 2
 * appear in two replicates and NONE in all three. Exact identity essentially never
 * repeats, because the panel rewords the same defect on every try. Labelling per key
 * is therefore 426 + 30 judgements, not 275.
 *
 * The reuse is real but it lives one unit up: `groupFindings` collapses the same 428
 * records into 245 defect classes (118 in one replicate, 71 in two, 56 in all three
 * — the same partition #782 published). So a class is what a person judges, and each
 * of its member keys gets its own label carrying `class_id` and `class_members`, so a
 * later reader can see that N labels came from one reading.
 *
 * BUNDLES NEVER SPAN ARMS, and that is a blinding property rather than a tidiness
 * one: a bundle holding one panel claim and one CodeRabbit claim would tell the reader
 * the other arm agreed — the exact prior `BLINDED_FROM_ADJUDICATION` forbids. So the
 * cards are partitioned by arm BEFORE grouping, and the result is asserted, because
 * "we passed them in separately" is a fact about this code and the assertion is a
 * fact about the output.
 */
export function bundleCards(cards) {
  const byArm = new Map();
  for (const c of cards) {
    if (!byArm.has(c.arm)) byArm.set(c.arm, []);
    byArm.get(c.arm).push(c);
  }
  const bundles = [];
  for (const [arm, armCards] of [...byArm].sort(([a], [b]) => a.localeCompare(b))) {
    // The accessors are injected because a card is flat: `groupFindings`' defaults
    // read `finding.panel?.lens`, and a card has no arm namespace by construction.
    const { groups } = groupFindings(armCards, {
      itemOf: (f) => f.item_id,
      armOf: (f) => f.arm,
      runOf: (f) => f.run_id,
      lensOf: (f) => f.lens,
    });
    for (const g of groups) {
      const members = g.members.map((m) => m.finding);
      const arms = new Set(members.map((m) => m.arm));
      if (arms.size !== 1 || !arms.has(arm)) {
        refuse(`a bundle spans arms ${[...arms].join(", ")} — it would tell the adjudicator the other arm agreed, which is the one prior this queue must never carry`);
      }
      bundles.push({
        class_id: g.id,
        item_id: g.item,
        arm,
        members,
        // The unit of work: how many records one judgement settles.
        covers: members.length,
        keys: [...new Set(members.map((m) => m.finding_key))].sort(),
        // Arm-qualified, because that is what "already labelled" means on disk.
        arm_keys: [...new Set(members.map((m) => armKeyOf(arm, m.finding_key)))].sort(),
      });
    }
  }
  return bundles;
}

const firstLocation = (b) => b.members.find((m) => nonEmptyString(m.file)) ?? b.members[0];

function sortBundles(bundles, order) {
  const loc = (b) => {
    const m = firstLocation(b);
    return { file: m.file ?? "", line: m.line ?? 0 };
  };
  // Every comparator ends on `class_id` so the order is TOTAL. A queue whose ties broke
  // on array order would renumber itself between runs, and the pair-label session
  // already learned what that costs: "row numbers are stable only for one identical
  // invocation, so 'pair 3 = y' rots immediately."
  //
  // ⚠ MEASURED: this tiebreak is currently unreachable, and it stays. `groupFindings`
  // sorts its own groups by `(item, id)` (`finding-match.mjs:967`), so the bundle list
  // arrives id-ordered and a permuted input already produces one answer without it —
  // deleting it changes no output, which a mutation confirmed. It is kept because that
  // makes totality a property of THIS module rather than one inherited from another
  // module's internal sort, and inheriting it is how the queue would start renumbering
  // itself the day that sort is refactored.
  const byId = (a, b) => String(a.class_id).localeCompare(String(b.class_id));
  const rank = {
    coverage: (a, b) => b.covers - a.covers || a.item_id.localeCompare(b.item_id) || loc(a).file.localeCompare(loc(b).file) || loc(a).line - loc(b).line || byId(a, b),
    locality: (a, b) => a.item_id.localeCompare(b.item_id) || loc(a).file.localeCompare(loc(b).file) || loc(a).line - loc(b).line || b.covers - a.covers || byId(a, b),
    none: () => 0,
  };
  return order === "none" ? [...bundles] : [...bundles].sort(rank[order]);
}

/**
 * Records → the queue a session walks, plus the census of what it dropped and what it
 * skipped as already-labelled.
 *
 * A READ PATH, so it degrades to fewer bundles rather than throwing — but never
 * silently: `dropped` names every record it could not admit and why, and the CLI
 * prints the count. A skip that drops data without saying so reads downstream as "we
 * judged everything".
 *
 * RESUMABILITY IS BUILT ON `labelled`, not on a session file. The label on disk IS
 * the record that a judgement happened, so there is no second source of truth to fall
 * out of step with it: a key already labelled is not asked again, and a key not
 * labelled is asked, whatever killed the previous session and whenever.
 */
export function buildQueue({ records = [], labelled = new Set(), arm = null, itemId = null, order = "coverage", limit = null } = {}) {
  if (Object.hasOwn(REFUSED_ORDERS, order)) refuse(`--order ${order} is refused: ${REFUSED_ORDERS[order]}`);
  if (!ORDERS.includes(order)) refuse(`order must be one of ${ORDERS.join(" | ")}, got ${JSON.stringify(order)}`);
  if (arm !== null && !ARMS.includes(arm)) refuse(`arm must be one of ${ARMS.join(" | ")} or null, got ${JSON.stringify(arm)}`);
  const dropped = [];
  const cards = [];
  (Array.isArray(records) ? records : []).forEach((r, index) => {
    if (arm !== null && r?.arm !== arm) return;
    if (itemId !== null && r?.item_id !== itemId) return;
    try {
      cards.push(admitRecord(r));
    } catch (e) {
      dropped.push({ index, item_id: r?.item_id ?? null, reason: e.message });
    }
  });
  const all = sortBundles(bundleCards(cards), order);
  // A bundle is settled only when EVERY member key has a label. A partially-labelled
  // bundle is what an interrupt mid-write looks like, and re-asking it is the safe
  // direction: the write path overwrites a label with an identical one, so the cost
  // of re-asking is one question and the cost of skipping is a member key with no
  // label that nothing ever revisits.
  const settled = all.filter((b) => b.arm_keys.every((k) => labelled.has(k)));
  const pending = all.filter((b) => !b.arm_keys.every((k) => labelled.has(k)));
  const queue = Number.isInteger(limit) && limit > 0 ? pending.slice(0, limit) : pending;
  return {
    queue,
    census: {
      records_in: Array.isArray(records) ? records.length : 0,
      cards: cards.length,
      dropped: dropped.length,
      bundles: all.length,
      settled: settled.length,
      pending: pending.length,
      queued: queue.length,
      // Stated so "245 judgements" and "428 records" are never confused for each
      // other, which is the unit error this project has now made four times.
      records_covered_by_queue: queue.reduce((n, b) => n + b.covers, 0),
      withheld_from_queue: Number.isInteger(limit) && limit > 0 ? Math.max(0, pending.length - queue.length) : 0,
    },
    dropped,
  };
}

/**
 * One bundle → the payload the human sees. The projection whose contents are a TESTED
 * property, not a convention.
 *
 * It is built by naming fields, never by deleting them from a bundle, so a field
 * added to a card tomorrow does not appear here by default. `presented_fields` and
 * `withheld_fields` travel with it into the label, so the basis of a verdict is on
 * the record rather than in this file's history.
 */
export function presentBundle(bundle, { diff = null } = {}) {
  if (!isPlainObject(bundle) || !Array.isArray(bundle.members)) refuse(`presentBundle needs a bundle, got ${JSON.stringify(bundle)}`);
  const locations = [];
  const seen = new Set();
  for (const m of bundle.members) {
    const at = `${m.file ?? ""}:${m.line ?? ""}`;
    if (seen.has(at)) continue;
    seen.add(at);
    locations.push({ file: m.file ?? null, line: m.line ?? null });
  }
  return {
    item_id: bundle.item_id,
    locations,
    // Renamed HERE and only here: `claim`/`detail` is what a reader needs to see, and
    // the card keeps the record's own field names because the matcher reads them.
    claims: bundle.members.map((m) => ({ claim: m.summary ?? null, detail: m.evidence ?? null })),
    // The lens is a defect CATEGORY, not a verdict: it says which reviewer prompt
    // raised the claim, never what anyone concluded about it. Offered as a suggestion
    // for the annotator's own `kind` field, which is what §4's defect-type axis reads.
    kind_suggestion: bundle.members.map((m) => m.lens).find((l) => nonEmptyString(l)) ?? null,
    covers: bundle.covers,
    diff: nonEmptyString(diff) ? diff : null,
    presented_fields: [...PRESENTED_FIELDS],
    withheld_fields: [...WITHHELD_FIELDS],
  };
}

/** The payload as text. Reads the payload only, so it cannot print what is not in it. */
export function renderCard(payload, { index = null, total = null } = {}) {
  const where = payload.locations.map((l) => (l.line ? `${l.file}:${l.line}` : l.file || "(no file)")).join(", ");
  const head = `── ${payload.item_id} · ${where}${index && total ? `  [${index}/${total}]` : ""}`;
  const claims = payload.claims
    .map((c, i) => {
      const n = payload.claims.length > 1 ? `[${i + 1}] ` : "";
      const detail = nonEmptyString(c.detail) ? `\n    ${String(c.detail).replace(/\n/g, "\n    ")}` : "";
      return `  ${n}${c.claim ?? "(no summary)"}${detail}`;
    })
    .join("\n");
  const covers = payload.covers > 1 ? `\n  (${payload.claims.length} wording(s) of one defect · one judgement settles ${payload.covers} record(s))` : "";
  const kind = payload.kind_suggestion ? `\n  suggested kind: ${payload.kind_suggestion}` : "";
  return `${head}\n${claims}${covers}${kind}\n`;
}

/**
 * The section of a unified diff that belongs to one file, so "read the diff at its
 * review point" (guide §0 rule 1) does not mean paging through 3361 lines.
 *
 * Boundaries only — it splits on `diff --git` and returns the matching sections
 * verbatim. It does NOT parse hunks or renumber anything: a diff reader that
 * reconstructs is a diff reader that can be wrong about what the reviewer saw, and
 * here the reader IS the human.
 */
export function fileDiffSection(diffText, file) {
  if (!nonEmptyString(diffText) || !nonEmptyString(file)) return null;
  const sections = String(diffText).split(/^(?=diff --git )/m);
  const hit = sections.filter((s) => s.startsWith("diff --git") && s.split("\n", 1)[0].includes(file));
  return hit.length ? hit.join("") : null;
}

/**
 * One judgement → one label per member key.
 *
 * The judgement is made ONCE, over the bundle, and every key it covers carries the
 * same answer plus `class_id`/`class_members` naming the bundle it came from. That is
 * the honest shape: 3 labels from 1 reading is not 3 readings, and `labelCensus`'s
 * `readings` is what tells them apart.
 */
export function applyJudgement({ bundle, judgement, context } = {}) {
  if (!isPlainObject(bundle) || !Array.isArray(bundle.keys) || bundle.keys.length === 0) refuse(`applyJudgement needs a bundle with keys, got ${JSON.stringify(bundle)}`);
  if (!isPlainObject(judgement)) refuse(`applyJudgement needs a judgement, got ${JSON.stringify(judgement)}`);
  if (!isPlainObject(context)) refuse(`applyJudgement needs a context (corpus version, annotators, the item's diff sha)`);
  const meta = context.itemMeta instanceof Map ? context.itemMeta.get(bundle.item_id) : null;
  const diffSha = isPlainObject(meta) ? meta.sha256_diff : undefined;
  if (!nonEmptyString(diffSha)) {
    refuse(
      `no sha256_diff for ${bundle.item_id} — the drift guard cannot be stamped, and an unstamped label can never be ` +
        `told from one written against a diff that has since been re-extracted`,
    );
  }
  return bundle.keys.map((key) =>
    buildFindingLabel({
      corpusVersion: context.corpusVersion,
      itemId: bundle.item_id,
      arm: bundle.arm,
      findingKey: key,
      // Only the CodeRabbit arm needs it, and only the CodeRabbit arm gets it: our
      // own summaries are written by the panel and nothing re-parses them.
      parserVintage: bundle.arm === "coderabbit" ? context.parserVintage ?? null : null,
      isReal: judgement.isReal,
      shouldVerifierKeep: judgement.shouldVerifierKeep,
      severity: judgement.severity,
      kind: judgement.kind ?? null,
      labelSource: context.labelSource,
      annotators: context.annotators,
      adjudication: {
        mode: context.mode,
        // This CLI OFFERS NO PRE-FILL, and that is a decision rather than an
        // omission. The only prior available today is cross-arm agreement, and
        // showing it is precisely the circularity the schema forbids — two AI
        // reviewers agreeing is evidence, and it is also exactly what a shared
        // hallucination looks like. The field exists so that a future prior arrives
        // as a suggestion a human confirms, never as a label.
        suggestion: null,
        suggestion_outcome: "not-shown",
        presented_fields: [...PRESENTED_FIELDS],
        withheld_fields: [...WITHHELD_FIELDS],
      },
      confidence: judgement.confidence,
      evidence: judgement.evidence ?? null,
      notes: judgement.notes ?? null,
      diffSha256: diffSha,
      classId: bundle.class_id,
      classMembers: bundle.keys,
    }),
  );
}

// --- the side effects, injected everywhere above -----------------------------

/**
 * Write through a temp file and a rename, so a label is only ever absent or COMPLETE.
 *
 * The third site of this pattern (`capture-store.mjs`, `store.mjs`), copied for the
 * reason the second one gives: exporting it means editing a merged module with live
 * consumers to serve a caller it does not have. A truncated label is worse than a
 * missing one — a missing label is an unjudged finding, a truncated label is an
 * unreadable judgement that a scorer either crashes on or silently skips.
 */
function writeFileAtomic(abs, bytes) {
  mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.part-${process.pid}`;
  rmSync(tmp, { force: true });
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, abs);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Nothing is written outside `--root`, asserted rather than trusted. */
function assertInsideRoot(root, abs) {
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    refuse(`refusing to write ${abs}, which is outside the --root ${base}`);
  }
  return abs;
}

/**
 * The one write path. Validates against the item's CURRENT `meta.json` — the drift
 * guard's live half — and refuses to overwrite unless asked.
 */
export function writeLabels(labels, { root, itemMeta = null, relabel = false } = {}) {
  const written = [];
  for (const label of labels) {
    const meta = itemMeta instanceof Map ? itemMeta.get(label.item_id) ?? null : itemMeta;
    validateLabel(label, { itemMeta: meta });
    const abs = assertInsideRoot(
      root,
      labelPathFor({ root, corpusVersion: label.corpus_version, schema: label.schema, itemId: label.item_id, arm: label.arm, findingKey: label.finding_key }),
    );
    if (existsSync(abs) && !relabel) {
      refuse(`${abs} already holds a label for this key — labels are correctable, so re-adjudicating is allowed, but only with --relabel`);
    }
    writeFileAtomic(abs, `${JSON.stringify(label, null, 2)}\n`);
    written.push(abs);
  }
  return written;
}

/**
 * Every finding label already on disk for a corpus version — the resume state, read
 * from the labels themselves rather than from a session file.
 *
 * A read path: it degrades to fewer labels rather than throwing, but an unreadable one
 * is COUNTED. Treating it as absent would re-ask a judgement that was already made and
 * then overwrite the only evidence of the first answer.
 *
 * `keys` is arm-qualified via `armKeyOf`, read off each label's own `arm` field rather
 * than off its directory: the field is what a scorer joins on, so it is what the
 * resume check must agree with.
 */
export function readFindingLabels(root, corpusVersion, { itemId = null } = {}) {
  const base = path.join(path.resolve(root), LABELS_DIR, corpusVersion, "findings");
  const out = [];
  const unreadable = [];
  if (!existsSync(base)) return { labels: out, unreadable, keys: new Set() };
  const items = itemId ? [itemId] : readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const item of items.sort()) {
    const itemDir = path.join(base, item);
    if (!existsSync(itemDir)) continue;
    // `findings/<item>/<arm>/<hash>.json`. The arm directories are enumerated rather
    // than assumed, so a tree written by a future arm is read rather than skipped.
    for (const armDir of readdirSync(itemDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      const dir = path.join(itemDir, armDir);
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
        const abs = path.join(dir, file);
        try {
          out.push(JSON.parse(readFileSync(abs, "utf8")));
        } catch (e) {
          unreadable.push({ path: abs, reason: e.message });
        }
      }
    }
  }
  return {
    labels: out,
    unreadable,
    keys: new Set(out.filter((l) => isPlainObject(l) && nonEmptyString(l.finding_key) && nonEmptyString(l.arm)).map((l) => armKeyOf(l.arm, l.finding_key))),
  };
}

/**
 * Which parse of CodeRabbit's markdown produced the summaries in this run's keys.
 *
 * The content hash of `harvest.mjs`, because that is the module whose output a
 * CodeRabbit `finding_key` hashes. Read rather than shelled out to git: the plumbing
 * is one file open, and a `git` call here would need a repository this CLI has no
 * reason to be inside.
 *
 * Returns `null` when the module cannot be read, and the CodeRabbit write path then
 * refuses. That direction is deliberate — a label with an unknown parser vintage
 * cannot be told from a current one, which is the whole point of the field.
 */
export function harvestVintage(agentDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))) {
  const abs = path.join(agentDir, "harvest.mjs");
  try {
    return `harvest.mjs@${contentSha256(readFileSync(abs, "utf8"))}`;
  } catch {
    return null;
  }
}

// --- the session -------------------------------------------------------------

const HELP =
  "  y            this describes a real defect in this code\n" +
  "  n            not real — the claim is wrong about the code (a hallucination)\n" +
  "  d            print the diff for this file, then ask again\n" +
  "  s            skip — no label written, asked again next session\n" +
  "  q            quit — everything already answered is on disk\n" +
  "  ?            this help";

const ask = async (io, prompt) => String(await io.ask(prompt)).trim();

/**
 * Read one value of a vocabulary, accepting an abbreviation only when it is
 * UNAMBIGUOUS.
 *
 * The first version took `v[0] === raw`, and on the severity scale that silently
 * resolves `m` to `major` — because `major` precedes `minor` in `KNOWN` and
 * `Array.find` stops at the first hit. A mistyped severity is a wrong label that
 * nothing downstream can detect, and it is the field the gate's own rule reads. So an
 * ambiguous prefix re-asks and names the candidates instead of picking one.
 */
async function askEnum(io, label, vocabulary, { allowBlank = null } = {}) {
  for (;;) {
    const raw = await ask(io, `${label} (${vocabulary.join("/")})${allowBlank ? ` [${allowBlank}]` : ""}: `);
    if (raw === "" && allowBlank) return allowBlank;
    if (vocabulary.includes(raw)) return raw;
    const matches = raw === "" ? [] : vocabulary.filter((v) => v.startsWith(raw));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) io.print(`  ? ${JSON.stringify(raw)} is ambiguous — ${matches.join(" or ")}?`);
    else io.print(`  ? ${label} must be one of ${vocabulary.join(" | ")}`);
  }
}

/**
 * Walk the queue, asking for one judgement per bundle and writing each one as it is
 * made.
 *
 * WRITES AS IT GOES, on purpose. Batching to the end would make an interrupt lose
 * every answer given since the start, which is the opposite of resumable for a task
 * whose whole problem is that it takes hours. So the label file is written the moment
 * the answer is complete, and the next session's queue reads those files back.
 *
 * `write` is INJECTED and `null` means preview: the session runs, prints, and stores
 * nothing. That is the default, because a tool whose first invocation writes to a
 * data repository is a tool that gets invoked once by accident.
 */
export async function runSession({ queue, io, write = null, context, onJudged = null } = {}) {
  const out = { asked: 0, judged: 0, skipped: 0, written: [], labels: [], quit: false };
  const total = queue.length;
  for (const [i, bundle] of queue.entries()) {
    const payload = presentBundle(bundle, { diff: null });
    io.print(renderCard(payload, { index: i + 1, total }));
    let verdict = null;
    for (;;) {
      const answer = await ask(io, "real defect? (y/n/d/s/q/?) ");
      if (answer === "?") { io.print(HELP); continue; }
      if (answer === "d") {
        const file = firstLocation(bundle).file;
        const section = fileDiffSection(context.diffFor?.(bundle.item_id) ?? null, file);
        io.print(section ?? `  (no diff section for ${file ?? "(no file)"} — read ${bundle.item_id}'s diff.patch directly)`);
        continue;
      }
      if (answer === "q") { out.quit = true; break; }
      if (answer === "s") { out.skipped++; break; }
      if (answer === "y" || answer === "n") { verdict = answer === "y"; break; }
      io.print(HELP);
    }
    if (out.quit) break;
    if (verdict === null) continue;
    out.asked++;
    const severity = await askEnum(io, "severity — YOUR call", KNOWN);
    const keepRaw = await ask(io, `should the verifier have kept it? [${verdict ? "Y/n" : "y/N"}] `);
    const shouldVerifierKeep = keepRaw === "" ? verdict : keepRaw.toLowerCase().startsWith("y");
    // No default. Guide §7's own warning is that absence is harder to prove than
    // presence, and a default would answer this for hundreds of labels at once.
    const confidence = await askEnum(io, "confidence", CONFIDENCE);
    const evidence = await ask(io, "evidence — what did you read? ");
    const kind = await ask(io, `kind [${payload.kind_suggestion ?? "none"}] `);
    const notes = await ask(io, "notes (optional) ");
    const judgement = {
      isReal: verdict,
      shouldVerifierKeep,
      severity,
      confidence,
      evidence,
      kind: kind === "" ? payload.kind_suggestion : kind,
      notes,
    };
    let labels;
    try {
      labels = applyJudgement({ bundle, judgement, context });
    } catch (e) {
      // A refusal here is the schema declining the judgement (an unexplained
      // divergence, a missing drift stamp). Reported and re-queued rather than
      // aborting the session: the reader keeps their place, and nothing is written.
      io.print(`  ! not written: ${e.message}`);
      continue;
    }
    out.judged++;
    out.labels.push(...labels);
    if (write) {
      const paths = write(labels);
      out.written.push(...paths);
      io.print(`  → ${paths.length} label(s) written`);
    } else {
      io.print(`  → ${labels.length} label(s) NOT written (preview; pass --write)`);
    }
    if (onJudged) onJudged({ bundle, labels });
  }
  return out;
}

/**
 * The item-level flow (guide §1.1), which is a different question from the finding
 * one and is asked over seven items rather than 245 defects.
 *
 * `true_defects[]` IS TYPED IN, never derived. It must include the defects no
 * reviewer found — those are what recall is measured against — and a set built from
 * the panel's findings cannot contain a miss. So there is no code path from findings
 * to this record, deliberately.
 */
export async function runItemSession({ itemId, io, write = null, context } = {}) {
  const meta = context.itemMeta instanceof Map ? context.itemMeta.get(itemId) : null;
  if (!isPlainObject(meta)) refuse(`no corpus meta.json for ${itemId} under this root — the drift guard has nothing to stamp`);
  io.print(`── ${itemId} · ${meta.scope ?? "?"} · ${meta.additions ?? "?"}+/${meta.deletions ?? "?"}- · ${(meta.changed_files ?? []).length} file(s)`);
  io.print("  read the diff first, and decide the correct verdict for yourself. true_defects includes defects NO reviewer found.");
  const trueDefects = [];
  for (;;) {
    const more = await ask(io, `add a true defect? (y/n) [${trueDefects.length} so far] `);
    if (!more.toLowerCase().startsWith("y")) break;
    const file = await ask(io, "  file: ");
    const range = await ask(io, "  line range (start-end, blank for none): ");
    const severity = await askEnum(io, "  severity", KNOWN);
    const kind = await ask(io, "  kind: ");
    const description = await ask(io, "  what is wrong, and why is it a defect: ");
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(range);
    trueDefects.push({
      file: file === "" ? null : file,
      line_range: m ? [Number(m[1]), Number(m[2])] : null,
      severity,
      kind: kind === "" ? null : kind,
      description,
    });
  }
  const verdictLabel = await askEnum(io, "verdict", VERDICT_LABELS);
  const stratum = await askEnum(io, "stratum", STRATA);
  const primary = verdictLabel === "approve" ? "" : await ask(io, "primary defect class: ");
  const confidence = await askEnum(io, "confidence", CONFIDENCE);
  const evidence = await ask(io, "evidence — what did you read? ");
  const notes = await ask(io, "notes (optional) ");
  let label;
  try {
    label = buildItemLabel({
      corpusVersion: context.corpusVersion,
      itemId,
      verdictLabel,
      primaryDefectClass: primary === "" ? null : primary,
      trueDefects,
      stratum,
      labelSource: context.labelSource,
      annotators: context.annotators,
      adjudication: {
        mode: context.mode,
        suggestion: null,
        suggestion_outcome: "not-shown",
        presented_fields: ["item", "diff", "changed-files", "issue-spec"],
        withheld_fields: [...WITHHELD_FIELDS],
      },
      confidence,
      evidence,
      notes,
      diffSha256: meta.sha256_diff,
    });
  } catch (e) {
    io.print(`  ! not written: ${e.message}`);
    return { label: null, written: [] };
  }
  if (!write) {
    io.print("  → 1 label NOT written (preview; pass --write)");
    return { label, written: [] };
  }
  const written = write([label]);
  io.print(`  → ${written.join(", ")}`);
  return { label, written };
}

// --- CLI ---------------------------------------------------------------------

const USAGE =
  "usage: adjudicate.mjs --root <eval-data-root> --corpus-version <cv>\n" +
  "                      (--records <records.json> | --run <run-id>[,<run-id>…]) [--item <pr-N>] [--arm panel|coderabbit]\n" +
  "                      [--order coverage|locality|none] [--limit <n>]\n" +
  "                      [--annotator <id>] [--mode human|model] [--label-source gold|silver]\n" +
  "                      [--item-verdict] [--write] [--relabel] [--json]\n" +
  "\n" +
  "Presents findings for judgement, BLIND to the reviewer's own verdict: no severity,\n" +
  "no verifier outcome, no gate decision, no cross-arm agreement reaches the screen.\n" +
  "Reads the corpus item's meta.json to stamp (and check) the drift guard.\n" +
  "\n" +
  "Writes NOTHING without --write. Resumable: a key that already has a label is not\n" +
  "asked again. --records takes the output of `adapters/panel.mjs --json` or\n" +
  "`adapters/coderabbit.mjs --json`.\n" +
  "\n" +
  "Pass every replicate of a run stem in ONE invocation. One judgement covers every\n" +
  "wording of one defect, and a defect is only recognised across replicates when they\n" +
  "are queued together: on the pilot that is 245 judgements for 428 records, against\n" +
  "428 judgements one run at a time.";

/** Argument checking, exported so it is testable without a terminal. */
export function resolveOptions(args) {
  const problems = [];
  if (!nonEmptyString(args.root)) problems.push("--root is required and has no default (git history is permanent; benchmark data must never land in this repository)");
  if (!nonEmptyString(args["corpus-version"])) problems.push("--corpus-version is required — a label is scoped to the corpus version it was read against");
  if (!nonEmptyString(args.records) && !nonEmptyString(args.run)) problems.push("one of --records or --run is required");
  if (nonEmptyString(args.records) && nonEmptyString(args.run)) problems.push("--records and --run are two sources; pass one");
  const order = args.order ?? "coverage";
  if (Object.hasOwn(REFUSED_ORDERS, order)) problems.push(`--order ${order} is refused: ${REFUSED_ORDERS[order]}`);
  else if (!ORDERS.includes(order)) problems.push(`--order must be one of ${ORDERS.join(" | ")}, got ${JSON.stringify(order)}`);
  const mode = args.mode ?? "human";
  if (!["human", "model"].includes(mode)) problems.push(`--mode must be human or model, got ${JSON.stringify(mode)}`);
  // gold is the tier the IAA ceiling is computed over, so it follows the mode rather
  // than a flag default: a human read is gold, a model read cannot be.
  const labelSource = args["label-source"] ?? (mode === "human" ? "gold" : "silver");
  if (!["gold", "silver"].includes(labelSource)) {
    problems.push(`--label-source must be gold or silver, got ${JSON.stringify(labelSource)} — "distant" labels come from a natural experiment, not from reading, so this CLI cannot produce one`);
  }
  if (args.write && !nonEmptyString(args.annotator)) {
    problems.push("--annotator is required to write — a label nobody is attributed to cannot be weighed against a second annotator, and the guide's rule is to attribute the REAL adjudicator");
  }
  // Comma-separated, because `--run a --run b` silently keeps only the last one:
  // `parseArgs` writes each flag into one key. See main() for why all K replicates
  // belong in one queue.
  const runs = nonEmptyString(args.run) ? args.run.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (nonEmptyString(args.run) && runs.length === 0) problems.push(`--run ${JSON.stringify(args.run)} names no run id`);
  const limit = args.limit === undefined ? null : Number(args.limit);
  if (limit !== null && !(Number.isInteger(limit) && limit > 0)) problems.push(`--limit must be a positive integer, got ${JSON.stringify(args.limit)}`);
  if (args.arm !== undefined && !ARMS.includes(args.arm)) problems.push(`--arm must be one of ${ARMS.join(" | ")}, got ${JSON.stringify(args.arm)}`);
  return {
    problems,
    root: args.root,
    corpusVersion: args["corpus-version"],
    records: args.records ?? null,
    runs,
    itemId: args.item ?? null,
    arm: args.arm ?? null,
    order,
    limit,
    mode,
    labelSource,
    annotator: args.annotator ?? null,
    itemVerdict: Boolean(args["item-verdict"]),
    write: Boolean(args.write),
    relabel: Boolean(args.relabel),
    json: Boolean(args.json),
  };
}

async function main() {
  const args = parseArgs(process.argv, { booleans: ["write", "relabel", "json", "help", "item-verdict"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const opts = resolveOptions(args);
  if (opts.problems.length) {
    console.error(USAGE);
    for (const p of opts.problems) console.error(`\n  ! ${p}`);
    process.exit(2);
  }
  const { EvalStore } = await import("./store.mjs");
  const store = new EvalStore(opts.root);

  let records = [];
  if (opts.records) {
    const parsed = JSON.parse(readFileSync(opts.records, "utf8"));
    records = Array.isArray(parsed) ? parsed : parsed.records ?? [];
  } else {
    const { runRecords } = await import("./adapters/panel.mjs");
    // ALL K REPLICATES AT ONCE, and this is not a convenience. Bundling is what makes
    // the job 245 judgements instead of 428, and a class only spans replicates if the
    // replicates are in the same grouping: measured on the pilot, k1 alone yields 142
    // classes for 142 records (the same-run gate merges almost nothing within one
    // run), while k1+k2+k3 yield 245 for 428. Queueing one run at a time is 428
    // judgements done in three sittings.
    for (const runId of opts.runs) {
      for (const item of runRecords(store, runId, { population: "reported", itemId: opts.itemId })) records.push(...item.records);
    }
  }

  // The corpus item's own `meta.json`, per item, because the drift guard compares
  // against `sha256_diff` and nothing else may stand in for it.
  const itemMeta = new Map();
  const diffs = new Map();
  for (const id of new Set([...records.map((r) => r?.item_id), opts.itemId].filter(nonEmptyString))) {
    const input = store.getCorpusItemInput(id);
    if (!input) {
      console.error(`  ! ${id} is not frozen under this root — no meta.json, so no drift stamp is obtainable`);
      continue;
    }
    itemMeta.set(id, input.meta);
    diffs.set(id, input.diff);
  }

  const existing = readFindingLabels(opts.root, opts.corpusVersion);
  for (const u of existing.unreadable) console.error(`  ! unreadable label ${u.path}: ${u.reason}`);

  const context = {
    corpusVersion: opts.corpusVersion,
    itemMeta,
    diffFor: (id) => diffs.get(id) ?? null,
    annotators: opts.annotator ? [opts.annotator] : [],
    mode: opts.mode,
    labelSource: opts.labelSource,
    parserVintage: harvestVintage(),
  };
  const write = opts.write ? (labels) => writeLabels(labels, { root: opts.root, itemMeta, relabel: opts.relabel }) : null;
  const io = { print: (t) => console.log(t), ask: null };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  io.ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  try {
    if (opts.itemVerdict) {
      if (!nonEmptyString(opts.itemId)) {
        console.error("  ! --item-verdict needs --item <pr-N>");
        process.exit(2);
      }
      await runItemSession({ itemId: opts.itemId, io, write, context });
      return;
    }
    const { queue, census, dropped } = buildQueue({
      records,
      labelled: existing.keys,
      arm: opts.arm,
      itemId: opts.itemId,
      order: opts.order,
      limit: opts.limit,
    });
    for (const d of dropped) console.error(`  ! dropped record ${d.index} (${d.item_id ?? "-"}): ${d.reason}`);
    console.error(
      `${census.records_in} record(s) in · ${census.cards} admitted · ${census.dropped} dropped\n` +
        `${census.bundles} defect class(es) · ${census.settled} already labelled · ${census.pending} pending\n` +
        `queued ${census.queued}, covering ${census.records_covered_by_queue} record(s)` +
        (census.withheld_from_queue ? ` · ${census.withheld_from_queue} held back by --limit` : "") +
        `\norder ${opts.order} · ${opts.write ? "WRITING" : "preview — nothing will be written"}`,
    );
    if (opts.json) {
      console.log(JSON.stringify({ census, queue: queue.map((b) => presentBundle(b)) }, null, 2));
      return;
    }
    if (queue.length === 0) {
      console.error("nothing pending.");
      return;
    }
    const result = await runSession({ queue, io, write, context });
    const census2 = labelCensus(result.labels);
    console.error(
      `\n${result.judged} judgement(s) → ${census2.n} label(s)` +
        ` · ${result.skipped} skipped · ${result.written.length} written` +
        (result.quit ? " · quit early (resume with the same command)" : ""),
    );
  } finally {
    rl.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("adjudicate failed:", e.message);
    process.exit(1);
  });
}
