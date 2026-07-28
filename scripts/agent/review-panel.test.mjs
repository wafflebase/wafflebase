import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  globToRegExp,
  lensApplies,
  dedupeFindings,
  applyVerifications,
  isDroppingVerdict,
  changedFileContext,
  coerceFindings,
  unionSamples,
  parsePriorFindings,
  compareSampleAgreement,
  severityCounts,
  confidenceCounts,
  LENS_CLOSING_INSTRUCTION,
  verifierTally,
  classifyResult,
  withRetry,
} from "./review-panel.mjs";
import { classify } from "./severity.mjs";

// The lens scoping under test is the REAL manifest, not a copy of it. An
// earlier draft of this test inlined the globs as literals, which meant an edit
// to lenses.json left the test green while the shipped behavior changed — the
// scoping was effectively untested. Read the manifest so the assertions below
// fail when the thing they claim to cover actually moves.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LENSES = JSON.parse(readFileSync(path.join(HERE, "lenses", "lenses.json"), "utf8"));
const lensOf = (id) => {
  const l = LENSES.find((x) => x.id === id);
  assert.ok(l, `lenses.json has no lens with id "${id}"`);
  return l;
};

test("globToRegExp / lensApplies: ** always; path globs match & reject", () => {
  assert.ok(globToRegExp("**").test("packages/frontend/src/x.ts"));
  assert.ok(globToRegExp("packages/frontend/**").test("packages/frontend/src/a.ts"));
  assert.ok(!globToRegExp("packages/frontend/**").test("packages/backend/a.ts"));
  assert.equal(lensApplies({ appliesWhen: ["**"] }, []), true);
  assert.equal(lensApplies({ appliesWhen: [] }, []), true); // empty array = wildcard default
  assert.equal(lensApplies({ appliesWhen: ["packages/frontend/**"] }, ["packages/frontend/a.ts"]), true);
  // a lens that does NOT apply
  assert.equal(lensApplies({ appliesWhen: ["packages/frontend/**"] }, ["packages/backend/a.ts"]), false);
});

test("lensApplies: path-scoped lenses skip docs-only diffs; correctness always applies", () => {
  // Read from the shipped manifest — see the note at the top of this file.
  const correctness = lensOf("correctness");
  // security stays wildcard so supply-chain / secret vectors in root-level and
  // any top-level file (root package.json, lockfiles, .npmrc, Dockerfile) are
  // never exempt from the blocking security gate.
  const security = lensOf("security");
  const designFit = lensOf("design-fit");
  const testAdequacy = lensOf("test-adequacy");

  // Docs-only PR: correctness + security always apply (security must not be
  // scoped away from root files); design-fit applies (docs/design); test-adequacy skipped.
  const docsOnly = ["docs/design/sheets/formula.md", "README.md"];
  assert.equal(lensApplies(correctness, docsOnly), true);
  assert.equal(lensApplies(security, docsOnly), true);
  assert.equal(lensApplies(designFit, docsOnly), true);
  assert.equal(lensApplies(testAdequacy, docsOnly), false);

  // A pure-markdown docs PR that does NOT touch docs/design still runs security
  // (wildcard) but skips design-fit + test-adequacy.
  const plainDocs = ["docs/tasks/active/x-todo.md", "CHANGELOG.md"];
  assert.equal(lensApplies(correctness, plainDocs), true);
  assert.equal(lensApplies(security, plainDocs), true);
  assert.equal(lensApplies(designFit, plainDocs), false);
  assert.equal(lensApplies(testAdequacy, plainDocs), false);

  // A root-level supply-chain change (root package.json + lockfile) must run
  // the security gate.
  const rootSupplyChain = ["package.json", "pnpm-lock.yaml"];
  assert.equal(lensApplies(security, rootSupplyChain), true);

  // A code PR runs every lens.
  const code = ["packages/sheets/src/index.ts"];
  for (const lens of [correctness, security, designFit, testAdequacy]) {
    assert.equal(lensApplies(lens, code), true);
  }

  // A workflow/harness PR: security applies, test-adequacy does not.
  const workflow = [".github/workflows/agent-implement.yml"];
  assert.equal(lensApplies(security, workflow), true);
  assert.equal(lensApplies(testAdequacy, workflow), false);

  // blast-radius shares test-adequacy's code scope: out-of-diff impact is a
  // property of CODE, so a docs-only change has none to find.
  const blastRadius = lensOf("blast-radius");
  assert.equal(lensApplies(blastRadius, code), true);
  assert.equal(lensApplies(blastRadius, docsOnly), false);
  assert.equal(lensApplies(blastRadius, plainDocs), false);
  // Deliberately NOT scoped to workflows yet — see the task doc. Asserted so the
  // choice is visible rather than incidental, and so extending it is a conscious
  // edit to this line.
  assert.equal(lensApplies(blastRadius, workflow), false);
});

