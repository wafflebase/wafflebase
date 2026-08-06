import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkSurfaceScope,
  createUiTool,
  describeReaders,
  MAX_DISPLAY_CHARS,
  readersForSurface,
  renderUiObservation,
  resolveActionRefs,
  UI_READERS_BY_SURFACE,
  UI_SHARED_READERS,
  UI_SURFACES,
} from "./hunt-ui-tool.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

/** A budget that always admits, so budget behaviour is tested separately from tool logic. */
function openBudget({ ok = true, why = "exhausted", remainingMs = 60_000 } = {}) {
  const refusals = [];
  return {
    charged: 0,
    refusals,
    charge() {
      this.charged += 1;
      return ok ? { ok: true, remainingMs } : { ok: false, why };
    },
    noteRefusal(kind, detail) {
      refusals.push({ kind, detail });
    },
  };
}

/** A session stand-in: hands back scripted observations and records what it was asked. */
function stubSession(replies) {
  const calls = [];
  const queue = [...replies];
  return {
    calls,
    async act(action, opts) {
      calls.push({ action, opts });
      const next = queue.shift();
      if (typeof next === "function") return next(action);
      return next ?? { ok: true, value: null, oracles: [] };
    },
  };
}

const textOf = (result) => result.content.map((c) => c.text).join("");

const goodExpect = {
  read: "doc.blockCount",
  op: "equals",
  value: 3,
  ground: "D",
  because: "typing should not change the block count",
};

// --- the reader catalogue ----------------------------------------------------

// THE DRIFT GUARD. The tool describes the readers from its own table, because the
// description must exist before a browser does. That table is a second copy of the
// bridge's registry, and a stale copy is SILENT: the explorer never calls a reader it
// was not told about, and "never called" is indistinguishable from "found nothing there".
// This test is the only thing standing between that and a quiet loss of coverage.
test("the reader catalogue matches the bridge registry exactly", () => {
  const bridge = fs.readFileSync(
    path.join(REPO_ROOT, "packages", "frontend", "src", "app", "harness", "hunt", "bridge.ts"),
    "utf8",
  );
  const registered = new Set([...bridge.matchAll(/"((?:doc|sheet)\.[A-Za-z]+)":/g)].map((m) => m[1]));
  assert.ok(registered.size > 0, "parsed no readers out of bridge.ts — the pattern has gone stale");

  const described = new Set(Object.values(UI_READERS_BY_SURFACE).flat().map(([name]) => name));

  const missing = [...registered].filter((r) => !described.has(r)).sort();
  const extra = [...described].filter((r) => !registered.has(r)).sort();
  assert.deepEqual(missing, [], `readers the bridge provides but the tool never mentions: ${missing.join(", ")}`);
  assert.deepEqual(extra, [], `readers the tool advertises but the bridge does not provide: ${extra.join(", ")}`);
});

test("each reader is filed under the surface its namespace names", () => {
  for (const surface of UI_SURFACES) {
    for (const [name] of UI_READERS_BY_SURFACE[surface]) {
      assert.ok(name.startsWith(`${surface}.`), `${name} is filed under ${surface}`);
    }
  }
});

test("every reader carries a one-line meaning, so the description is usable", () => {
  for (const [name, args, meaning] of [...Object.values(UI_READERS_BY_SURFACE).flat(), ...UI_SHARED_READERS]) {
    assert.ok(meaning && meaning.length > 10, `${name} needs a real description`);
    assert.ok(args === "" || /^\(\w+\)$/.test(args), `${name} arity should be "" or "(name)", got ${args}`);
  }
});

test("readersForSurface scopes to one surface plus the shared dom readers", () => {
  const doc = readersForSurface("doc").map(([n]) => n);
  assert.ok(doc.includes("doc.fontSizes"));
  assert.ok(doc.includes("dom.snapshot"), "dom.* is available on every surface");
  assert.ok(!doc.some((n) => n.startsWith("sheet.")), "no sheet readers leak into a doc run");
  // An unknown surface degrades rather than throwing — the orchestrator validates names.
  assert.deepEqual(
    readersForSurface("nope").map(([n]) => n),
    UI_SHARED_READERS.map(([n]) => n),
  );
});

// Same shape as the `readers["toString"]` bug already fixed in bridge.ts: a bare index
// into an object literal resolves inherited keys, and spreading the resulting function
// throws. A misconfigured surface must degrade the run, not crash it.
test("readersForSurface survives an inherited key such as constructor", () => {
  for (const surface of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
    assert.deepEqual(
      readersForSurface(surface).map(([n]) => n),
      UI_SHARED_READERS.map(([n]) => n),
      `${surface} must fall back to the shared readers`,
    );
  }
});

