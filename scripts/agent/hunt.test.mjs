import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCharters, validateCharter, renderReport, checkStack } from "./hunt.mjs";
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

test("nothing can mutate without a backend, and tier 1 stays read-only", () => {
  // This replaces a blanket "no charter mutates" assertion, which was true only
  // while tier 1 was the only tier. The property that actually protects data is
  // narrower and survives new charters:
  //
  //   mutating  =>  needsBackend
  //
  // The workspace refusal is gated on `mutating` directly, and `checkStack` on
  // `needsBackend`. This invariant is what keeps the two aligned: a charter marked
  // mutating but NOT needsBackend would mutate documents while skipping the
  // backend-reachability skip, so a half-up stack could let it run partway against
  // whatever the ambient config resolves to — the developer's own workspace.
  for (const c of CHARTERS) {
    if (c.mutating) {
      assert.equal(c.needsBackend, true, `${c.id} mutates, so it must also be needsBackend`);
    }
  }
  // The tier-1 pair specifically must stay read-only: they run without docker, so
  // nothing gates them, and they are the charters a developer runs casually.
  for (const id of ["contract", "crash"]) {
    const c = charterOf(id);
    assert.equal(c.needsBackend, false, `${id} must stay backend-free`);
    assert.equal(c.mutating, false, `${id} must stay non-mutating`);
  }
});