// The out-of-diff mandate added to correctness + security. The motivating bug —
// a new read-only guard with `EditorAPI.paste()` reaching the same mutation
// around it — was passed twice by both lenses because the bypassing line was
// never in the diff. blast-radius owns this in general; these two carry the
// obligation for guards in their own lane, and losing it would silently restore
// diff-only review.
test("correctness + security carry the out-of-diff call-site mandate", () => {
  for (const id of ["correctness", "security"]) {
    const md = readFileSync(path.join(HERE, "lenses", `${id}.md`), "utf8");
    assert.match(md, /diff is where the change is, not where the bug is/i, `${id}.md lost the mandate`);
    assert.match(md, /Grep\/Glob/, `${id}.md must name the tool that leaves the diff`);
    assert.match(md, /call sites?/i, `${id}.md must ask for other call sites`);
    assert.match(md, /file:line/, `${id}.md must require a cited bypassing site`);
  }
});

// blast-radius is defined by its METHOD, not just its lane: if it does not leave
// the diff it is a worse copy of the correctness lens, and the one bug class it
// exists for is invisible from the diff alone.
test("the blast-radius rubric mandates leaving the diff", () => {
  const md = readFileSync(path.join(HERE, "lenses", "blast-radius.md"), "utf8");
  assert.match(md, /Grep/, "must instruct the lens to grep");
  assert.match(md, /every other reference/i, "must ask for references outside the diff");
  assert.match(md, /If you finish without running `Grep`/, "must state the method is mandatory");
  // Its lane is bounded, or it duplicates the other four and doubles the noise.
  assert.match(md, /NOT your lane/, "must defer the other lenses' concerns");
  assert.match(md, /correctness lens/i);
  assert.match(md, /security lens/i);
});

// The safety property that makes path-scoping survivable, asserted against the
// real manifest rather than left as a comment on one lens.
//
// agent-review-panel.yml builds `required_checks` from the BLOCKING lenses that
// APPLY to the diff, and mark-ready.mjs refuses to promote on an empty required
// set (exit 2) — `[].every` is vacuously true, so an empty set would satisfy the
// review gate with zero evidence. If every lens were narrowly scoped, a PR
// touching only an unscoped path (LICENSE, .gitignore, a root dotfile) would
// produce no required checks at all and dead-end the pipeline. At least one
// blocking lens must therefore match ANY possible changed-file set.
test("lens manifest: some blocking lens applies to every possible diff", () => {
  const blocking = LENSES.filter((l) => String(l.gating ?? "blocking") === "blocking");
  assert.ok(blocking.length > 0, "manifest has no blocking lenses");

  const alwaysOn = blocking.filter((l) => {
    const globs = l.appliesWhen ?? ["**"];
    return globs.length === 0 || globs.includes("**");
  });
  assert.ok(
    alwaysOn.length > 0,
    "every blocking lens is path-scoped: a diff matching none of them yields an " +
      "empty required-check set, which mark-ready.mjs rejects (exit 2). Keep at " +
      "least one blocking lens at '**'.",
  );

  // Spot-check the property on paths no scoped lens claims.
  for (const unclaimed of [["LICENSE"], [".gitignore"], ["README.md"], []]) {
    assert.ok(
      blocking.some((l) => lensApplies(l, unclaimed)),
      `no blocking lens applies to ${JSON.stringify(unclaimed)}`,
    );
  }
});

test("coerceFindings: malformed findings are KEPT and block (never silently dropped)", () => {
  // a critical finding with a non-string summary must still block, not vanish
  assert.equal(classify(coerceFindings([{ severity: "critical", summary: {} }])).conclusion, "failure");
  assert.equal(classify(coerceFindings([{ severity: "critical", summary: null }])).conclusion, "failure");
  // non-object entries → synthetic blocking findings
  assert.equal(classify(coerceFindings([null, 42, "x"])).conclusion, "failure");
  // a non-array lens output → one synthetic blocking finding (not an empty pass)
  const na = coerceFindings("not an array");
  assert.equal(na.length, 1);
  assert.equal(classify(na).conclusion, "failure");
  // well-formed non-blocking findings pass through untouched
  const clean = coerceFindings([{ severity: "nit", file: "a.ts", summary: "style" }]);
  assert.deepEqual(clean, [{ severity: "nit", file: "a.ts", summary: "style" }]);
  assert.equal(classify(clean).conclusion, "success");
});