test("describeReaders names the readers with their arity", () => {
  const text = describeReaders("sheet");
  assert.match(text, /sheet\.cellValue\(sref\) — /);
  assert.ok(!text.includes("doc.fontSizes"));
});

// --- the surface pin ---------------------------------------------------------

test("checkSurfaceScope allows this surface's readers and the shared ones", () => {
  assert.equal(checkSurfaceScope({ type: "read", reader: "doc.text" }, "doc"), null);
  assert.equal(checkSurfaceScope({ type: "read", reader: "dom.snapshot" }, "doc"), null);
  assert.equal(checkSurfaceScope({ type: "goto", surface: "doc" }, "doc"), null);
});

test("checkSurfaceScope refuses another surface's reader, and says which are available", () => {
  const why = checkSurfaceScope({ type: "read", reader: "sheet.cellValue" }, "doc");
  assert.match(why, /belongs to another surface/);
  assert.match(why, /doc\.fontSizes/, "the refusal lists what IS available");
});

test("checkSurfaceScope refuses an unknown reader by name", () => {
  assert.match(checkSurfaceScope({ type: "read", reader: "doc.nope" }, "doc"), /unknown reader/);
});

// `assertSafeActionPlan` only bounds reader NAMESPACES, so `wait`, a click target's
// `reader` and `expect.read` are three separate doors into the other surface. Removing
// any one of them from the check reopens it.
test("checkSurfaceScope covers wait, click targets and predictions, not just read", () => {
  assert.match(checkSurfaceScope({ type: "wait", reader: "sheet.canUndo" }, "doc"), /another surface/);
  assert.match(
    checkSurfaceScope({ type: "click", target: { reader: "sheet.cellCenter", args: ["A1"] } }, "doc"),
    /another surface/,
  );
  assert.match(
    checkSurfaceScope({ type: "read", reader: "doc.text", expect: { read: "sheet.activeCell" } }, "doc"),
    /another surface/,
  );
});

// The surface pin would be advisory if an agent could simply navigate away and then read
// legally. `goto` names its surface directly, so this is the whole of that door.
test("checkSurfaceScope refuses navigating to another surface", () => {
  assert.match(checkSurfaceScope({ type: "goto", surface: "sheet" }, "doc"), /not permitted/);
});

// --- the handler -------------------------------------------------------------

test("createUiTool demands a session, a budget and a journal", () => {
  assert.throws(() => createUiTool({ budget: openBudget(), journal: [] }), /session/);
  assert.throws(() => createUiTool({ session: stubSession([]), journal: [] }), /budget/);
  assert.throws(() => createUiTool({ session: stubSession([]), budget: openBudget() }), /journal/);
});

test("a happy read returns its value and journals the action", async () => {
  const journal = [];
  const session = stubSession([{ ok: true, value: [11, 18, 32], oracles: [] }]);
  const run = createUiTool({ session, budget: openBudget(), journal, surface: "doc" });

  const out = textOf(await run({ action: { type: "read", reader: "doc.fontSizes" }, note: "baseline" }));
  assert.match(out, /ok: read/);
  assert.match(out, /doc\.fontSizes => \[11,18,32\]/);
  assert.equal(journal.length, 1);
  assert.deepEqual(journal[0].value, [11, 18, 32]);
  assert.equal(journal[0].note, "baseline");
  assert.equal(journal[0].ok, true);
});

// BUDGET BEFORE VALIDATION. Otherwise a stream of malformed calls costs nothing and an
// exhausted session can be kept alive indefinitely.
test("the budget is charged before the action is even validated", async () => {
  const budget = openBudget({ ok: false, why: "Session action budget exhausted" });
  const session = stubSession([]);
  const run = createUiTool({ session, budget, journal: [], surface: "doc" });

  const out = await run({ action: { type: "nonsense" } });
  assert.match(textOf(out), /budget exhausted/);
  assert.equal(out.isError, true);
  assert.equal(budget.charged, 1, "charged even though the action was garbage");
  assert.equal(session.calls.length, 0, "and never executed");
});

test("an invalid action is refused, noted, and never reaches the browser", async () => {
  const budget = openBudget();
  const session = stubSession([]);
  const journal = [];
  const run = createUiTool({ session, budget, journal, surface: "doc" });

  const out = await run({ action: { type: "evaluate", script: "window.close()" } });
  assert.equal(out.isError, true);
  assert.match(textOf(out), /Refused/);
  assert.equal(session.calls.length, 0);
  assert.equal(journal.length, 0, "a refused action is not an observation");
  assert.equal(budget.refusals[0].kind, "unsafe-action");
});

