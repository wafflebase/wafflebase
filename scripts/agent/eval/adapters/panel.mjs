// Our arm, behind the record seam: a stored run envelope → finding records.
//
// Pure and free. It reads what a replay already wrote and derives; it spawns
// nothing, calls no model and needs no API key. Records are NOT stored — see
// "nothing is written" below.
//
// THE DEFECT THIS REPLACES. The fork harness's `signal-harvest.mjs` decided
// whether a finding gated with `blocking: BLOCKING.has(severity)` (`:92`), and
// contained zero references to `lane` — measured, in the whole module. Since
// #668 that answer is wrong in a specific and silent direction: a `critical`
// routed to `backlog` does not gate, so every demoted finding was labelled a
// blocking one. It is the precise error `buildStageDetail`'s docstring warns
// readers against, and it is the third of four sites where the lane is
// discarded (spec §10.1; #682 fixed the second, the fidelity PR the first).
//
// It also re-declared `BLOCKING` locally, as `new Set(["critical","major"])`,
// under a comment claiming it mirrored `severity.mjs`. It did match. Nothing
// enforced that it would keep matching, and the same re-typing pattern has
// already cost this project a paid harvest. Here the rule is imported —
// `gatingOf` in `finding-record.mjs` reads `severity.mjs`'s own `BLOCKING` and
// `normalizeSeverity`, so "what blocks a PR" has one definition.
//
// WHAT IS INERT TODAY, STATED PLAINLY. Every replay so far runs with the novelty
// gate OFF (`gate.state: "off-no-base-sha"`), because the runner materialises
// the review tree with `git archive` and an archive has no `.git` to blame.
// With no base, `noveltyOf` answers `origin: "unknown"` for everything and
// `routeFinding` returns `blocking` — so blocking findings DO carry a lane, and
// it is always `blocking`. `lane: "backlog"` cannot occur until the fidelity PR
// gives the panel a real worktree and a `--base-sha`. The lane-aware code below
// is therefore correct, tested, and changes no number on today's data. What it
// changes is that the number will be right when it can be wrong — and
// `panel.gate_state` rides on every record so nobody pools a gate-off run with a
// gate-on one, which is the whole reason the envelope records it.
//
// NOTHING IS WRITTEN. Records are derived data: recomputable from an immutable
// envelope, deterministically and for free, so persisting them buys nothing and
// costs the store's write-once rule — a stored shape is expensive to correct,
// and the label store is a later PR's to design. This module is a library plus
// a CLI that prints.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeFindings } from "../../review-panel.mjs";
import { findingKey } from "../../finding-key.mjs";
import { parseArgs } from "../../gh-checks.mjs";
import { POPULATIONS, buildFindingRecord, gatingCensus, validateFindingRecord } from "../finding-record.mjs";

const refuse = (msg) => {
  throw new Error(`panel adapter: ${msg}`);
};

/**
 * Whether the population this call reads was in the envelope at all.
 *
 *   present  the field is there and is the right shape — including EMPTY, which
 *            is a real answer: a clean review genuinely finds nothing, and a
 *            true negative treated as a failure deletes the panel's clean rounds
 *            and inflates precision.
 *   absent   the field is `null` or the wrong shape. `adapters/reviewer.mjs`
 *            writes `findings: null` deliberately when the panel produced no
 *            usable output, precisely so "nothing was found" is not spellable by
 *            a missing file. Zero records for that reason is a different fact
 *            from zero records because the review was clean, and this is where
 *            the two stay apart.
 */
export const POPULATION_STATES = Object.freeze(["present", "absent"]);

/** Run-level provenance stamped onto every record, so one record is enough to
 *  decide whether it may be pooled with another. Repeated rather than
 *  normalised: records are derived and never stored, so there is nothing to
 *  denormalise, and a record that has to be joined against its run to be safely
 *  read is a record somebody will read unjoined. */
function provenanceOf(envelope) {
  const e = envelope && typeof envelope === "object" ? envelope : {};
  return {
    // The novelty gate's own self-report. `null` only for an envelope written
    // before the field existed — the store refuses one without it today.
    gate_state: typeof e.gate?.state === "string" ? e.gate.state : null,
    // The reviewer is the PAIR. `config_hash` cannot see the panel's code, so a
    // changed gate leaves it identical; `panel_sha` is the other half.
    config_hash: typeof e.config_hash === "string" ? e.config_hash : null,
    panel_sha: typeof e.panel_sha === "string" ? e.panel_sha : null,
    // Carried, NOT filtered on. `status: "ok"` means exactly one thing — this
    // item is poolable as a real verdict — so a scorer must exclude the rest.
    // Dropping them here instead would be a narrowing that hides how much of a
    // run failed, and this is a read path: it degrades to fewer records only
    // when it cannot build one, and says so when it does.
    item_status: typeof e.status === "string" ? e.status : null,
    item_reason: typeof e.reason === "string" ? e.reason : null,
  };
}

