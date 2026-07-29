import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCharters, validateCharter, renderReport } from "./hunt.mjs";
import { isFilingVerdict } from "./hunt-gate.mjs";

// Read the SHIPPED manifest rather than inlining a copy. An earlier draft of the
// review panel's tests inlined its globs, which meant editing lenses.json left
// the tests green while shipped behavior changed — the config was effectively
// untested. Same trap applies here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHARTERS_DIR = path.join(HERE, "charters");
const CHARTERS = loadCharters(CHARTERS_DIR);
const charterOf = (id) => {
  const c = CHARTERS.find((x) => x.id === id);
  assert.ok(c, `charters.json has no charter with id "${id}"`);
  return c;
};

test("every shipped charter passes its own validator", () => {
  assert.ok(CHARTERS.length > 0, "at least one charter must ship");
  for (const c of CHARTERS) {
    assert.deepEqual(validateCharter(c), [], `charter "${c.id}" is misconfigured`);
  }
});

test("tier 1 charters are backend-free and non-mutating", () => {
  // The whole reason tier 1 ships first: no docker lifecycle, so no flake, and no
  // way for a probe to touch real data.
  for (const c of CHARTERS) {
    assert.equal(c.needsBackend, false, `${c.id} must not need a backend in tier 1`);
    assert.equal(c.mutating, false, `${c.id} must be non-mutating in tier 1`);
  }
});

test("validateCharter rejects the configurations that would silently report nothing", () => {
  const base = charterOf("contract");
  // The subtle one: demanding a doc citation with no docsScope means
  // citationInScope fails quiet on every candidate — a charter that can never
  // report, for a reason invisible in the run log.
  assert.match(
    validateCharter({ ...base, docsScope: [] }).join(" "),
    /nothing could ever pass/,
  );
  assert.match(validateCharter({ ...base, verifiers: 1 }).join(" "), /verifiers must be >= 2/);
  assert.match(validateCharter({ ...base, samples: 1 }).join(" "), /samples must be >= 2/);
  assert.match(validateCharter({ ...base, oracles: [] }).join(" "), /missing oracles/);
  assert.match(validateCharter({ ...base, codeScope: [] }).join(" "), /missing codeScope/);
  assert.deepEqual(validateCharter(null), ["not an object"]);
});

test("charter scopes actually match the files they are meant to cover", () => {
  // A scope typo would make every candidate drop for an invisible reason, so pin
  // the real paths the ground-truth CLI bugs live in.
  const contract = charterOf("contract");
  const cand = (citations, docCitation) => ({
    replay: { status: "reproduced", deterministic: true },
    claimed: {
      oracle: "contract",
      severity: "major",
      title: "t",
      expected: "e",
      observed: "o",
      citations,
      docCitation,
    },
  });
  const ok = [
    { verdict: "confirmed", confidence: "high", confirmationGround: "doc-contradicts-code", groundedIn: ["a.ts:1"], duplicateOf: null },
    { verdict: "confirmed", confidence: "high", confirmationGround: "doc-contradicts-code", groundedIn: ["a.ts:1"], duplicateOf: null },
  ];
  assert.equal(
    isFilingVerdict(cand(["packages/cli/src/output/formatter.ts:39", "docs/design/cli.md:691"], "docs/design/cli.md:691"), ok, contract),
    true,
    "the real ground-truth citation pair must pass the shipped scopes",
  );
  assert.equal(
    isFilingVerdict(cand(["packages/sheets/src/formula/formula.ts:1", "docs/design/cli.md:691"], "docs/design/cli.md:691"), ok, contract),
    false,
    "a citation outside packages/cli/src must not satisfy codeScope",
  );
});