test("dedupeFindings: by file + case-insensitive summary", () => {
  const out = dedupeFindings([
    { file: "a.ts", summary: "Bug X" },
    { file: "a.ts", summary: "bug x" },
    { file: "b.ts", summary: "Bug X" },
  ]);
  assert.equal(out.length, 2);
});

test("dedupeFindings: a collision keeps the HIGHEST severity, order-independent", () => {
  const nit = { severity: "nit", file: "a.ts", summary: "same text" };
  const crit = { severity: "critical", file: "a.ts", summary: "same text" };
  // whichever order they arrive in, the critical must survive the collision
  assert.equal(dedupeFindings([nit, crit])[0].severity, "critical");
  assert.equal(dedupeFindings([crit, nit])[0].severity, "critical");
  assert.equal(dedupeFindings([nit, crit]).length, 1);
});

// Regression: the fail-open the reviewer found — main() is the ONLY place
// coerceFindings and dedupeFindings compose, so test the composition, not the
// helpers in isolation. A colliding critical must not be masked by a nit.
test("coerceFindings + dedupeFindings (main pipeline): a critical is never masked", () => {
  const pipeline = (raw) => classify(dedupeFindings(coerceFindings(raw)));
  // malformed path: coercion rewrites both summaries to the same placeholder
  assert.equal(pipeline([{ severity: "nit", summary: {} }, { severity: "critical", summary: {} }]).conclusion, "failure");
  // well-formed path: same file+summary at two severities (ordinary model output)
  assert.equal(
    pipeline([
      { severity: "nit", file: "a.ts", summary: "Unvalidated input on the auth path" },
      { severity: "critical", file: "a.ts", summary: "Unvalidated input on the auth path" },
    ]).conclusion,
    "failure",
  );
});

test("unionSamples: union across N samples; recall gained, dups collapse fail-toward-blocking", () => {
  // Part 1: sample A finds X; sample B finds X (same) + Y (new) → union {X, Y}.
  const a = { findings: [{ severity: "major", file: "a.ts", summary: "X" }] };
  const b = { findings: [{ severity: "major", file: "a.ts", summary: "X" }, { severity: "critical", file: "b.ts", summary: "Y" }] };
  const u = unionSamples([a, b]);
  assert.equal(u.length, 2); // X deduped, Y added (recall from sampling)
  assert.ok(u.some((f) => f.summary === "Y" && f.severity === "critical"));
  // same finding at two severities across samples → highest wins (fail toward blocking)
  const s1 = { findings: [{ severity: "nit", file: "a.ts", summary: "Z" }] };
  const s2 = { findings: [{ severity: "critical", file: "a.ts", summary: "Z" }] };
  const uz = unionSamples([s1, s2]);
  assert.equal(uz.length, 1);
  assert.equal(uz[0].severity, "critical");
  // failed samples (null / {__error}) contribute nothing; a well-formed one still counts
  assert.equal(unionSamples([null, { __error: "boom" }, a]).length, 1);
  assert.equal(unionSamples([]).length, 0);
  // a MALFORMED successful sample (findings not an array, or missing) must fail
  // toward blocking via coerceFindings — never be dropped into a clean verdict
  assert.equal(classify(unionSamples([{ summary: "x", findings: "oops" }])).conclusion, "failure");
  assert.equal(classify(unionSamples([{ summary: "x" }])).conclusion, "failure");
  // a legitimately empty sample (findings: []) contributes nothing (not blocking)
  assert.equal(unionSamples([{ findings: [] }]).length, 0);
});

test("parsePriorFindings: tolerant — valid array round-trips, junk → []", () => {
  const recs = [{ lens: "correctness", severity: "major", file: "a.ts", summary: "prior" }];
  assert.deepEqual(parsePriorFindings(JSON.stringify(recs)), recs);
  assert.deepEqual(parsePriorFindings(""), []);
  assert.deepEqual(parsePriorFindings("not json"), []);
  assert.deepEqual(parsePriorFindings('{"not":"an array"}'), []);
  // non-object entries are dropped
  assert.deepEqual(parsePriorFindings('[null, 3, {"severity":"major","summary":"ok"}]'), [{ severity: "major", summary: "ok" }]);
});

