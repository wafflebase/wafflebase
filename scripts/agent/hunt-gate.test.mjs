import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFilingVerdict,
  dropReason,
  refutationDefects,
  huntSeverity,
  coerceCandidates,
  dedupeCandidates,
  codeLocations,
  citationPath,
  citationInScope,
  HUNT_GROUNDS,
  HUNT_VERIFIER_SCHEMA,
  EXPLORER_SCHEMA,
  UI_GROUNDS,
  UI_VERIFIER_SCHEMA,
  UI_EXPLORER_SCHEMA,
  SHARED_GROUNDS,
} from "./hunt-gate.mjs";
import { normalizeSeverity } from "./severity.mjs";

// A fail-quiet gate is characterised by what it REFUSES, so this suite is mostly
// negative. The one positive case exists to prove the negatives aren't passing
// because everything fails.

const CHARTER = {
  id: "contract",
  oracles: ["contract"],
  reportableSeverities: ["critical", "major"],
  verifiers: 2,
  minCitations: 2,
  requiresDocCitation: true,
  codeScope: ["packages/cli/src/**"],
  docsScope: ["packages/cli/README.md", "docs/design/cli.md"],
};

const confirmed = (over = {}) => ({
  verdict: "confirmed",
  confidence: "high",
  reason: "doc says 2, code sets 1",
  confirmationGround: "doc-contradicts-code",
  groundedIn: ["packages/cli/src/output/formatter.ts:39"],
  duplicateOf: null,
  ...over,
});

const candidate = (over = {}) => ({
  replay: { status: "reproduced", deterministic: true },
  claimed: {
    oracle: "contract",
    severity: "major",
    title: "exit code contract unimplemented",
    expected: "exit 2 for a system error, per docs/design/cli.md:691",
    observed: "always exits 1",
    citations: ["packages/cli/src/output/formatter.ts:39", "docs/design/cli.md:691"],
    docCitation: "docs/design/cli.md:691",
    ...(over.claimed ?? {}),
  },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "claimed")),
});

// --- the one way through ----------------------------------------------------

test("isFilingVerdict: a fully-evidenced candidate reports", () => {
  assert.equal(isFilingVerdict(candidate(), [confirmed(), confirmed()], CHARTER), true);
  assert.equal(dropReason(candidate(), [confirmed(), confirmed()], CHARTER), null);
});

// --- stage 1: replay (trusted) ----------------------------------------------

test("isFilingVerdict: drops anything the replay did not confirm", () => {
  const v = [confirmed(), confirmed()];
  assert.equal(isFilingVerdict(candidate({ replay: undefined }), v, CHARTER), false);
  assert.equal(isFilingVerdict(candidate({ replay: null }), v, CHARTER), false);
  assert.equal(isFilingVerdict(candidate({ replay: { status: "not-reproduced", deterministic: true } }), v, CHARTER), false);
  assert.equal(isFilingVerdict(candidate({ replay: { status: "non-deterministic", deterministic: false } }), v, CHARTER), false);
  // Reproduced but flaky is still a drop: an intermittent result cannot be told
  // apart from an environment artifact.
  assert.equal(isFilingVerdict(candidate({ replay: { status: "reproduced", deterministic: false } }), v, CHARTER), false);
});

// --- stage 2: charter conformance (trusted) ---------------------------------

test("isFilingVerdict: drops an oracle the charter does not own", () => {
  const c = candidate({ claimed: { oracle: "crash" } });
  assert.equal(isFilingVerdict(c, [confirmed(), confirmed()], CHARTER), false);
});

test("isFilingVerdict: drops severities below the charter's bar", () => {
  for (const severity of ["minor", "nit"]) {
    assert.equal(isFilingVerdict(candidate({ claimed: { severity } }), [confirmed(), confirmed()], CHARTER), false, severity);
  }
});