/** The panel-namespace fields read off the finding itself. Everything here is
 *  annotation the orchestrator adds AFTER the lens produced the finding — which
 *  is exactly the set the four discard sites lost. Read, never invented: a lane
 *  that is not there stays `null`, and the sampled population (where none of it
 *  exists yet) gets nulls rather than a guess. */
function findingDetail(f) {
  return {
    // Stamped by `adapters/reviewer.mjs` from the DIRECTORY the verdict was read
    // from, which upstream's `stampLens` establishes as the authority — a
    // finding is model output and a fill-the-blank rule would let it declare its
    // own lens.
    lens: typeof f.lens === "string" ? f.lens : null,
    lane: typeof f.lane === "string" ? f.lane : null,
    novelty: f.novelty && typeof f.novelty === "object" ? f.novelty : null,
    // The verifier searched and could not disprove the claim, which is NOT the
    // same as having confirmed it.
    unsettled: f.unsettled === true,
    // "confirmed-high" | "confirmed-low" | "errored", or absent on a finding
    // from a round before the field existed.
    verification: typeof f.verification === "string" ? f.verification : null,
    // The reported population is post-dedupe, so per-sample counts are gone by
    // construction. `null` says "this population cannot answer that", which is
    // not the same as `{raised: 0}`.
    samples: null,
  };
}

/**
 * `verdict.json`'s findings → records. The like-for-like comparator against
 * CodeRabbit's posted comments: what our panel actually REPORTED.
 *
 * Upstream keeps every finding here, demoted ones included, "with the `lane` and
 * `novelty` that explain each decision — it is the record, not the gate", and
 * #682's adapter copies each one whole and adds `lens`. So this is the one
 * population in which a finding has a lane, and the only one in which "did this
 * gate?" has a real answer.
 */
function reportedRecords(payload, ctx, dropped) {
  const findings = payload?.findings;
  if (!Array.isArray(findings)) return { state: "absent", records: [] };
  const records = [];
  findings.forEach((f, i) => {
    if (!(f && typeof f === "object" && !Array.isArray(f))) {
      dropped.push({ population: "reported", index: i, lens: null, reason: "not-an-object" });
      return;
    }
    records.push(buildFindingRecord({ ...ctx, population: "reported", finding: f, detail: { ...findingDetail(f), ...ctx.provenance } }));
  });
  return { state: "present", records };
}

/**
 * `stageDetail[lens].samples` → records: every finding every detection sample
 * raised, BEFORE dedupe, clustering, verification and lane routing.
 *
 * A DIFFERENT QUESTION, which is why it is a different population rather than
 * more rows. This one answers "what could this panel find across repeated
 * tries?"; the reported set answers "what did it say?". CodeRabbit has no
 * counterpart to it at all — it posts once — so nothing here is comparable
 * across arms, and `population` on every record is what stops a scorer pooling
 * the two by accident.
 *
 * NOTHING HERE HAS A LANE, by construction: `buildStageDetail` records the
 * samples as the lens emitted them, and `annotateFindings` runs later. So every
 * blocking-severity record from this population reads `gating: "unknown"` with
 * basis `lane-absent`, which is the honest answer and not a defect. The lane is
 * deliberately NOT joined in from the `verifications` rows, even though those
 * carry the annotated twin: attaching a post-gate fact to a pre-gate finding
 * would make one record two populations, which is the confusion this whole split
 * exists to prevent.
 *
 * The per-key representative is `dedupeFindings`' own choice — lane first, then
 * severity — rather than "the first sample that said it". Composed, not
 * re-implemented: a second dedupe rule beside the panel's is how our numbers
 * would drift from `review-lens-stats.json`'s.
 */
function sampledRecords(payload, ctx, dropped) {
  const sd = payload?.stageDetail;
  if (!sd || typeof sd !== "object" || Array.isArray(sd)) return { state: "absent", records: [] };
  const records = [];
  for (const lens of Object.keys(sd)) {
    const samples = Array.isArray(sd[lens]?.samples) ? sd[lens].samples : [];
    const total = samples.length;
    // key → how many SAMPLES raised it. A finding raised twice inside one sample
    // counts once: the signal is "did an independent try find this", and
    // double-counting one try would read as agreement between samples.
    const raised = new Map();
    const usable = [];
    samples.forEach((sample, si) => {
      const seenThisSample = new Set();
      (Array.isArray(sample) ? sample : []).forEach((f, fi) => {
        if (!(f && typeof f === "object" && !Array.isArray(f))) {
          dropped.push({ population: "sampled", lens, index: `${si}.${fi}`, reason: "not-an-object" });
          return;
        }
        usable.push(f);
        const key = findingKey(f);
        if (seenThisSample.has(key)) return;
        seenThisSample.add(key);
        raised.set(key, (raised.get(key) ?? 0) + 1);
      });
    });
    for (const f of dedupeFindings(usable)) {
      const detail = { ...findingDetail(f), lens, samples: { raised: raised.get(findingKey(f)) ?? 0, total }, ...ctx.provenance };
      records.push(buildFindingRecord({ ...ctx, population: "sampled", finding: f, detail }));
    }
  }
  return { state: "present", records };
}