// Part 2: a prior blocking finding that this round's fresh pass MISSED must
// still block after being re-checked (verifier didn't refute it) and merged.
// This is the #521 false-negative, guarded at the composition level.
test("cross-round merge: an unresolved prior finding the fresh pass missed still blocks", () => {
  const freshKept = []; // this round's lens returned nothing (missed it)
  const priorForLens = [{ lens: "correctness", severity: "major", file: "s.ts", summary: "MIN/MAX all-blank returns #NUM!" }];
  // re-check couldn't refute it (null verdict = kept, biased-to-block)
  const priorKept = applyVerifications(priorForLens, [null]);
  const merged = dedupeFindings([...freshKept, ...priorKept]);
  assert.equal(merged.length, 1);
  assert.equal(classify(merged).conclusion, "failure");
  // but if the re-check refutes it on grounded evidence (genuinely resolved) → dropped
  const resolved = applyVerifications(priorForLens, [
    { verdict: "refuted", confidence: "high", refutationGround: "not-present", groundedIn: ["s.ts:88"] },
  ]);
  assert.equal(classify(dedupeFindings([...freshKept, ...resolved])).conclusion, "success");
});

test("compareSampleAgreement: identical/partial/disjoint/single classification", () => {
  const x = [{ file: "a.ts", summary: "X" }];
  const y = [{ file: "b.ts", summary: "Y" }];
  // fewer than 2 samples → nothing to compare (covers the all-failed case too)
  assert.equal(compareSampleAgreement([]), "single");
  assert.equal(compareSampleAgreement([x]), "single");
  // same finding set (including both empty) → identical
  assert.equal(compareSampleAgreement([x, x]), "identical");
  assert.equal(compareSampleAgreement([[], []]), "identical");
  // zero overlap between every pair → disjoint
  assert.equal(compareSampleAgreement([x, y]), "disjoint");
  // some but not total overlap → partial
  assert.equal(compareSampleAgreement([x, [...x, ...y]]), "partial");
  assert.equal(compareSampleAgreement([x, y, [...x, ...y]]), "partial");
  // case/whitespace-insensitive key, same as dedupeFindings
  assert.equal(compareSampleAgreement([[{ file: "a.ts", summary: "X" }], [{ file: "a.ts", summary: " x " }]]), "identical");
  // a malformed sample still keys consistently via coerceFindings
  assert.equal(compareSampleAgreement(["not an array", "not an array"]), "identical");
});

test("severityCounts: tallies by normalized severity, unknown → major", () => {
  assert.deepEqual(severityCounts([]), { critical: 0, major: 0, minor: 0, nit: 0 });
  assert.deepEqual(
    severityCounts([{ severity: "critical" }, { severity: "critical" }, { severity: "minor" }, { severity: "weird" }]),
    { critical: 2, major: 1, minor: 1, nit: 0 },
  );
  assert.deepEqual(severityCounts("not an array"), { critical: 0, major: 0, minor: 0, nit: 0 });
  // Severity and confidence are independent axes. A low-confidence critical is
  // still a critical — if confidence ever starts influencing this count, the
  // clamp the coverage-first rubrics removed has grown back inside the script.
  assert.deepEqual(
    severityCounts([
      { severity: "critical", confidence: "low" },
      { severity: "critical", confidence: "high" },
      { severity: "major", confidence: "low" },
    ]),
    { critical: 2, major: 1, minor: 0, nit: 0 },
  );
});