test("REGRESSION: a garbled severity DROPS here, where the panel would report it", () => {
  // The single most likely way this gate could be broken: someone "simplifies"
  // huntSeverity into review-panel's normalizeSeverity. That maps unknown →
  // "major", which is reportable, so every garbled severity would become a
  // report. Asserting BOTH halves writes the contrast down so a future refactor
  // that reintroduces normalizeSeverity on this path fails loudly.
  for (const bad of ["MAJOR ", "blocker", "Major", "", undefined, null, 3, {}]) {
    assert.equal(huntSeverity(bad), null, `huntSeverity(${JSON.stringify(bad)}) must be null`);
    assert.equal(
      isFilingVerdict(candidate({ claimed: { severity: bad } }), [confirmed(), confirmed()], CHARTER),
      false,
      `severity ${JSON.stringify(bad)} must not report`,
    );
    // ...and this is what the panel's helper would have done with it.
    assert.equal(normalizeSeverity(bad), "major");
  }
});

// --- stage 3: verifier unanimity (checked) ----------------------------------

test("isFilingVerdict: needs at least the charter's verifier count", () => {
  assert.equal(isFilingVerdict(candidate(), [confirmed()], CHARTER), false, "1 of 2");
  assert.equal(isFilingVerdict(candidate(), [], CHARTER), false, "none");
  assert.equal(isFilingVerdict(candidate(), null, CHARTER), false, "not an array");
  // A charter asking for fewer than 2 is floored at 2 — a single verifier is not
  // a panel, and one confabulation would be enough.
  assert.equal(isFilingVerdict(candidate(), [confirmed()], { ...CHARTER, verifiers: 1 }), false);
});

test("isFilingVerdict: ONE dissenting or unusable verdict is enough to drop", () => {
  const cases = [
    ["refuted", confirmed({ verdict: "refuted" })],
    ["low confidence", confirmed({ confidence: "low" })],
    ["ground 'none'", confirmed({ confirmationGround: "none" })],
    ["unknown ground", confirmed({ confirmationGround: "vibes" })],
    ["duplicate", confirmed({ duplicateOf: "#274" })],
    ["no ground field", confirmed({ confirmationGround: undefined })],
  ];
  for (const [label, bad] of cases) {
    assert.equal(isFilingVerdict(candidate(), [confirmed(), bad], CHARTER), false, label);
    assert.equal(isFilingVerdict(candidate(), [bad, confirmed()], CHARTER), false, `${label} (first position)`);
  }
});

test("REGRESSION: a null/errored verdict DROPS, the inverse of the panel", () => {
  // review-panel.mjs's keepUnrefuted discards a finding only on a concrete
  // refutation, so a verdict that never arrived KEEPS it (a crashed verifier must
  // not silently clear a finding). Here it must DROP: a
  // crashed verifier produced no evidence, and no evidence cannot become a
  // report. A reviewer skimming for symmetry with the panel will read this as
  // inverted logic — it is inverted on purpose.
  for (const bad of [null, undefined, "confirmed", 1, {}]) {
    assert.equal(isFilingVerdict(candidate(), [confirmed(), bad], CHARTER), false, JSON.stringify(bad));
  }
});

// --- stage 4: citations (checked) -------------------------------------------

test("isFilingVerdict: citations must locate a line, meet the count, and be in scope", () => {
  const v = [confirmed(), confirmed()];
  // Too few.
  assert.equal(isFilingVerdict(candidate({ claimed: { citations: ["packages/cli/src/output/formatter.ts:39"] } }), v, CHARTER), false);
  // Right count, but neither locates a line.
  assert.equal(isFilingVerdict(candidate({ claimed: { citations: ["looks fine", "packages/cli/src/x.ts"] } }), v, CHARTER), false);
  // Locate lines, but outside codeScope.
  assert.equal(
    isFilingVerdict(candidate({ claimed: { citations: ["packages/sheets/src/a.ts:1", "packages/docs/src/b.ts:2"] } }), v, CHARTER),
    false,
  );
});