/**
 * One stored run item → finding records, from one population.
 *
 * A READ PATH, so it degrades to fewer records rather than throwing — but never
 * silently: whatever it could not build a record from comes back in `dropped`,
 * with the lens and index that name it, and the CLI prints the count. A cap or a
 * skip that drops data without saying so reads downstream as "we measured
 * everything".
 *
 * It throws only when its CALLER is wrong: an unusable envelope, or a population
 * name that is not one of the two.
 */
export function panelRecords({ envelope, payload } = {}, { population = "reported" } = {}) {
  if (!POPULATIONS.includes(population)) {
    refuse(`population must be one of ${POPULATIONS.join(" | ")}, got ${JSON.stringify(population)}`);
  }
  if (!(envelope && typeof envelope === "object" && !Array.isArray(envelope))) {
    refuse(`an envelope object is required, got ${JSON.stringify(envelope)} — the run and item ids, the gate state and the reviewer identity all come from it`);
  }
  const itemId = envelope.item_id;
  if (typeof itemId !== "string" || itemId.trim() === "") {
    refuse(`envelope.item_id must be a non-empty string, got ${JSON.stringify(itemId)}`);
  }
  const ctx = {
    arm: "panel",
    itemId,
    runId: typeof envelope.run_id === "string" ? envelope.run_id : null,
    provenance: provenanceOf(envelope),
  };
  const dropped = [];
  const built = population === "reported" ? reportedRecords(payload, ctx, dropped) : sampledRecords(payload, ctx, dropped);
  // Validated here rather than trusted. `buildFindingRecord` and the validator
  // are two expressions of one schema, and the point of running both is that a
  // future edit to one has to survive the other.
  for (const r of built.records) validateFindingRecord(r);
  return { population, population_state: built.state, records: built.records, dropped };
}

// --- CLI: read a stored run, print records. Writes nothing. -----------------

/** Every item of a run as records, in `listItems` order. */
export function runRecords(store, runId, { population = "reported", itemId = null } = {}) {
  const ids = itemId ? [itemId] : store.listItems(runId);
  return ids.map((id) => {
    const stored = store.getItem(runId, id);
    if (!stored) return { item_id: id, population, population_state: "absent", records: [], dropped: [], missing: true };
    return { item_id: id, ...panelRecords(stored, { population }) };
  });
}

const USAGE =
  "usage: panel.mjs --root <eval-data-root> --run <run-id> [--item <item-id>] [--population reported|sampled] [--json]\n" +
  "\n" +
  "Derives finding records from a stored run. Reads only; writes nothing, spawns\n" +
  "nothing and costs nothing. --json prints the records to stdout.";

async function main() {
  const args = parseArgs(process.argv, { booleans: ["json", "help"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  // `--root` is REQUIRED and has no default anywhere in this directory. git
  // history is permanent, so one flag that fell back to a path inside this
  // repository would commit benchmark data into `wafflebase` for good.
  if (!args.root || !args.run) {
    console.error(USAGE);
    process.exit(2);
  }
  const population = args.population ?? "reported";
  if (!POPULATIONS.includes(population)) {
    console.error(`--population must be one of ${POPULATIONS.join(" | ")}, got ${JSON.stringify(population)}`);
    process.exit(2);
  }
  const { EvalStore } = await import("../store.mjs");
  const store = new EvalStore(args.root);
  const perItem = runRecords(store, args.run, { population, itemId: args.item ?? null });
  if (perItem.length === 0) {
    console.error(`no items under run ${args.run}`);
    process.exit(1);
  }
  const all = [];
  for (const item of perItem) {
    all.push(...item.records);
    const c = gatingCensus(item.records);
    const parts = Object.entries(c.gating).filter(([, n]) => n > 0).map(([g, n]) => `${n} ${g}`);
    console.error(
      `${item.item_id}: ${c.n} ${population} record(s)` +
        (parts.length ? ` — ${parts.join(", ")}` : "") +
        // Printed even when zero, because "0 records because the review was
        // clean" and "0 records because the panel wrote nothing usable" are
        // different facts and only one of them is a data point.
        ` · population ${item.population_state}` +
        (item.dropped.length ? ` · ${item.dropped.length} dropped` : ""),
    );
    for (const d of item.dropped) console.error(`  ! dropped ${item.item_id} ${d.lens ?? "-"}[${d.index}]: ${d.reason}`);
  }
  const census = gatingCensus(all);
  console.error(
    `\n${census.n} record(s) across ${perItem.length} item(s), population ${population}` +
      `\n  gating: ${Object.entries(census.gating).map(([g, n]) => `${g}=${n}`).join(" ")}` +
      `\n  basis:  ${Object.entries(census.basis).map(([b, n]) => `${b}=${n}`).join(" ") || "(none)"}`,
  );
  if (args.json) console.log(JSON.stringify(all, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("panel adapter failed:", e.message);
    process.exit(1);
  });
}