test("a cross-surface action is refused and noted distinctly", async () => {
  const budget = openBudget();
  const session = stubSession([]);
  const run = createUiTool({ session, budget, journal: [], surface: "doc" });

  const out = await run({ action: { type: "read", reader: "sheet.cellValue", args: ["A1"] } });
  assert.equal(out.isError, true);
  assert.equal(session.calls.length, 0);
  assert.equal(budget.refusals[0].kind, "surface-scope");
  // The model needs the reader listing to recover; the refusal LOG does not, and a live
  // run showed it capturing all twelve descriptions per refusal.
  assert.match(textOf(out), /doc\.fontSizes/, "the model is told what IS available");
  assert.ok(!budget.refusals[0].detail.includes("\n"), "the logged detail is one line");
});

// A malformed prediction must be an ordinary refusal, not a finding — and
// `assertSafeActionPlan` is what rejects it, so this also proves the tool did not grow a
// second, driftable shape check of its own.
test("a malformed prediction is refused before the browser, not scored", async () => {
  const budget = openBudget();
  const session = stubSession([]);
  const run = createUiTool({ session, budget, journal: [], surface: "doc" });

  const out = await run({
    action: { type: "read", reader: "doc.text", expect: { read: "doc.text", op: "matches", value: "x", ground: "Z" } },
  });
  assert.equal(out.isError, true);
  assert.match(textOf(out), /malformed/);
  assert.equal(session.calls.length, 0);
});

// The action and its verification read must travel together. Splitting them would let a
// caller act, look, and only then decide what it had "expected".
test("the prediction is passed through to the runner, unsplit", async () => {
  const session = stubSession([{ ok: true, value: null, actual: 3, actualError: null, oracles: [] }]);
  const run = createUiTool({ session, budget: openBudget(), journal: [], surface: "doc" });

  await run({ action: { type: "type", text: "hello", expect: goodExpect } });
  assert.equal(session.calls.length, 1, "ONE round trip — the tool must not issue its own read");
  assert.deepEqual(session.calls[0].action.expect, goodExpect);
});

test("a held prediction is reported as held", async () => {
  const journal = [];
  const session = stubSession([{ ok: true, value: null, actual: 3, actualError: null, oracles: [] }]);
  const run = createUiTool({ session, budget: openBudget(), journal, surface: "doc" });

  const out = textOf(await run({ action: { type: "type", text: "hi", expect: goodExpect } }));
  assert.match(out, /prediction \(equals on doc\.blockCount\): held/);
  assert.equal(journal[0].prediction.verdict, "held");
  assert.equal(journal[0].prediction.eligible, false);
});

test("a violated ground-D prediction is reported as not reportable", async () => {
  const session = stubSession([{ ok: true, value: null, actual: 9, actualError: null, oracles: [] }]);
  const run = createUiTool({ session, budget: openBudget(), journal: [], surface: "doc" });

  const out = textOf(await run({ action: { type: "type", text: "hi", expect: goodExpect } }));
  assert.match(out, /: violated/);
  assert.match(out, /not grounded, so not reportable/);
  assert.ok(!out.includes("GROUNDED"), "ground D must never present as a candidate");
});

test("a violated ground-A prediction against an earlier read IS a candidate", async () => {
  const journal = [];
  const session = stubSession([
    { ok: true, value: [11, 18, 32], oracles: [] },
    { ok: true, value: null, actual: [11, 18, 32], actualError: null, oracles: [] },
  ]);
  const run = createUiTool({ session, budget: openBudget(), journal, surface: "doc" });

  await run({ action: { type: "read", reader: "doc.fontSizes" } });
  const out = textOf(
    await run({
      action: {
        type: "click",
        target: { role: "button", name: "Increase font size" },
        expect: {
          read: "doc.fontSizes",
          op: "not-equals",
          value: "@read:0",
          ground: "A",
          because: "increasing the font size should change the sizes I read a moment ago",
        },
      },
    }),
  );
  assert.match(out, /: violated/);
  assert.match(out, /GROUNDED/);
  assert.equal(journal[1].prediction.eligible, true);
});