test("isFilingVerdict: a contract candidate needs BOTH sides of the contradiction", () => {
  const v = [confirmed(), confirmed()];
  assert.equal(isFilingVerdict(candidate({ claimed: { docCitation: undefined } }), v, CHARTER), false, "no doc citation");
  assert.equal(isFilingVerdict(candidate({ claimed: { docCitation: "the README" } }), v, CHARTER), false, "unlocatable");
  // A doc citation pointing at code is not a documented promise.
  assert.equal(
    isFilingVerdict(candidate({ claimed: { docCitation: "packages/cli/src/output/formatter.ts:39" } }), v, CHARTER),
    false,
    "doc citation outside docsScope",
  );
  // A crash charter needs only one citation and no doc side.
  const crash = { ...CHARTER, id: "crash", oracles: ["crash"], requiresDocCitation: false, minCitations: 1 };
  const c = candidate({ claimed: { oracle: "crash", citations: ["packages/cli/src/bin.ts:27"], docCitation: undefined } });
  assert.equal(isFilingVerdict(c, v, crash), true);
});

test("citationPath / citationInScope", () => {
  assert.equal(citationPath("packages/cli/src/bin.ts:27"), "packages/cli/src/bin.ts");
  assert.equal(citationPath("see packages/cli/src/bin.ts:27 for why"), "packages/cli/src/bin.ts");
  assert.equal(citationPath("packages/cli/src/bin.ts"), null, "no line number locates nothing");
  assert.equal(citationPath("looks fine"), null);
  assert.equal(citationPath(undefined), null);
  assert.ok(citationInScope("packages/cli/src/bin.ts:27", ["packages/cli/src/**"]));
  assert.ok(!citationInScope("packages/sheets/src/x.ts:1", ["packages/cli/src/**"]));
  // Fail quiet: a charter with no declared scope reports nothing, not everything.
  assert.ok(!citationInScope("packages/cli/src/bin.ts:27", []));
  assert.ok(!citationInScope("packages/cli/src/bin.ts:27", undefined));
});

// --- monotonicity -----------------------------------------------------------

test("isFilingVerdict: removing any single field never turns a drop into a report", () => {
  // The structural property of a fail-quiet gate: evidence can only ever be
  // subtracted toward a drop. Guards against a future `??` default that
  // accidentally supplies missing evidence.
  const base = candidate();
  for (const key of Object.keys(base.claimed)) {
    const claimed = { ...base.claimed };
    delete claimed[key];
    assert.equal(isFilingVerdict({ ...base, claimed }, [confirmed(), confirmed()], CHARTER), false, `claimed.${key}`);
  }
  for (const key of ["replay", "claimed"]) {
    const c = { ...base };
    delete c[key];
    assert.equal(isFilingVerdict(c, [confirmed(), confirmed()], CHARTER), false, key);
  }
});

test("dropReason: always agrees with isFilingVerdict about whether to report", () => {
  // dropReason re-derives its answer independently, so it can drift. Pin the
  // invariant rather than the wording.
  const cases = [
    [candidate(), [confirmed(), confirmed()]],
    [candidate({ replay: { status: "not-reproduced" } }), [confirmed(), confirmed()]],
    [candidate(), [confirmed()]],
    [candidate(), [confirmed(), confirmed({ duplicateOf: "#12" })]],
    [candidate({ claimed: { severity: "nit" } }), [confirmed(), confirmed()]],
    [candidate({ claimed: { citations: [] } }), [confirmed(), confirmed()]],
    [candidate(), [confirmed(), null]],
  ];
  for (const [c, v] of cases) {
    const reported = isFilingVerdict(c, v, CHARTER);
    const reason = dropReason(c, v, CHARTER);
    assert.equal(reported, reason === null, `disagreement: reported=${reported} reason=${JSON.stringify(reason)}`);
  }
});

// --- candidate hygiene ------------------------------------------------------

