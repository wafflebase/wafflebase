import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFilingVerdict,
  dropReason,
  huntSeverity,
  coerceCandidates,
  dedupeCandidates,
  codeLocations,
  citationPath,
  citationInScope,
  HUNT_GROUNDS,
  HUNT_VERIFIER_SCHEMA,
  EXPLORER_SCHEMA,
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