test("confidenceCounts: buckets by confidence; anything unrated → unknown", () => {
  assert.deepEqual(confidenceCounts([]), { high: 0, medium: 0, low: 0, unknown: 0 });
  assert.deepEqual(
    confidenceCounts([{ confidence: "high" }, { confidence: "low" }, { confidence: "low" }, { confidence: "medium" }]),
    { high: 1, medium: 1, low: 2, unknown: 0 },
  );
  // Unrated does NOT get coerced into a real bucket the way severity does. A
  // lens that stops emitting confidence must show up as `unknown`, because that
  // is the signal that it is back to expressing doubt through severity.
  assert.deepEqual(
    confidenceCounts([{ severity: "major" }, { confidence: "wat" }, { confidence: 7 }, { confidence: null }]),
    { high: 0, medium: 0, low: 0, unknown: 4 },
  );
  // "unknown" is not a value a lens can claim — it means "not rated"
  assert.deepEqual(confidenceCounts([{ confidence: "unknown" }]), { high: 0, medium: 0, low: 0, unknown: 1 });
  // REGRESSION: an `in` check walks the prototype chain, so these matched,
  // incremented an inherited property, and left an extra key on the result —
  // while also NOT counting the finding under `unknown`. Both must hold: the
  // shape is exactly four keys, and nothing goes uncounted.
  for (const proto of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
    const out = confidenceCounts([{ confidence: proto }]);
    assert.deepEqual(out, { high: 0, medium: 0, low: 0, unknown: 1 }, `"${proto}" must count as unknown`);
    assert.deepEqual(Object.keys(out), ["high", "medium", "low", "unknown"], `"${proto}" added a key`);
  }
  // junk input never throws
  for (const bad of ["not an array", null, undefined, 7, {}]) {
    assert.deepEqual(confidenceCounts(bad), { high: 0, medium: 0, low: 0, unknown: 0 });
  }
  assert.deepEqual(confidenceCounts([null, 7, "x"]), { high: 0, medium: 0, low: 0, unknown: 3 });
});

// Read the REAL rubrics, same reasoning as the manifest above: these files ARE
// the behaviour, and a clamp re-added by hand is invisible to every other test.
//
// Phrases that make a lens investigate thoroughly and then decline to report —
// the documented failure mode this whole change exists to remove.
const CLAMPS = [
  /when unsure,?\s+downgrade/i,
  /mark it minor/i,
  /only with (?:a )?concrete/i,
  /ONLY for a\s+concrete/i,
  /severity ONLY/i,
];
const assertNoClamp = (text, where) => {
  for (const clamp of CLAMPS) {
    assert.ok(!clamp.test(text), `${where} re-introduces a certainty clamp: ${clamp}`);
  }
};

test("lens rubrics are coverage-first, with no certainty clamp", () => {
  const RUBRICS = ["correctness", "security", "design-fit", "test-adequacy", "blast-radius"];
  for (const id of RUBRICS) {
    const md = readFileSync(path.join(HERE, "lenses", `${id}.md`), "utf8");
    assertNoClamp(md, `${id}.md`);
    assert.match(md, /Report EVERY issue you find/, `${id}.md must instruct coverage-first`);
    assert.match(md, /[Nn]ever downgrade\s+severity/, `${id}.md must separate severity from doubt`);
    assert.match(md, /confidence/i, `${id}.md must tell the lens what confidence is for`);
  }
  // Every rubric in the manifest is covered by the loop above — otherwise a new
  // lens could ship with a clamp and nothing here would notice.
  assert.deepEqual(LENSES.map((l) => l.id).sort(), [...RUBRICS].sort());
});

// The rubrics are only half the prompt. `runLens` appends this block AFTER the
// rubric and the diff, so it is the last thing the lens reads and wins ties —
// and it is where the real clamp was hiding, in the one place nobody editing a
// rubric would look. Guarding the .md files alone would leave that reachable.
test("the runLens closing instruction is coverage-first too", () => {
  assertNoClamp(LENS_CLOSING_INSTRUCTION, "LENS_CLOSING_INSTRUCTION");
  assert.match(LENS_CLOSING_INSTRUCTION, /Report EVERY issue you find/);
  assert.match(LENS_CLOSING_INSTRUCTION, /never lower severity to signal doubt/);
  // ...but the KIND rule stays: taste is minor/nit no matter how sure you are.
  // That is not a certainty clamp, and losing it would let preferences block.
  assert.match(LENS_CLOSING_INSTRUCTION, /[Tt]aste[\s\S]*minor\/nit/);
  // It must actually reach the prompt. An exported constant nothing appends is
  // a guard over dead text — the exact failure this test exists to prevent.
  const src = readFileSync(path.join(HERE, "review-panel.mjs"), "utf8");
  assert.match(src, /parts\.push\(\s*""\s*,\s*LENS_CLOSING_INSTRUCTION\s*\)/,
    "runLens must append LENS_CLOSING_INSTRUCTION, or this guard covers nothing");
});