test("coerceCandidates: DROPS malformed input, the inverse of coerceFindings", () => {
  // coerceFindings turns junk into a synthetic BLOCKING finding, because the panel
  // must not lose a possible bug. Here junk must vanish: a candidate that cannot
  // be replayed must never be reported, and dropping costs nothing.
  const good = { title: "t", severity: "major", probes: [{ argv: ["--help"] }], failingIndex: 0 };
  const { kept, dropped } = coerceCandidates([
    good,
    null,
    "nope",
    { ...good, title: "" },
    { ...good, severity: "BLOCKER" },
    { ...good, probes: [] },
    { ...good, probes: [{ argv: [] }] },
    { ...good, probes: [{ argv: ["ok", 5] }] },
    { ...good, failingIndex: 7 },
    { ...good, failingIndex: -1 },
    { ...good, failingIndex: 1.5 },
  ]);
  assert.deepEqual(kept, [good]);
  assert.equal(dropped.length, 10);
  assert.ok(dropped.every((d) => typeof d.why === "string" && d.why !== ""), "each drop carries a reason for the log");
  assert.deepEqual(coerceCandidates(null), { kept: [], dropped: [] });
});

test("dedupeCandidates: keeps the first, never escalates severity", () => {
  // dedupeFindings keeps the HIGHEST severity on collision, so a duplicate can
  // escalate. That is fail-open here: one hallucinated critical sharing a
  // fingerprint with a real nit would report as critical.
  const fp = (c) => c.fp;
  const out = dedupeCandidates([{ fp: "a", severity: "nit" }, { fp: "a", severity: "critical" }, { fp: "b" }], fp);
  assert.deepEqual(out.map((c) => c.fp), ["a", "b"]);
  assert.equal(out[0].severity, "nit", "the first wins; severity is never merged upward");
  // An unusable fingerprint drops the candidate rather than grouping it.
  assert.deepEqual(dedupeCandidates([{ fp: "" }, { fp: null }], fp), []);
});

test("codeLocations: in-scope located citations only", () => {
  const scope = ["packages/cli/src/**"];
  const got = codeLocations(
    { citations: ["packages/cli/src/output/formatter.ts:39", "docs/design/cli.md:691", "packages/cli/src/x.ts", "looks fine"] },
    scope,
  );
  assert.deepEqual([...got], ["packages/cli/src/output/formatter.ts:39"],
    "docs are out of scope; a path with no line locates nothing; prose is not evidence");
  assert.equal(codeLocations({}, scope).size, 0);
  assert.equal(codeLocations({ citations: ["packages/cli/src/a.ts:1"] }, []).size, 0, "empty scope matches nothing");
});

// --- schema wiring ----------------------------------------------------------

test("HUNT_GROUNDS is derived from the schema, not hand-copied", () => {
  const fromSchema = HUNT_VERIFIER_SCHEMA.properties.confirmationGround.enum;
  assert.deepEqual([...HUNT_GROUNDS].sort(), [...fromSchema].sort());
  assert.ok(HUNT_GROUNDS.has("doc-contradicts-code"));
  assert.ok(HUNT_GROUNDS.has("none"), "'none' is a legal value the gate then refuses to act on");
});

test("EXPLORER_SCHEMA: evidence is CITED as journal indices, never authored", () => {
  const cand = EXPLORER_SCHEMA.properties.candidates.items;
  for (const f of ["oracle", "severity", "title", "expected", "observed", "probeRefs", "failingRef", "citations"]) {
    assert.ok(cand.required.includes(f), `${f} must be required`);
  }
  // Indices into the session journal, so the only reproductions a candidate can
  // cite are runs this process actually performed and recorded.
  assert.deepEqual(cand.properties.probeRefs, { type: "array", items: { type: "integer" } });
  assert.deepEqual(cand.properties.failingRef, { type: "integer" });

  // The model must have NO way to hand back a command at all — not a shell string,
  // and no longer even an argv array. Commands reach the CLI only through the
  // bounded `run` tool, so a candidate cannot describe a reproduction that never
  // happened. This is strictly stronger than the argv-array rule it replaces.
  assert.equal(cand.properties.probes, undefined, "candidates must not author probes");
  assert.equal(cand.properties.argv, undefined);
  const json = JSON.stringify(EXPLORER_SCHEMA);
  for (const forbidden of ["command", "shell", "script", "bash", "argv"]) {
    assert.doesNotMatch(json, new RegExp(`"${forbidden}"`, "i"), `schema must not offer a "${forbidden}" field`);
  }
});

