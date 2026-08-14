// Tests for config_hash, in two halves.
//
// The first half is the ordinary one: for each behaviour-determining field, a pair
// that differs only in that field must hash DIFFERENTLY, and a pair that differs
// only in omitted-vs-explicit-default must hash the SAME. Both directions, every
// field. A hash with only the first half is a hash that splits every population;
// with only the second, one that merges every population.
//
// The second half is the guard, and it is the actual deliverable. Four of the five
// divergences this module was written to fix were ONE mistake: a field was added to
// `lenses.json` and nobody updated a hardcoded list. Fixing five instances buys
// nothing past the next field, so the union of keys across the REAL `lenses.json`
// — and the union of fields `review-panel.mjs` actually reads off a lens — are held
// against the hashed list, and anything in neither must be named in an
// excluded-set with a written reason.
//
// Deliberately NOT a golden hash string. A test that pins `sha256:9f2c…` goes red on
// every legitimate change to the manifest and teaches whoever is on the other end
// to update the constant, which is how a guard becomes a formality.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  configHash,
  contentHash,
  canonicalConfig,
  CONFIG_HASH_VERSION,
  DEFAULT_EFFORT,
  HASHED_CONFIG_FIELDS,
  HASHED_LENS_FIELDS,
  COSMETIC_CONFIG_FIELDS,
  COSMETIC_LENS_FIELDS,
} from "./config-hash.mjs";
import { FILE_CLASSES, sampleCountFor, sliceDiffByFile, diffForLens } from "../review-panel.mjs";
import { assertEffort, EFFORT_LEVELS } from "../ask.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LENSES_JSON = path.join(HERE, "..", "lenses", "lenses.json");
const REVIEW_PANEL = path.join(HERE, "..", "review-panel.mjs");

// Shaped like a real lens (see scripts/agent/lenses/lenses.json) so the pairs below
// differ in exactly one field and nothing else.
const baseLens = {
  id: "correctness",
  title: "Correctness",
  model: "claude-opus-5",
  samples: 1,
  gating: "blocking",
  needsIssueSpec: false,
  appliesWhen: ["**"],
  scopeClasses: ["code", "code-adjacent", "policy"],
  effort: "medium",
  rubric_sha256: "sha256:aaa",
};
const base = {
  schema_version: 1,
  config_id: "baseline",
  target: "reviewer",
  description: "baseline",
  sdk_version: "0.3.217",
  lenses: [
    { ...baseLens },
    { ...baseLens, id: "security", title: "Security", rubric_sha256: "sha256:bbb" },
  ],
};

/** `base` with its first lens replaced by `{...baseLens, ...patch}`, minus any key
 * whose patch value is the sentinel `ABSENT` — so "omitted" is expressible. */
const ABSENT = Symbol("absent");
function withLens(patch) {
  const lens = { ...baseLens, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === ABSENT) delete lens[k];
  return { ...base, lenses: [lens, base.lenses[1]] };
}
const hashWith = (patch) => configHash(withLens(patch));

// --- half one: every field, both directions ---------------------------------

test("same reviewer, lenses in different order → same hash", () => {
  const reordered = { ...base, lenses: [base.lenses[1], base.lenses[0]] };
  assert.equal(configHash(base), configHash(reordered));
});

test("configHash is prefixed and deterministic", () => {
  assert.match(configHash(base), /^sha256:[0-9a-f]{64}$/);
  assert.equal(configHash(base), configHash(base));
});

test("excluded manifest fields do NOT change identity", () => {
  const h = configHash(base);
  for (const key of Object.keys(COSMETIC_CONFIG_FIELDS)) {
    assert.equal(configHash({ ...base, [key]: "something-else" }), h, `${key} must be cosmetic`);
  }
});

test("canonicalConfig omits excluded fields entirely", () => {
  const c = canonicalConfig(base);
  assert.ok(!c.includes("baseline"), "config_id leaked into the canonical form");
  assert.ok(!c.includes("0.3.217"), "sdk_version leaked into the canonical form");
  assert.ok(c.includes("reviewer"), "target must be hashed");
});

test("target is behaviour-determining", () => {
  assert.notEqual(configHash({ ...base, target: "fixer" }), configHash(base));
});