test("verifierTally: only blocking findings are sent; refuted vs high-confidence vs dropped", () => {
  const findings = [
    { severity: "critical", summary: "c" },
    { severity: "major", summary: "m" },
    { severity: "minor", summary: "n" }, // never sent to the verifier
  ];
  const verdicts = [{ verdict: "refuted", confidence: "high" }, { verdict: "refuted", confidence: "low" }, null];
  // the high-confidence refute is UNGROUNDED, so it is counted but not dropped —
  // this gap is the whole point of reporting both numbers.
  assert.deepEqual(verifierTally(findings, verdicts), { sentToVerifier: 2, refuted: 2, refutedHighConfidence: 1, dropped: 0 });
  // the same shape WITH a ground and a citation does drop
  assert.deepEqual(
    verifierTally(findings, [GROUNDED_REFUTE, { verdict: "refuted", confidence: "low" }, null]),
    { sentToVerifier: 2, refuted: 2, refutedHighConfidence: 1, dropped: 1 },
  );
  // confirmed / null verdicts: sent but not refuted
  assert.deepEqual(
    verifierTally(findings, [{ verdict: "confirmed", confidence: "high" }, null, null]),
    { sentToVerifier: 2, refuted: 0, refutedHighConfidence: 0, dropped: 0 },
  );
  assert.deepEqual(verifierTally([], []), { sentToVerifier: 0, refuted: 0, refutedHighConfidence: 0, dropped: 0 });
  // a dropping verdict on a NON-blocking finding is not counted: it was never
  // sent, and applyVerifications would not have acted on it either.
  assert.deepEqual(
    verifierTally([{ severity: "minor", summary: "n" }], [GROUNDED_REFUTE]),
    { sentToVerifier: 0, refuted: 0, refutedHighConfidence: 0, dropped: 0 },
  );
});

/** The one verdict shape that is allowed to drop a finding. */
const GROUNDED_REFUTE = {
  verdict: "refuted",
  confidence: "high",
  refutationGround: "not-present",
  groundedIn: ["src/a.ts:42"],
};

test("isDroppingVerdict: drops only on the complete grounded shape", () => {
  assert.ok(isDroppingVerdict(GROUNDED_REFUTE));
  // REGRESSION GUARD. This exact shape used to drop the finding. Under the
  // grounded rule it must NOT: a confident assertion with no ground named and
  // nothing cited is precisely what the gate stopped acting on. If this ever
  // goes green again, the grounding requirement has been silently reverted.
  assert.equal(isDroppingVerdict({ verdict: "refuted", confidence: "high" }), false);
  // each piece of the shape removed in turn → keeps
  const without = (k) => { const v = { ...GROUNDED_REFUTE }; delete v[k]; return v; };
  for (const k of ["verdict", "confidence", "refutationGround", "groundedIn"]) {
    assert.equal(isDroppingVerdict(without(k)), false, `missing ${k} must keep the finding`);
  }
  // wrong values for each field → keeps
  assert.equal(isDroppingVerdict({ ...GROUNDED_REFUTE, verdict: "confirmed" }), false);
  assert.equal(isDroppingVerdict({ ...GROUNDED_REFUTE, confidence: "low" }), false);
  // `none` is a legal enum value meaning "I am not refuting" — never drops
  assert.equal(isDroppingVerdict({ ...GROUNDED_REFUTE, refutationGround: "none" }), false);
  // a ground outside the enum is not a ground (guards a model inventing one)
  assert.equal(isDroppingVerdict({ ...GROUNDED_REFUTE, refutationGround: "looks-fine" }), false);
  assert.equal(isDroppingVerdict({ ...GROUNDED_REFUTE, refutationGround: 1 }), false);
  // citations that cite nothing → keeps
  assert.equal(isDroppingVerdict({ ...GROUNDED_REFUTE, groundedIn: [] }), false);
  assert.equal(isDroppingVerdict({ ...GROUNDED_REFUTE, groundedIn: ["", "   "] }), false);
  assert.equal(isDroppingVerdict({ ...GROUNDED_REFUTE, groundedIn: [null, 7] }), false);
  assert.equal(isDroppingVerdict({ ...GROUNDED_REFUTE, groundedIn: "src/a.ts:42" }), false);
  // one usable citation among junk is enough
  assert.ok(isDroppingVerdict({ ...GROUNDED_REFUTE, groundedIn: ["", "src/a.ts:42"] }));
  // junk input never throws
  for (const v of [null, undefined, 0, "", "refuted", [], {}]) {
    assert.equal(isDroppingVerdict(v), false);
  }
});