// --- two hunters, one gate --------------------------------------------------
//
// The whole reason `isFilingVerdict` took options instead of being duplicated is
// that a second gate would not be covered by anything above. These tests exist to
// keep that true: the options must be able to NARROW the gate and never to open it.

test("UI_GROUNDS is derived from its schema and overlaps HUNT_GROUNDS only where declared", () => {
  const fromSchema = UI_VERIFIER_SCHEMA.properties.confirmationGround.enum;
  assert.deepEqual([...UI_GROUNDS].sort(), [...fromSchema].sort());

  // The overlap must equal SHARED_GROUNDS exactly — in BOTH directions, so neither
  // an undeclared new overlap nor a declared-but-vanished one passes. A ground
  // normally carries no meaning outside its own hunter, so this failing is the
  // signal that someone added one to a set it does not belong in.
  const shared = [...UI_GROUNDS].filter((g) => HUNT_GROUNDS.has(g)).sort();
  assert.deepEqual(shared, [...SHARED_GROUNDS].sort(), "overlap must be exactly the declared allowlist");
  for (const g of SHARED_GROUNDS) {
    assert.ok(HUNT_GROUNDS.has(g) && UI_GROUNDS.has(g), `${g} is declared shared but is not in both sets`);
  }
});

test("UI_VERIFIER_SCHEMA offers no ground for 'it looks wrong'", () => {
  // The agent has no visual channel and a spatial claim traces to nothing, so this
  // is not an omission to be filled in later — it is the design. A regex over the
  // whole schema, because the failure mode is someone adding a friendly synonym.
  const json = JSON.stringify(UI_VERIFIER_SCHEMA);
  for (const forbidden of ["looks", "appears", "visual", "seems", "surprising", "unexpected"]) {
    assert.doesNotMatch(json, new RegExp(`"[a-z-]*${forbidden}[a-z-]*"`, "i"), `no "${forbidden}" ground`);
  }
});

test("UI_EXPLORER_SCHEMA: actions are cited, and the explorer supplies no citations", () => {
  const cand = UI_EXPLORER_SCHEMA.properties.candidates.items;
  for (const f of ["oracle", "severity", "title", "expected", "observed", "actionRefs", "failingRef"]) {
    assert.ok(cand.required.includes(f), `${f} must be required`);
  }
  assert.deepEqual(cand.properties.actionRefs, { type: "array", items: { type: "integer" } });

  // No `citations` field AT ALL. The verifier supplies the code location from source
  // it actually read; a field the schema does not offer cannot be filled in badly.
  assert.equal(cand.properties.citations, undefined, "the UI explorer must not cite code");
  assert.ok(!cand.required.includes("citations"));
  // And no way to author the actions themselves, same as the CLI side.
  assert.equal(cand.properties.actions, undefined);
});

test("the gate's default options reproduce CLI behaviour exactly", () => {
  const v = [confirmed(), confirmed()];
  // Passing the defaults EXPLICITLY must be indistinguishable from omitting them.
  // If this ever diverges, every existing hunt.mjs call site is silently affected.
  assert.equal(
    isFilingVerdict(candidate(), v, CHARTER),
    isFilingVerdict(candidate(), v, CHARTER, { grounds: HUNT_GROUNDS, citationsOf: (c) => c.citations }),
  );
  assert.equal(isFilingVerdict(candidate(), v, CHARTER, {}), true);
  assert.equal(dropReason(candidate(), v, CHARTER, {}), null);
});