test("contentHash is deterministic and prefixed", () => {
  assert.equal(contentHash("hello"), contentHash("hello"));
  assert.notEqual(contentHash("hello"), contentHash("world"));
  assert.match(contentHash("x"), /^sha256:[0-9a-f]{64}$/);
});

test("id / title / model / rubric_sha256 are behaviour-determining", () => {
  const h = configHash(base);
  assert.notEqual(hashWith({ id: "renamed" }), h, "a lens id is which reviewer ran");
  assert.notEqual(hashWith({ title: "Correctness (v2)" }), h, "the title reaches the lens prompt");
  assert.notEqual(hashWith({ model: "claude-sonnet-5" }), h);
  assert.notEqual(hashWith({ rubric_sha256: "sha256:zzz" }), h, "a reworded rubric is a different reviewer");
});

test("scopeClasses: a code-only lens and an everything lens must NOT hash alike", () => {
  // The false negative that mattered most: `scopeClasses` decides which hunks a
  // lens READS, and it was absent from the hash entirely.
  assert.notEqual(
    hashWith({ scopeClasses: ["code"] }),
    hashWith({ scopeClasses: FILE_CLASSES }),
    "two lenses reading different slices of the diff hashed identically",
  );
});

test("scopeClasses: omitted hashes as the panel's effective value (EVERYTHING)", () => {
  // And it must, or fixing the divergence above would open one of the same shape:
  // a lens omitting the field behaves exactly like one listing all five classes.
  assert.equal(hashWith({ scopeClasses: ABSENT }), hashWith({ scopeClasses: FILE_CLASSES }));
  assert.equal(hashWith({ scopeClasses: [] }), hashWith({ scopeClasses: FILE_CLASSES }));
});

test("scopeClasses: the omitted-means-everything equivalence is the PANEL's, not a copy", () => {
  // Asserted through the panel's own routing rather than against a list, so this
  // stays true if FILE_CLASSES changes. If the two lenses receive the same diff
  // from `diffForLens`, they must hash the same; the hash is downstream of that.
  const diff = [
    "diff --git a/packages/core/src/x.ts b/packages/core/src/x.ts",
    "@@ -1 +1 @@", "-a", "+b",
    "diff --git a/docs/design/y.md b/docs/design/y.md",
    "@@ -1 +1 @@", "-c", "+d",
  ].join("\n");
  const blocks = sliceDiffByFile(diff);
  const omitted = { id: "x" };
  const explicit = { id: "x", scopeClasses: FILE_CLASSES };
  assert.equal(
    diffForLens(omitted, blocks),
    diffForLens(explicit, blocks),
    "the panel no longer treats an omitted scopeClasses as everything — re-derive the normalisation",
  );
  assert.equal(hashWith({ scopeClasses: ABSENT }), hashWith({ scopeClasses: FILE_CLASSES }));
});

test("scopeClasses is a SET: order and duplicates do not change identity", () => {
  // `lensScope` builds a Set, so the file's ordering carries no meaning.
  assert.equal(hashWith({ scopeClasses: ["policy", "code"] }), hashWith({ scopeClasses: ["code", "policy"] }));
  assert.equal(hashWith({ scopeClasses: ["code", "code"] }), hashWith({ scopeClasses: ["code"] }));
});

test("effort: two lenses differing only in the panel's main cost dial must NOT hash alike", () => {
  assert.notEqual(hashWith({ effort: "medium" }), hashWith({ effort: "low" }));
  assert.notEqual(hashWith({ effort: "medium" }), hashWith({ effort: "high" }));
});

test("effort: omitted hashes as the SDK default, so `security` is not a special case", () => {
  // `security` is the live instance: it is the one lens of six that sets no
  // `effort`, so it runs at `high` by omission.
  assert.equal(hashWith({ effort: ABSENT }), hashWith({ effort: DEFAULT_EFFORT }));
  assert.notEqual(hashWith({ effort: ABSENT }), hashWith({ effort: "medium" }));
});