test("isDroppingVerdict: a citation must locate something, not just be non-empty", () => {
  const cite = (...groundedIn) => isDroppingVerdict({ ...GROUNDED_REFUTE, groundedIn });
  // prose is not a citation, however confident — this is the unevidenced
  // assertion the grounding rule exists to reject, wearing a citation's costume.
  for (const junk of ["looks fine", "I checked it", "the guard is there", "n/a", "-", "42", "src/a.ts"]) {
    assert.equal(cite(junk), false, `"${junk}" must not count as a citation`);
  }
  // real locations, including ranges and prose wrapped around one
  for (const ok of [
    "src/a.ts:42",
    "packages/docs/src/editor-api.ts:214-220",
    "scripts/agent/review-panel.mjs:172",
    "see review-panel.mjs:172 for the guard",
    "a.ts:1",
  ]) {
    assert.ok(cite(ok), `"${ok}" must count as a citation`);
  }
});

test("isDroppingVerdict: `pre-existing` needs an authoritative changed-file list", () => {
  const preExisting = { ...GROUNDED_REFUTE, refutationGround: "pre-existing" };
  // The prompt withdraws this ground when the list is not authoritative, but a
  // prompt instruction the script does not check is not a rule — so the trusted
  // code refuses it too. Without this the whole changed-file trust story is
  // advisory, and a model ignoring the instruction drops a real finding.
  assert.equal(isDroppingVerdict(preExisting, { allowPreExisting: false }), false);
  assert.ok(isDroppingVerdict(preExisting, { allowPreExisting: true }));
  // DEFAULT is the strict one: a caller that forgets to thread the flag gets the
  // keep-the-finding behaviour, like every other default on this path.
  assert.equal(isDroppingVerdict(preExisting), false);
  assert.equal(isDroppingVerdict(preExisting, {}), false);
  // the flag is scoped to `pre-existing` — it must not gate the other grounds
  for (const g of ["not-present", "already-guarded", "out-of-scope"]) {
    assert.ok(isDroppingVerdict({ ...GROUNDED_REFUTE, refutationGround: g }, { allowPreExisting: false }));
  }
  // ...and it never RELAXES anything else: an ungrounded pre-existing still keeps
  assert.equal(
    isDroppingVerdict({ verdict: "refuted", confidence: "high", refutationGround: "pre-existing" },
      { allowPreExisting: true }),
    false,
  );
});

test("applyVerifications / verifierTally thread the pre-existing trust flag", () => {
  const F = [{ severity: "major", summary: "m" }];
  const V = [{ ...GROUNDED_REFUTE, refutationGround: "pre-existing" }];
  assert.equal(applyVerifications(F, V, { allowPreExisting: true }).length, 0, "dropped when trusted");
  assert.equal(applyVerifications(F, V, { allowPreExisting: false }).length, 1, "kept when not");
  assert.equal(applyVerifications(F, V).length, 1, "kept by default");
  // the tally must agree with the gate, or `dropped` reports a decision that
  // was never made
  assert.equal(verifierTally(F, V, { allowPreExisting: true }).dropped, 1);
  assert.equal(verifierTally(F, V, { allowPreExisting: false }).dropped, 0);
  assert.equal(verifierTally(F, V).dropped, 0);
});

test("changedFileContext: only a complete list is authoritative", () => {
  assert.deepEqual(changedFileContext(["a.ts", "b.ts"], 5), {
    authoritative: true, listed: ["a.ts", "b.ts"], total: 2,
  });
  // a full-length list is still complete — the cap is inclusive
  assert.equal(changedFileContext(["a", "b"], 2).authoritative, true);
  // ONE over the cap withdraws authority: an absent path would otherwise read as
  // "the PR didn't touch it" when it was merely truncated off (the fail-open).
  const over = changedFileContext(["a", "b", "c"], 2);
  assert.equal(over.authoritative, false);
  assert.deepEqual(over.listed, ["a", "b"]);
  assert.equal(over.total, 3, "total reports the true count, not the listed count");
  // empty / malformed → not authoritative, never throws
  for (const bad of [[], null, undefined, "a.ts", 7, {}, [null, 7, "", "   "]]) {
    const c = changedFileContext(bad, 5);
    assert.equal(c.authoritative, false);
    assert.deepEqual(c.listed, []);
    assert.equal(c.total, 0);
  }
  // A single junk entry alongside real ones costs authority, for the same reason
  // truncation does: the verifier would be handed a list missing a path it
  // cannot see is missing — indistinguishable, from inside the prompt, from a
  // file the PR genuinely did not touch. Junk still leaves `listed` clean.
  const mixed = changedFileContext(["", null, "a.ts", 7], 5);
  assert.deepEqual(mixed.listed, ["a.ts"]);
  assert.equal(mixed.authoritative, false, "a dropped entry must cost authority");
});