// THE SELF-REFERENCE GENERATOR. `not-equals @read:<own index>` compares a reading to
// itself, so it violates every time while passing every grounding check. `atIndex` being
// this action's own index is what refuses it; pass the wrong index and this test fails.
test("a prediction cannot cite its own step as its baseline", async () => {
  const journal = [];
  const session = stubSession([{ ok: true, value: "text", actual: "text", actualError: null, oracles: [] }]);
  const run = createUiTool({ session, budget: openBudget(), journal, surface: "doc" });

  const out = textOf(
    await run({
      action: {
        type: "read",
        reader: "doc.text",
        expect: {
          read: "doc.text",
          op: "not-equals",
          value: "@read:0",
          ground: "A",
          because: "self-reference, which must never be eligible",
        },
      },
    }),
  );
  assert.match(out, /unevaluable/);
  assert.equal(journal[0].prediction.eligible, false);
});

// Infrastructure trouble must never manufacture a finding. This is the fail-quiet
// direction, and the inverse of how the review panel behaves.
test("a prediction whose read threw is unevaluable, not violated", async () => {
  const journal = [];
  const session = stubSession([
    { ok: true, value: null, actual: null, actualError: "Execution context was destroyed", oracles: [] },
  ]);
  const run = createUiTool({ session, budget: openBudget(), journal, surface: "doc" });

  const out = textOf(await run({ action: { type: "key", key: "Control+z", expect: goodExpect } }));
  assert.match(out, /unevaluable/);
  assert.match(out, /prediction read failed/);
  assert.equal(journal[0].prediction.eligible, false);
});

test("ground C is only available against a snapshot the explorer actually took", async () => {
  const journal = [];
  const claim = {
    read: "doc.blockCount",
    op: "equals",
    value: 99,
    ground: "C",
    source: "Increase font size",
    because: "the toolbar advertises this control",
  };
  const session = stubSession([
    { ok: true, value: null, actual: 1, actualError: null, oracles: [] },
    { ok: true, value: "button 'Increase font size'", oracles: [] },
    { ok: true, value: null, actual: 1, actualError: null, oracles: [] },
  ]);
  const run = createUiTool({ session, budget: openBudget(), journal, surface: "doc" });

  // No snapshot yet — the quote cannot be grounded in anything.
  await run({ action: { type: "type", text: "a", expect: claim } });
  assert.equal(journal[0].prediction.eligible, false);

  // Take one, and the same quoted claim becomes groundable.
  await run({ action: { type: "read", reader: "dom.snapshot" } });
  await run({ action: { type: "type", text: "b", expect: claim } });
  assert.equal(journal[2].prediction.eligible, true);
});

test("a failed action is reported as data, and journalled as not ok", async () => {
  const journal = [];
  const session = stubSession([{ ok: false, error: "locator resolved to 0 elements", oracles: [] }]);
  const run = createUiTool({ session, budget: openBudget(), journal, surface: "doc" });

  const out = await run({ action: { type: "click", target: { role: "button", name: "Nope" } } });
  assert.equal(out.isError, undefined, "a click that missed is an observation, not a tool error");
  assert.match(textOf(out), /FAILED: click — locator resolved to 0 elements/);
  assert.equal(journal[0].ok, false);
});

test("a session fault is a readable refusal and never a finding", async () => {
  const budget = openBudget();
  const journal = [];
  const session = {
    async act() {
      throw new Error("hunt-ui-session: runner exited (code 1, signal none)");
    },
  };
  const run = createUiTool({ session, budget, journal, surface: "doc" });

  const out = await run({ action: { type: "read", reader: "doc.text", expect: goodExpect } });
  assert.equal(out.isError, true);
  assert.match(textOf(out), /browser session failed/);
  assert.equal(journal.length, 0);
  assert.equal(budget.refusals[0].kind, "session-fault");
});

test("one action can never outlive the budget's remaining time", async () => {
  const session = stubSession([{ ok: true, value: null, oracles: [] }]);
  const run = createUiTool({
    session,
    budget: openBudget({ remainingMs: 1_500 }),
    journal: [],
    surface: "doc",
    charter: { actionBudget: { perActionTimeoutMs: 30_000 } },
  });
  await run({ action: { type: "read", reader: "doc.text" } });
  assert.equal(session.calls[0].opts.timeoutMs, 1_500);
});

// --- what comes back --------------------------------------------------------

test("oracles are always surfaced, asked for or not", () => {
  const out = renderUiObservation({
    action: { type: "type", text: "x" },
    observation: { ok: true, oracles: [{ kind: "console-error", detail: "TypeError: undefined is not a function" }] },
  });
  assert.match(out, /oracles fired/);
  assert.match(out, /console-error/);
});