test("DEFAULT_EFFORT is a level the panel's own validator accepts, and unset is legal", () => {
  // The equivalence above rests on two upstream facts. Both are machine-checked
  // here so the normalisation cannot outlive them.
  assert.ok(EFFORT_LEVELS.includes(DEFAULT_EFFORT), `${DEFAULT_EFFORT} is not an SDK effort level`);
  assert.equal(assertEffort(DEFAULT_EFFORT), DEFAULT_EFFORT);
  assert.equal(assertEffort(undefined), undefined, "if unset stopped being legal, absent would have no default");
});

test("effort: a value the panel would REFUSE still hashes distinctly (over-sensitive on purpose)", () => {
  // The panel throws on an unrecognised effort before spending a token, so there is
  // no behaviour for a typo to be equivalent to. Splitting is the safe direction,
  // and `configHash` is a read path — it must not throw.
  assert.notEqual(hashWith({ effort: "hgih" }), hashWith({ effort: "high" }));
  assert.notEqual(hashWith({ effort: null }), hashWith({ effort: ABSENT }));
});

test("samples: hash equality follows the PANEL's sample count, in both directions", () => {
  // A property, not a table of cases: for every pair of `samples` values, the two
  // hash the same exactly when the panel would run the same number of samples.
  // This is what the fork's hand-mirrored `Math.max(1, Number(x) || 2)` broke — it
  // agreed on the default of 2 and still split populations on a fractional value
  // and on Infinity.
  const values = [ABSENT, 0, 1, 2, 3, 1.9, 2.5, -5, "3", "abc", null, JSON.parse("1e999")];
  for (const a of values) {
    for (const b of values) {
      const panelAgrees =
        sampleCountFor(a === ABSENT ? {} : { samples: a }) === sampleCountFor(b === ABSENT ? {} : { samples: b });
      const hashAgrees = hashWith({ samples: a }) === hashWith({ samples: b });
      assert.equal(
        hashAgrees,
        panelAgrees,
        `samples ${JSON.stringify(a)} vs ${JSON.stringify(b)}: panel runs ` +
          `${sampleCountFor(a === ABSENT ? {} : { samples: a })} vs ` +
          `${sampleCountFor(b === ABSENT ? {} : { samples: b })}, hash ${hashAgrees ? "merged" : "split"} them`,
      );
    }
  }
});

test("samples: the panel's default is 2, so omitted hashes as 2 and NOT as 1", () => {
  // Spelled out because it is easy to get backwards: `createWarmupGate`'s
  // `Math.max(1, Number(samples) || 1)` is a floor on a value `sampleCountFor` has
  // already normalised, not the default.
  assert.equal(sampleCountFor({}), 2, "upstream changed the default — re-derive this file");
  assert.equal(hashWith({ samples: ABSENT }), hashWith({ samples: 2 }));
  assert.notEqual(hashWith({ samples: ABSENT }), hashWith({ samples: 1 }));
});

test("maxTurns: a turn ceiling is behaviour-determining, and only a finite one counts", () => {
  // Absent from the hash before this PR. No lens sets one today, which is why:
  // a guard that reads only `lenses.json` cannot see a field no lens sets.
  assert.notEqual(hashWith({ maxTurns: 8 }), hashWith({ maxTurns: ABSENT }));
  assert.notEqual(hashWith({ maxTurns: 8 }), hashWith({ maxTurns: 20 }));
  // `buildSessionOptions` forwards it only when `Number.isFinite`, so everything
  // else is one reviewer: the SDK default.
  for (const dropped of ["8", null, NaN, JSON.parse("1e999")]) {
    assert.equal(
      hashWith({ maxTurns: dropped }),
      hashWith({ maxTurns: ABSENT }),
      `maxTurns ${JSON.stringify(dropped)} never reaches the SDK, so it is the default`,
    );
  }
});

test("gating: a string in the manifest, a boolean in effect", () => {
  // Both consumers compute `String(lens.gating ?? "blocking") === "blocking"` —
  // review-panel.mjs:2255 and agent-review-panel.yml:832 — so anything that is not
  // "blocking" is the same reviewer, including a typo.
  assert.equal(hashWith({ gating: ABSENT }), hashWith({ gating: "blocking" }));
  assert.equal(hashWith({ gating: "advisory" }), hashWith({ gating: "blockign" }));
  assert.notEqual(hashWith({ gating: "blocking" }), hashWith({ gating: "advisory" }));
});