test("a UI ground is rejected under the default ground set", () => {
  // The narrowing has to be real: without passing `grounds`, a verifier naming a UI
  // ground has named nothing this gate recognises.
  const v = [confirmed({ confirmationGround: "expectation-violated" }), confirmed({ confirmationGround: "expectation-violated" })];
  assert.equal(isFilingVerdict(candidate(), v, CHARTER), false);
  assert.match(dropReason(candidate(), v, CHARTER), /no confirmation ground/);
});

test("a CLI ground is rejected once the UI ground set is passed", () => {
  // And the reverse, so `grounds` is not merely additive.
  const v = [confirmed(), confirmed()];
  assert.equal(isFilingVerdict(candidate(), v, CHARTER, { grounds: UI_GROUNDS }), false);
});

test("grounds can narrow the gate but never open it", () => {
  const v = [confirmed(), confirmed()];
  // An EMPTY set admits nothing.
  assert.equal(isFilingVerdict(candidate(), v, CHARTER, { grounds: new Set() }), false);
  // "none" stays refused however it is offered — it is in both schemas so that a
  // verifier can decline, not so that declining can pass.
  const declined = [confirmed({ confirmationGround: "none" }), confirmed({ confirmationGround: "none" })];
  assert.equal(isFilingVerdict(candidate(), declined, CHARTER, { grounds: new Set(["none"]) }), false);
  // A malformed `grounds` drops rather than admits — the branch most likely to be
  // got wrong by a caller, so its failure has to land on the quiet side. A
  // duck-typed `{has}` is included deliberately: only a real Set is accepted, so a
  // caller cannot hand in an always-true `has` and open the gate.
  for (const broken of [null, [], "doc-contradicts-code", { has: () => true }, new Map()]) {
    assert.equal(isFilingVerdict(candidate(), v, CHARTER, { grounds: broken }), false, `grounds=${JSON.stringify(broken)}`);
  }
  // `undefined` is NOT malformed — it is how JS spells "not passed", and the
  // destructuring default fires, so this is the CLI ground set and reports.
  assert.equal(isFilingVerdict(candidate(), v, CHARTER, { grounds: undefined }), true);
  assert.equal(isFilingVerdict(candidate(), v, CHARTER, { citationsOf: undefined }), true);
});

test("citationsOf chooses WHICH strings are checked, never whether they are", () => {
  const v = [confirmed(), confirmed()];
  // Sourcing citations from the verifiers' groundedIn is what the UI hunter does.
  // One in-scope citation, and a charter that only needs one, passes.
  const oneCite = { ...CHARTER, minCitations: 1, requiresDocCitation: false };
  const fromVerifiers = (_claimed, verdicts) => verdicts.flatMap((x) => x?.groundedIn ?? []);
  assert.equal(isFilingVerdict(candidate(), v, oneCite, { citationsOf: fromVerifiers }), true);

  // But the citations it returns must STILL match CITATION and still be in scope.
  const outOfScope = [confirmed({ groundedIn: ["packages/frontend/src/app.tsx:1"] })];
  assert.equal(
    isFilingVerdict(candidate(), [outOfScope[0], outOfScope[0]], oneCite, { citationsOf: fromVerifiers }),
    false,
    "an out-of-scope groundedIn must not report",
  );
  const notALocation = [confirmed({ groundedIn: ["the formatter is wrong"] })];
  assert.equal(
    isFilingVerdict(candidate(), [notALocation[0], notALocation[0]], oneCite, { citationsOf: fromVerifiers }),
    false,
    "prose is not a citation, wherever it is sourced from",
  );

  // A citationsOf that throws, or returns a non-array, yields zero citations and
  // therefore drops. It must never be a way to skip stage 4.
  for (const broken of [() => { throw new Error("boom"); }, () => null, () => "a:1", () => 7]) {
    assert.equal(isFilingVerdict(candidate(), v, oneCite, { citationsOf: broken }), false);
  }
});