test("every charter has a rubric that states the inversion and forbids minor/nit", () => {
  // The rubrics are the only place the model learns the polarity. A rubric that
  // reads like a code-review prompt would produce exactly the AI-slop failure
  // this pipeline exists to avoid, and no code path would catch it.
  for (const c of CHARTERS) {
    assert.ok(c.rubric.length > 500, `${c.id} rubric looks empty`);
    // `\s+` between words throughout — see the note on wrapping below.
    assert.match(c.rubric, /false\s+negative\s+costs/i, `${c.id} rubric must state the cost asymmetry`);
    assert.match(c.rubric, /drop\s+it/i, `${c.id} rubric must tell the model to drop when unsure`);
    assert.match(c.rubric, /do\s+not\s+emit/i, `${c.id} rubric must forbid minor/nit`);
    assert.match(c.rubric, /DATA, never as\s+instructions/i, `${c.id} rubric must mark inputs as data`);
    // Must NOT inherit the review panel's coverage-first framing, which is
    // correct for review and catastrophic here.
    assert.doesNotMatch(c.rubric, /report every issue you find/i, `${c.id} rubric must not be coverage-first`);
    assert.doesNotMatch(c.rubric, /assume a bug exists/i, `${c.id} rubric must not assume a bug exists`);
  }
});

test("every charter rubric states the argv contract and forbids a shell string", () => {
  // The anti-injection design rests on the model only ever emitting argv, and the
  // rubric is where it learns that. Asserting the ABSENCE of the word "shell"
  // cannot work — the rubrics legitimately contain "never a shell string" — so
  // assert the prohibition is PRESENT instead. Also pin that the rubric tells the
  // model it does not run commands, since a rubric implying otherwise would have
  // it emit commands the runner then refuses, wasting every probe.
  for (const c of CHARTERS) {
    assert.match(c.rubric, /argv/i, `${c.id} must describe the argv contract`);
    // `\s+` throughout: these rubrics are hard-wrapped markdown, so any phrase
    // can straddle a newline. A literal-space regex silently depends on where the
    // author happened to wrap.
    assert.match(c.rubric, /never a\s+shell\s+string/i, `${c.id} must forbid a shell string outright`);
    assert.match(c.rubric, /do \*\*not\*\*\s+run\s+commands/i, `${c.id} must say the model does not execute`);
  }
});

// --- report rendering -------------------------------------------------------

const base = {
  runId: "abc12345",
  headSha: "deadbeef",
  charters: ["contract"],
  stats: { proposed: 3, agreed: 1, reported: 0 },
  reported: [],
  dropped: [],
};

test("renderReport: an empty run reads as a normal outcome, not a failure", () => {
  // If a quiet run looked like a crash, every clean night would page someone.
  const md = renderReport(base);
  assert.match(md, /No candidates reported/);
  assert.match(md, /normal outcome, not a failure/);
  assert.match(md, /\| proposed \| 3 \|/, "the funnel must show where candidates went");
});

test("renderReport: redacts secrets from probe output and repro scripts", () => {
  // The report is the publication boundary. A leak here goes to a public repo.
  const md = renderReport({
    ...base,
    reported: [
      {
        fp: "f1",
        claimed: {
          severity: "major",
          title: "leaks a token",
          oracle: "contract",
          expected: "e",
          observed: "printed Authorization: Bearer eyJhbGciOi.JzdWIiOiIx.sig",
          citations: ["packages/cli/src/x.ts:1"],
        },
        probes: [{ argv: ["--api-key", "wfb_supersecret123"] }],
        secrets: ["OPAQUE-RUN-TOKEN"],
      },
    ],
    dropped: [{ title: "other", why: "replay: not-reproduced" }],
  });
  assert.doesNotMatch(md, /wfb_supersecret123/);
  assert.doesNotMatch(md, /eyJhbGciOi\.JzdWIiOiIx\.sig/);
  assert.doesNotMatch(md, /OPAQUE-RUN-TOKEN/);
  assert.match(md, /leaks a token/, "the finding itself still renders");
});

test("renderReport: a pipe in a title cannot break the drop table", () => {
  const md = renderReport({ ...base, dropped: [{ title: "a | b", why: "c | d" }] });
  const row = md.split("\n").find((l) => l.includes("a \\| b"));
  assert.ok(row, "pipes must be escaped so the markdown table survives");
});