test("needsIssueSpec is read as a truthiness test, so absent and false are one reviewer", () => {
  assert.equal(hashWith({ needsIssueSpec: ABSENT }), hashWith({ needsIssueSpec: false }));
  assert.notEqual(hashWith({ needsIssueSpec: true }), hashWith({ needsIssueSpec: false }));
});

test("appliesWhen: absent, empty, and any list containing ** are all 'runs on everything'", () => {
  // `lensApplies` short-circuits on `globs.includes("**")`, so a wildcard plus
  // anything else is still a wildcard.
  const wildcard = hashWith({ appliesWhen: ["**"] });
  assert.equal(hashWith({ appliesWhen: ABSENT }), wildcard);
  assert.equal(hashWith({ appliesWhen: [] }), wildcard);
  assert.equal(hashWith({ appliesWhen: ["**", "packages/**"] }), wildcard);
  assert.notEqual(hashWith({ appliesWhen: ["packages/**"] }), wildcard);
});

test("appliesWhen is a SET: order and duplicates do not change identity", () => {
  assert.equal(hashWith({ appliesWhen: ["a", "b"] }), hashWith({ appliesWhen: ["b", "a"] }));
  assert.equal(hashWith({ appliesWhen: ["a", "a"] }), hashWith({ appliesWhen: ["a"] }));
});

test("an omitted default hashes identically to the same default written out", () => {
  // The whole set at once, which is the form a manifest actually arrives in.
  const spelledOut = withLens({});
  const omitted = {
    ...base,
    lenses: [
      { id: "correctness", title: "Correctness", model: "claude-opus-5", rubric_sha256: "sha256:aaa", samples: 2, scopeClasses: FILE_CLASSES, effort: DEFAULT_EFFORT },
      base.lenses[1],
    ],
  };
  const allDefaults = { ...base, lenses: [{ id: "correctness", title: "Correctness", model: "claude-opus-5", rubric_sha256: "sha256:aaa" }, base.lenses[1]] };
  assert.notEqual(configHash(spelledOut), configHash(allDefaults), "baseLens is not all-defaults, so this pair must differ");
  assert.equal(configHash(omitted), configHash(allDefaults));
});

// --- half two: the guard ----------------------------------------------------

const HASHED = new Set(HASHED_LENS_FIELDS);
const COSMETIC = new Set(Object.keys(COSMETIC_LENS_FIELDS));

/**
 * The core of the guard, as a function of the lens objects rather than of the file,
 * so it can be pointed at a fixture and PROVEN to fail. A guard whose failure path
 * is never executed is a guard nobody has tested.
 */
function unclassifiedLensKeys(lenses) {
  const keys = new Set();
  for (const lens of lenses) for (const k of Object.keys(lens)) keys.add(k);
  return [...keys].filter((k) => !HASHED.has(k) && !COSMETIC.has(k)).sort();
}

/** The guard's one assertion, so its failure MESSAGE names the offending fields
 * rather than leaving them to be read out of an assertion diff. */
function assertAllClassified(unclassified, where) {
  assert.deepEqual(
    unclassified,
    [],
    `${where} carries unclassified lens field(s): ${unclassified.join(", ")}. ` +
      "Add each to HASHED_LENS_FIELDS if it changes what a lens does, or to " +
      "COSMETIC_LENS_FIELDS with the reason it does not.",
  );
}

/**
 * Every lens field a source file READS, by any syntax the codebase might use. A
 * function of the text rather than of the panel's path, for the same reason
 * `unclassifiedLensKeys` is a function of the lens objects: a branch that today's panel
 * happens not to exercise is a branch no test covers, and the destructuring branch is
 * exactly that — the panel destructures no lens right now.
 *
 * NO WHITESPACE before the dot, which is what separates a property read from prose:
 * the panel's comments are full of sentences ending "…per lens." followed by a
 * capitalised word, and a tolerant `\s*` matched four of them (`Each`, `Keep`, `Not`,
 * `const`) on the first version of this scan. Comments are NOT stripped — a
 * hand-rolled JS comment stripper mis-handles strings, template literals and regex
 * literals, and its failure mode is dropping a real read, which is a false GREEN.
 * Matching a field named inside a comment is the other direction: one more field to
 * classify, never one fewer.
 */