test("applyVerifications: drops ONLY on a grounded refute; keeps on any doubt", () => {
  const F = [{ severity: "critical", summary: "c" }, { severity: "major", summary: "m" }, { severity: "minor", summary: "n" }];
  const keptSummaries = (verdicts) => applyVerifications(F, verdicts).map((f) => f.summary);
  // grounded high-confidence refute → dropped
  assert.ok(!keptSummaries([GROUNDED_REFUTE, null, null]).includes("c"));
  // ungrounded high-confidence refute → KEPT (the old dropping shape)
  assert.ok(keptSummaries([{ verdict: "refuted", confidence: "high" }, null, null]).includes("c"));
  // low-confidence refute, even grounded → KEPT (uncertainty)
  assert.ok(keptSummaries([{ ...GROUNDED_REFUTE, confidence: "low" }, null, null]).includes("c"));
  // confirmed → kept
  assert.ok(keptSummaries([{ verdict: "confirmed", confidence: "high" }, null, null]).includes("c"));
  // null (verifier error) → kept
  assert.ok(keptSummaries([null, null, null]).includes("c"));
  // malformed (no confidence) → kept
  assert.ok(keptSummaries([{ verdict: "refuted" }, null, null]).includes("c"));
  // non-blocking (minor) is never verified/dropped
  assert.ok(keptSummaries([null, null, GROUNDED_REFUTE]).includes("n"));
});

test("classifyResult: success with structured output → ok", () => {
  const c = classifyResult({ type: "result", subtype: "success", structured_output: { findings: [], summary: "ok" } });
  assert.equal(c.ok, true);
  assert.deepEqual(c.output, { findings: [], summary: "ok" });
});

test("classifyResult: the exact #548 session-limit 429 → api-error, NOT retryable", () => {
  // Captured verbatim from the review-panel execution artifact.
  const msg = {
    type: "result", subtype: "success", is_error: true, api_error_status: 429,
    result: "You've hit your session limit · resets 3:30pm (UTC)",
    terminal_reason: "api_error", usage: { input_tokens: 0, output_tokens: 0 },
  };
  const c = classifyResult(msg);
  assert.equal(c.ok, false);
  assert.equal(c.kind, "api-error");
  assert.equal(c.status, 429);
  assert.equal(c.retryable, false); // session-limit resets hours out — no in-run retry
  assert.match(c.detail, /session limit/);
});

test("classifyResult: transient API errors → api-error, retryable", () => {
  assert.equal(classifyResult({ subtype: "success", is_error: true, api_error_status: 529, result: "overloaded_error" }).retryable, true);
  assert.equal(classifyResult({ subtype: "error", is_error: true, api_error_status: 500, result: "internal error" }).retryable, true);
  assert.equal(classifyResult({ terminal_reason: "api_error", result: "fetch failed" }).retryable, true);
});

test("classifyResult: success but no structured output → no-output, not retryable", () => {
  const c = classifyResult({ type: "result", subtype: "success" });
  assert.equal(c.kind, "no-output");
  assert.equal(c.retryable, false);
});

test("withRetry: retries retryable errors, gives up after cap, never retries non-retryable", async () => {
  const noSleep = { sleep: async () => {}, baseMs: 1 };
  // succeeds after 2 transient failures
  let n = 0;
  const okAfter2 = await withRetry(async () => {
    if (n++ < 2) { const e = new Error("transient"); e.retryable = true; throw e; }
    return "done";
  }, noSleep);
  assert.equal(okAfter2, "done");
  assert.equal(n, 3);
  // gives up after retries+1 attempts on a persistently-retryable error
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; const e = new Error("x"); e.retryable = true; throw e; }, { ...noSleep, retries: 2 }));
  assert.equal(calls, 3); // 1 + 2 retries
  // a non-retryable error throws immediately (no retry)
  let once = 0;
  await assert.rejects(withRetry(async () => { once++; const e = new Error("quota"); e.retryable = false; throw e; }, noSleep));
  assert.equal(once, 1);
});