test("dropReason explains a UI drop through the UI's own options", () => {
  // Not forwarding the options would blame `claimed.citations` — a field UI
  // candidates do not have — for a candidate the panel actually refuted.
  const uiCharter = { ...CHARTER, minCitations: 1, requiresDocCitation: false };
  const opts = {
    grounds: UI_GROUNDS,
    citationsOf: (_c, verdicts) => verdicts.flatMap((x) => x?.groundedIn ?? []),
  };
  const good = confirmed({ confirmationGround: "expectation-violated" });
  assert.equal(isFilingVerdict(candidate(), [good, good], uiCharter, opts), true);
  assert.equal(dropReason(candidate(), [good, good], uiCharter, opts), null);

  const refuted = { ...good, verdict: "refuted" };
  assert.match(dropReason(candidate(), [good, refuted], uiCharter, opts), /verifier 1 refuted/);
});

test("coerceCandidates: evidenceOf can only reject, and its reason reaches the drop table", () => {
  const base = { title: "t", severity: "major", probes: [{ argv: ["docs", "list"] }], failingIndex: 0 };
  // Default is the CLI probe check, so today's behaviour is unchanged.
  assert.equal(coerceCandidates([base]).kept.length, 1);
  assert.equal(coerceCandidates([base], {}).kept.length, 1);

  // A custom validator's REASON is what the run log shows.
  const { kept, dropped } = coerceCandidates([base], { evidenceOf: () => "no actions — cannot be replayed" });
  assert.equal(kept.length, 0);
  assert.equal(dropped[0].why, "no actions — cannot be replayed");

  // It cannot rescue a candidate that fails the checks BEFORE it: title and
  // severity are not negotiable, so an always-passing validator changes nothing.
  const yes = () => null;
  assert.equal(coerceCandidates([{ ...base, title: "  " }], { evidenceOf: yes }).kept.length, 0);
  assert.equal(coerceCandidates([{ ...base, severity: "catastrophic" }], { evidenceOf: yes }).kept.length, 0);
  assert.equal(coerceCandidates(["not an object"], { evidenceOf: yes }).kept.length, 0);

  // A validator that throws drops rather than admits.
  const boom = coerceCandidates([base], { evidenceOf: () => { throw new Error("boom"); } });
  assert.equal(boom.kept.length, 0);
  assert.match(boom.dropped[0].why, /evidence check failed: boom/);

  // A validator returning a non-string, non-null still drops — "not null" means
  // rejected, and a caller that returns `false` meaning "fine" must not pass.
  assert.equal(coerceCandidates([base], { evidenceOf: () => false }).kept.length, 0);
  assert.equal(coerceCandidates([base], { evidenceOf: () => undefined }).kept.length, 0);
});