function lensFieldsReadIn(src) {
  const read = new Set();
  for (const m of src.matchAll(/\blens\??\.([A-Za-z_$][\w$]*)/g)) read.add(m[1]);
  for (const m of src.matchAll(/\blens\s*\?\?\s*\{\s*\}\s*\)\.([A-Za-z_$][\w$]*)/g)) read.add(m[1]);
  // DESTRUCTURING — `const { effort, model } = lens`. A member-read-only scan would go
  // quietly blind the first time someone wrote a lens read this way. `a: b` renames
  // contribute the SOURCE key (`a`) and not the local name, and a default (`a = 1`) is
  // trimmed to `a`.
  //
  // A REST ELEMENT (`...rest`) is skipped: it is a local holding the remaining fields,
  // not a field name, and adding it would put a phantom key into the classified set.
  // Nothing hides there — reading fields through a rest spread means reading whatever
  // `lenses.json` actually sets, which is precisely what the other guard enumerates.
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=\s*\(?\s*lens\b/g)) {
    for (const part of m[1].split(",")) {
      if (/^\s*\.\.\./.test(part)) continue;
      const name = /^\s*([A-Za-z_$][\w$]*)\s*(?::|=|$)/.exec(part);
      if (name) read.add(name[1]);
    }
  }
  return read;
}

test("guard: the scan sees every syntax a lens read can be written in", () => {
  // The scan's own unit test, against a fixture rather than the panel — otherwise the
  // destructuring branch is untestable until someone refactors the panel, and an
  // untested branch is decoration. Confirmed by mutation: blinding that branch leaves
  // every other assertion in this file green.
  const fields = lensFieldsReadIn(`
    const a = lens.model;                       // plain member read
    const b = lens?.scopeClasses;               // optional chaining
    const c = (lens ?? {}).samples;             // the sampleCountFor form
    const { effort, maxTurns } = lens;          // destructuring
    const { gating: isBlocking } = lens;        // renamed — the SOURCE key counts
    const { title = "x" } = lens ?? {};         // defaulted, and off a nullish guard
    const { id, ...restOfLens } = lens;         // rest element is not a field
  `);
  for (const expected of ["model", "scopeClasses", "samples", "effort", "maxTurns", "gating", "title", "id"]) {
    assert.ok(fields.has(expected), `the scan missed \`${expected}\``);
  }
  assert.equal(fields.has("isBlocking"), false, "a rename's LOCAL name is not a manifest field");
  assert.equal(fields.has("restOfLens"), false, "a rest element is not a manifest field");
  // And it does not invent fields out of prose ending in "lens."
  assert.equal(lensFieldsReadIn("// two samples per lens. Each one costs money.\n").size, 0);
});

test("guard: every key in the real lenses.json is hashed or named cosmetic", () => {
  const lenses = JSON.parse(readFileSync(LENSES_JSON, "utf8"));
  assert.ok(lenses.length >= 6, `expected the real manifest, got ${lenses.length} lenses`);
  assertAllClassified(unclassifiedLensKeys(lenses), "scripts/agent/lenses/lenses.json");
});

test("guard: the guard itself fails, and names the field", () => {
  // A guard whose failure path is never executed is a guard nobody has tested.
  const withFake = [{ id: "correctness", effort: "medium", cacheWarmupStrategy: "eager" }];
  const unclassified = unclassifiedLensKeys(withFake);
  assert.deepEqual(unclassified, ["cacheWarmupStrategy"]);
  let message = "";
  try { assertAllClassified(unclassified, "a fixture"); } catch (err) { message = String(err.message); }
  assert.match(message, /cacheWarmupStrategy/, "the guard's failure must NAME the field");
  assert.match(message, /HASHED_LENS_FIELDS/, "and say what to do about it");
});