// A click that hands back the resulting page state is a click that lets the caller skip
// predicting altogether.
test("a non-read action does not leak the page state", () => {
  const out = renderUiObservation({
    action: { type: "click", target: { role: "button", name: "Bold" } },
    observation: { ok: true, value: "SECRET PAGE STATE", oracles: [] },
  });
  assert.ok(!out.includes("SECRET PAGE STATE"));
});

// Handing back the measured value invites re-describing a violated prediction as some
// weaker claim that happens to fit it.
test("a prediction reports its verdict, never the raw actual", () => {
  const out = renderUiObservation({
    action: { type: "type", text: "x", expect: goodExpect },
    observation: { ok: true, value: null, actual: "MEASURED VALUE", oracles: [] },
    prediction: { verdict: "violated", eligible: false, why: "ground D is never eligible", detail: "3 !== 9" },
  });
  assert.ok(!out.includes("MEASURED VALUE"));
  assert.match(out, /violated/);
});

test("a long value is clipped for display and says so", () => {
  const out = renderUiObservation({
    action: { type: "read", reader: "doc.text" },
    observation: { ok: true, value: "x".repeat(MAX_DISPLAY_CHARS * 3), oracles: [] },
  });
  assert.ok(out.length < MAX_DISPLAY_CHARS * 2);
  // A string value prints raw rather than JSON-quoted, so the count is the string's own.
  assert.match(out, /clipped at 1200 of 3600 chars/);
});

test("an undeliverable value is named as such, not printed as an object", () => {
  const out = renderUiObservation({
    action: { type: "read", reader: "doc.runs" },
    observation: { ok: true, value: { __oversized: true }, oracles: [] },
  });
  assert.match(out, /oversized/);
  assert.ok(!out.includes("__oversized"));
});

// --- the repro ---------------------------------------------------------------

test("resolveActionRefs builds a plan from cited indices", () => {
  const journal = [
    { action: { type: "goto", surface: "doc" } },
    { action: { type: "type", text: "hello" } },
    { action: { type: "read", reader: "doc.text", expect: goodExpect } },
  ];
  const plan = resolveActionRefs({ actionRefs: [0, 1, 2], failingRef: 2 }, journal);
  assert.equal(plan.actions.length, 3);
  assert.equal(plan.failingIndex, 2);
  // The prediction must survive: replay has to re-check the claim, not just redo the keys.
  assert.deepEqual(plan.actions[2].expect, goodExpect);
});

test("resolveActionRefs drops a candidate whose references do not resolve", () => {
  const journal = [{ action: { type: "goto", surface: "doc" } }];
  assert.equal(resolveActionRefs({ actionRefs: [0, 7], failingRef: 0 }, journal), null, "out of range");
  assert.equal(resolveActionRefs({ actionRefs: [0], failingRef: 5 }, journal), null, "failing not among cited");
  assert.equal(resolveActionRefs({ actionRefs: [], failingRef: 0 }, journal), null, "empty");
  assert.equal(resolveActionRefs({ actionRefs: [0] }, journal), null, "no failingRef");
  assert.equal(resolveActionRefs({ actionRefs: [0.5], failingRef: 0.5 }, journal), null, "non-integer");
});

// --- redaction --------------------------------------------------------------

// The destination is a public repo. Every output boundary is guarded, including the one
// that carries an error message out of a crashed browser.
//
// THE SECRET IS DELIBERATELY SHAPELESS. `wfb_…` would have been caught by
// `redactSecrets`' own generic pattern, and any string near the word "token" by its
// keyword rule — so the first version of this test passed even with the run's live key
// never wired in at all. Mutation testing caught it: calling
// `redactSecrets(text, secrets)` with the old array signature, which silently delivers
// no `extra` whatsoever, still went green. An opaque value with no recognisable shape is
// the only thing that proves `extra` is connected.
test("secrets are redacted from every path out", async () => {
  const journal = [];
  const key = "Zq7mKp2wXn9rTvBc";
  const session = stubSession([
    { ok: true, value: `the value is ${key}`, oracles: [{ kind: "console-error", detail: `bad ${key}` }] },
    () => {
      throw new Error(`connect failed with ${key}`);
    },
  ]);
  const run = createUiTool({ session, budget: openBudget(), journal, surface: "doc", cfg: { apiKey: key } });

  const read = textOf(await run({ action: { type: "read", reader: "doc.text" } }));
  assert.ok(!read.includes(key), "not in a value, and not in an oracle detail");

  const fault = textOf(await run({ action: { type: "read", reader: "doc.text" } }));
  assert.ok(!fault.includes(key), "not in a session-fault message either");
});