test("refutationDefects: a refutation is held to the confirmation's standard", () => {
  const charter = { codeScope: ["packages/docs/**"] };
  const sound = {
    verdict: "refuted",
    confidence: "high",
    refutes: "that un-listing loses the heading",
    groundedIn: ["packages/docs/src/store/memory.ts:250"],
  };
  assert.deepEqual(refutationDefects(sound, charter), [], "a grounded refutation naming its target is clean");

  // Not applicable to anything that is not a refutation, so a caller can map over
  // every verdict without branching — including junk, which must not throw.
  assert.deepEqual(refutationDefects({ verdict: "confirmed", groundedIn: [] }, charter), []);
  for (const junk of [null, undefined, 7, "refuted", []]) assert.deepEqual(refutationDefects(junk, charter), []);

  // The #783 shape: real citations, but nothing said about WHAT they contradict.
  const unnamed = { ...sound, refutes: "   " };
  assert.deepEqual(refutationDefects(unnamed, charter), ["names no contradicted claim"]);
  assert.deepEqual(refutationDefects({ ...sound, refutes: undefined }, charter), ["names no contradicted claim"]);

  // Citations are held to the SAME shape and scope the confirmation path applies.
  assert.deepEqual(refutationDefects({ ...sound, groundedIn: [] }, charter), ["cites nothing that locates code"]);
  assert.deepEqual(refutationDefects({ ...sound, groundedIn: ["not a citation"] }, charter), [
    "cites nothing that locates code",
  ]);
  assert.deepEqual(refutationDefects({ ...sound, groundedIn: ["scripts/agent/x.mjs:1"] }, charter), [
    "all 1 citation(s) outside codeScope",
  ]);

  // Both shortfalls are reported together: a drop table that named only the first
  // would send someone to fix one half and re-run for the other.
  assert.deepEqual(
    refutationDefects({ verdict: "refuted", confidence: "low", refutes: "", groundedIn: [] }, charter).length,
    3,
  );

  // A refutation at LOW confidence still outvotes a colleague who confirmed at HIGH.
  // The confirmation path has always required `high`, so the same standard requires it
  // here — this is the asymmetry #785 left behind.
  assert.deepEqual(refutationDefects({ ...sound, confidence: "low" }, charter), ["refuted at low confidence"]);
  assert.deepEqual(refutationDefects({ ...sound, confidence: undefined }, charter), ["refuted at low confidence"]);

  // `charter.minCitations` is read, not assumed to be 1: a charter that demands two
  // citations to confirm must demand two to refute.
  const strict = { codeScope: ["packages/docs/**"], minCitations: 2 };
  assert.deepEqual(refutationDefects(sound, strict), ["cites 1 of the 2 citations this charter requires"]);
  assert.deepEqual(
    refutationDefects({ ...sound, groundedIn: [...sound.groundedIn, "packages/docs/src/view/editor.ts:3100"] }, strict),
    [],
  );

  // A `citationsOf` that throws yields zero citations rather than escaping — same
  // fail-quiet rule the confirmation path uses.
  assert.deepEqual(
    refutationDefects(sound, charter, { citationsOf: () => { throw new Error("boom"); } }),
    ["cites nothing that locates code"],
  );
});

test("dropReason carries the refuter's reasoning, and says when it fell short", () => {
  // THE POINT: on issue #783 this row read only `verifier 1 refuted the candidate`,
  // and the argument that killed a real defect was reachable only by reading raw
  // execution JSON afterwards.
  const uiCharter = { ...CHARTER, minCitations: 1, requiresDocCitation: false, codeScope: ["packages/**"] };
  const opts = {
    grounds: UI_GROUNDS,
    citationsOf: (_c, verdicts) => verdicts.flatMap((x) => x?.groundedIn ?? []),
  };
  const good = confirmed({ confirmationGround: "expectation-violated" });

  const sound = {
    ...good,
    verdict: "refuted",
    reason: "the block model documents this as normal-styled",
    refutes: "that the heading should survive",
    groundedIn: ["packages/docs/src/model/named-styles.ts:97"],
  };
  const why = dropReason(candidate(), [good, sound], uiCharter, opts);
  assert.match(why, /verifier 1 refuted/);
  assert.match(why, /the block model documents this as normal-styled/, "the refuter's own words must reach the table");
  assert.match(why, /that the heading should survive/, "and what it claims to contradict");
  assert.match(why, /named-styles\.ts:97/, "and where it looked");
  assert.doesNotMatch(why, /NOT HELD TO THE CONFIRMATION STANDARD/, "a sound refutation is not scolded");

  // An unsound one still drops the candidate — hunting fails quiet, and a gate that
  // promoted a finding because it disliked the argument against it would manufacture
  // reports out of its own dissatisfaction.
  const unsound = { ...sound, refutes: "", groundedIn: [] };
  assert.equal(isFilingVerdict(candidate(), [good, unsound], uiCharter, opts), false, "still not reported");
  const bad = dropReason(candidate(), [good, unsound], uiCharter, opts);
  assert.match(bad, /NOT HELD TO THE CONFIRMATION STANDARD/);
  assert.match(bad, /names no contradicted claim/);

  // One verifier's essay must not swallow the row.
  const windy = { ...sound, reason: "x".repeat(900) };
  const long = dropReason(candidate(), [good, windy], uiCharter, opts);
  assert.ok(long.length < 700, `drop row should be bounded, got ${long.length}`);
  assert.match(long, /\.\.\./, "and should say it was cut");
});