test("a mutating charter does not require a doc citation, but must still demand one citation", () => {
  // A broken relation or a wrong post-delete state is self-evidencing — no written
  // promise is needed for `set A1=42; get A1 -> 7` to be wrong. But dropping
  // `minCitations` to 0 would let a candidate through with nothing locating the
  // defect in code, which is unactionable for whoever picks it up.
  for (const id of ["round-trip", "state"]) {
    const c = charterOf(id);
    assert.equal(c.requiresDocCitation, false, `${id} should not need a doc promise`);
    assert.ok((c.minCitations ?? 0) >= 1, `${id} must still require a code citation`);
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
  // The engine packages ARE in scope on purpose: the CLI is a thin client, so a
  // defect it surfaces often lives in docs/sheets/slides/backend rather than in
  // `packages/cli`. Scoping citations to the CLI would have forced the hunter to
  // blame the driver for a bug in the engine.
  assert.equal(
    isFilingVerdict(cand(["packages/sheets/src/formula/formula.ts:1", "docs/design/cli.md:691"], "docs/design/cli.md:691"), ok, contract),
    true,
    "an engine-package citation is in scope — the CLI drives these packages",
  );
  // But scope is still a scope: the frontend is unreachable from a CLI, so a
  // citation there cannot be evidence for anything this hunter observed.
  assert.equal(
    isFilingVerdict(cand(["packages/frontend/src/App.tsx:1", "docs/design/cli.md:691"], "docs/design/cli.md:691"), ok, contract),
    false,
    "a citation outside every scoped package must not satisfy codeScope",
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

test("every charter rubric states the argv contract and the empirical loop", () => {
  // The anti-injection design rests on commands only ever being argv ARRAYS, and
  // the rubric is where the model learns that. Asserting the ABSENCE of the word
  // "shell" cannot work — the rubrics legitimately say "never a shell string" — so
  // assert the prohibition is PRESENT instead.
  //
  // The second half of this test INVERTED with the executing explorer. It used to
  // require the rubric say the model does not run commands; a rubric that still
  // said so would now be a lie that wastes the whole session, because the model
  // would sit predicting instead of probing. So it must say the opposite, and must
  // also warn about refusals and the finite budget — a model surprised by either
  // burns runs rediscovering them.
  for (const c of CHARTERS) {
    assert.match(c.rubric, /argv/i, `${c.id} must describe the argv contract`);
    // `\s+` throughout: these rubrics are hard-wrapped markdown, so any phrase can
    // straddle a newline. A literal-space regex silently depends on where the
    // author happened to wrap.
    assert.match(c.rubric, /never a\s+shell\s+string/i, `${c.id} must forbid a shell string outright`);
    assert.match(c.rubric, /You \*\*run\s+the\s+CLI\*\*/i, `${c.id} must tell the model it executes`);
    assert.match(c.rubric, /probeRefs/, `${c.id} must explain citing runs by index`);
    assert.match(c.rubric, /refus/i, `${c.id} must warn that some commands are refused`);
    assert.match(c.rubric, /budget/i, `${c.id} must warn the run budget is finite`);
    assert.doesNotMatch(c.rubric, /do \*\*not\*\*\s+run\s+commands/i, `${c.id} must not claim it cannot execute`);
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

// --- the agreement measurement -----------------------------------------------

test("renderReport: shows cap-truncated candidates, not just a count", () => {
  // A bound on how much gets verified is only honest if what it dropped can be
  // READ. If this section ever silently stops rendering, a truncated run becomes
  // indistinguishable from a thorough one. (Successor to the agreement-cost
  // section this replaced when cross-sample agreement was removed.)
  const md = renderReport({
    runId: "r1",
    headSha: "abc1234",
    charters: ["contract"],
    reported: [],
    stats: { proposed: 9, unique: 7, novel: 7, reproduced: 5, refutedAfterReplay: 2, cappedUnverified: 3, reported: 0 },
    dropped: [
      {
        title: "--format yaml prints undefined",
        why: "verification cap reached (4 per charter) — NOT recorded, will be retried next run",
        capped: true,
        reproduced: true,
        claimed: {
          oracle: "contract",
          severity: "major",
          expected: "valid YAML on stdout",
          observed: "the literal string undefined, exit 0",
          citations: ["packages/cli/src/output/formatter.ts:37"],
          docCitation: "docs/design/cli.md:714",
        },
      },
      { title: "flaky one", why: "replay: diverged (nondeterministic)", capped: true, reproduced: false },
      { title: "panel said no", why: "verifier 0 refuted the candidate", reproduced: false },
    ],
  });

  assert.match(md, /## Reproduced but not verified — cap reached \(1\)/, "must show the count of judgeable candidates");
  assert.match(md, /--format yaml prints undefined/);
  assert.match(md, /valid YAML on stdout/, "expected/observed are what makes it judgeable by hand");
  assert.match(md, /packages\/cli\/src\/output\/formatter\.ts:37/);
  assert.match(md, /docs\/design\/cli\.md:714/);
  // A solo candidate that did NOT reproduce is not judgeable and must not appear
  // in this section — it would dilute exactly the signal being measured.
  assert.equal(/### flaky one/.test(md), false, "a capped candidate that did not reproduce is not judgeable");
  assert.equal(/### panel said no/.test(md), false, "panel refutations belong in the plain table, not here");
  // ...but everything still appears in the full drop table.
  assert.match(md, /## Dropped \(3\)/);
  assert.match(md, /\| cappedUnverified \| 3 \|/, "the funnel must carry the measurement too");
  assert.match(md, /\| refutedAfterReplay \| 2 \|/, "and the precision signal that replaced agreement");
});

test("renderReport: redacts secrets carried by DROPPED candidates", () => {
  // Widening the report to show dropped candidates also widened the egress
  // boundary: probe output from a candidate that was never reported now reaches
  // a file destined for a public issue. Before this change `extra` was built from
  // `reported` only, so a token echoed by a solo candidate would have survived on
  // generic patterns alone.
  const md = renderReport({
    runId: "r1",
    headSha: "abc1234",
    charters: ["contract"],
    reported: [],
    stats: { proposed: 1, cappedUnverified: 1 },
    dropped: [
      {
        title: "leaky",
        why: "verification cap reached (4 per charter)",
        capped: true,
        reproduced: true,
        secrets: ["s3cr3t-workspace-key"],
        claimed: { oracle: "contract", severity: "major", expected: "ok", observed: "sent s3cr3t-workspace-key upstream", citations: [] },
      },
    ],
  });
  assert.equal(md.includes("s3cr3t-workspace-key"), false, "a dropped candidate's secret reached the report");
});

// --- backend preconditions ---------------------------------------------------

test("checkStack: a healthy backend is up", async () => {
  const calls = [];
  const r = await checkStack("http://localhost:3000", {
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, status: 200 };
    },
  });
  assert.deepEqual(r, { up: true, detail: "HTTP 200" });
  assert.deepEqual(calls, ["http://localhost:3000/health"]);
});

test("checkStack: a trailing slash does not produce a double slash", async () => {
  let seen = null;
  await checkStack("http://localhost:3000///", { fetchImpl: async (u) => ((seen = u), { ok: true, status: 200 }) });
  assert.equal(seen, "http://localhost:3000/health");
});

test("checkStack: every failure mode reports DOWN rather than throwing", async () => {
  // A thrown error here would abort the whole run, taking the backend-FREE charters
  // with it — the opposite of the intent, which is to skip only what cannot run.
  const cases = [
    ["non-2xx", async () => ({ ok: false, status: 503 }), /HTTP 503/],
    ["connection refused", async () => { throw new Error("fetch failed"); }, /fetch failed/],
    ["aborted", async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }, /no response in/],
  ];
  for (const [label, fetchImpl, detail] of cases) {
    const r = await checkStack("http://x", { fetchImpl, timeoutMs: 50 });
    assert.equal(r.up, false, label);
    assert.match(r.detail, detail, label);
  }
  // No server configured at all is also down, not a crash.
  assert.equal((await checkStack("")).up, false);
  assert.equal((await checkStack(undefined)).up, false);
});

test("renderReport: a skipped charter is reported as NOT a clean bill of health", () => {
  // The failure this prevents: a run where the only mutating charter never started
  // renders "0 reported", which reads exactly like "nothing is wrong".
  const md = renderReport({
    ...base,
    reported: [],
    dropped: [],
    stats: { proposed: 0, reported: 0 },
    skipped: [
      { charter: "round-trip", kind: "stack-down", why: "backend unreachable (fetch failed)" },
      { charter: "state", kind: "workspace-refused", why: "WAFFLEBASE_HUNT_WORKSPACE is not set." },
    ],
  });
  assert.match(md, /## Charters that did NOT run \(2\)/);
  assert.match(md, /not a clean bill of health/);
  assert.match(md, /round-trip.*stack-down/);
  assert.match(md, /state.*workspace-refused/);
  // It must precede the no-findings section, or a reader reaches the reassuring
  // sentence before the caveat.
  assert.ok(
    md.indexOf("did NOT run") < md.indexOf("No candidates reported"),
    "the skip warning must come before the no-findings message",
  );
});

test("renderReport: no skip section when everything ran", () => {
  const md = renderReport({ ...base, reported: [], dropped: [], stats: { proposed: 0 } });
  assert.doesNotMatch(md, /did NOT run/);
});