test("guard: every field review-panel.mjs reads off a lens is hashed or named cosmetic", () => {
  // The stronger half. `lenses.json` only shows fields somebody set; the panel shows
  // fields it CONSUMES, which is the real definition of behaviour-determining —
  // `maxTurns` was in the second set and not the first, and that is exactly how it
  // stayed out of the hash.
  //
  const read = lensFieldsReadIn(readFileSync(REVIEW_PANEL, "utf8"));

  // FLOOR, so a refactor that defeats the scan fails loudly instead of passing
  // vacuously — the #676 lesson, where a whole-file regex matched inside the wrong
  // block and the assertion passed for the wrong reason. Every field the panel reads
  // today is named here, so reformatting any existing read (`lens\n  .effort`) goes
  // red rather than silently vanishing from the scan. This list going red otherwise
  // means the panel STOPPED reading a lens field: worth a look, not a rubber stamp.
  for (const known of ["id", "title", "model", "samples", "gating", "needsIssueSpec", "appliesWhen", "scopeClasses", "effort", "maxTurns", "rubric"]) {
    assert.ok(read.has(known), `the scan did not find \`lens.${known}\` in review-panel.mjs — the scan is broken, not the panel`);
  }

  assertAllClassified([...read].filter((k) => !HASHED.has(k) && !COSMETIC.has(k)).sort(), "review-panel.mjs");
});

test("guard: HASHED_LENS_FIELDS is what normalizeLens actually emits, not a comment", () => {
  // Without this the exported list is decoration: it could name a field the
  // canonical form omits, and the two guards above would pass while the hash
  // ignored it. This is the invariant the fork's header CLAIMED and no test held.
  const canonical = JSON.parse(canonicalConfig(withLens({})));
  assert.deepEqual(Object.keys(canonical.lenses[0]).sort(), [...HASHED_LENS_FIELDS].sort());
  assert.deepEqual(Object.keys(canonical).sort(), [...HASHED_CONFIG_FIELDS].sort());
});

test("guard: every excluded field carries a written reason", () => {
  for (const [set, name] of [[COSMETIC_LENS_FIELDS, "COSMETIC_LENS_FIELDS"], [COSMETIC_CONFIG_FIELDS, "COSMETIC_CONFIG_FIELDS"]]) {
    for (const [field, reason] of Object.entries(set)) {
      assert.equal(typeof reason, "string", `${name}.${field} needs a reason`);
      assert.ok(reason.length >= 20, `${name}.${field}'s reason is too short to be one: ${JSON.stringify(reason)}`);
    }
  }
});

test("guard: no field is both hashed and cosmetic", () => {
  const both = HASHED_LENS_FIELDS.filter((f) => COSMETIC.has(f));
  assert.deepEqual(both, [], "a field cannot both determine behaviour and be cosmetic");
});

test("the lens sort is locale-INDEPENDENT, so one manifest cannot hash two ways", () => {
  // `localeCompare` takes its collation from the runtime (ICU data + LC_ALL/LANG), so
  // it is a different function on two machines. Measured on the version that used it:
  // a manifest with lenses `ch` and `hz` sorted [ch, hz] under en-US and [hz, ch]
  // under cs-CZ — Czech collates `ch` as one letter after `h` — producing two
  // different config_hash values for the same reviewer. CI runs one locale and a
  // laptop another, so the only symptom would have been results that will not pool.
  //
  // Asserted as "the canonical order is code-unit order", which is checkable in any
  // locale, rather than by switching locale mid-process (impossible) or by asking
  // Intl about `cs` (which a small-icu build would answer differently).
  const ids = ["hz", "ch", "Docs", "docs", "design-fit", "designfit", "a_b", "a-b", "blast-radius"];
  const manifest = { target: "reviewer", lenses: ids.map((id) => ({ id, rubric_sha256: "sha256:s" })) };
  const canonical = JSON.parse(canonicalConfig(manifest));
  assert.deepEqual(
    canonical.lenses.map((l) => l.id),
    [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    "lenses are not in code-unit order — a locale-sensitive comparator makes the hash machine-dependent",
  );
  // And identity must not depend on the order the lenses were written in the file,
  // which is the whole reason there is a sort at all.
  const reversed = { ...manifest, lenses: [...manifest.lenses].reverse() };
  assert.equal(configHash(manifest), configHash(reversed));
});

test("the hash algorithm carries a vintage", () => {
  // A stored hash from the fork's version is not comparable to one from this
  // version, and without a recorded vintage the only evidence of that is a
  // mismatch nobody can attribute.
  assert.match(CONFIG_HASH_VERSION, /^wafflebase\/config-hash@\d+$/);
});
