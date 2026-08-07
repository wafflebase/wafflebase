import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

import {
  loadPersonas,
  validatePersona,
  selectPersonas,
  uiActionEvidence,
  uiCitationsOf,
  uiDefectKey,
  replayUiCandidate,
  renderUiRepro,
  renderUiReport,
  summarizeUiObservations,
  exploreUi,
  verifyUi,
  UI_GATE_OPTIONS,
  runHunt,
  replayPlanFor,
  replayDidRun,
} from "./hunt-ui.mjs";
import { coerceCandidates, isFilingVerdict, dropReason, UI_GROUNDS } from "./hunt-gate.mjs";
import { UI_SURFACES } from "./hunt-ui-tool.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHARTERS_UI = path.join(HERE, "charters-ui");

// --- the shipped personas ----------------------------------------------------

test("the shipped personas load and validate", () => {
  const personas = loadPersonas(CHARTERS_UI);
  assert.ok(personas.length >= 2, "at least one persona per surface");
  for (const p of personas) {
    assert.deepEqual(validatePersona(p), [], `${p.id} must validate`);
    assert.ok(p.rubric.length > 500, `${p.id} must carry a real rubric`);
  }
  // Every surface the tool can scope to has a persona, or that surface is
  // unreachable and the reader list for it is dead weight.
  const covered = new Set(personas.map((p) => p.surface));
  for (const s of UI_SURFACES) assert.ok(covered.has(s), `no persona explores \`${s}\``);
});

test("each persona's briefs are DIFFERENT, which is the whole point of briefs", () => {
  // Briefs replaced repeated identical samples when cross-sample agreement was
  // removed: two sessions are now for COVERAGE. Handing them the same instruction
  // silently reverts to the redundancy the change was made to escape.
  for (const p of loadPersonas(CHARTERS_UI)) {
    const tasks = p.briefs.map((b) => b.task);
    assert.equal(new Set(tasks).size, tasks.length, `${p.id} repeats a brief`);
  }
});

test("each rubric injects its OWN surface's constraints and not the other's", () => {
  const byId = Object.fromEntries(loadPersonas(CHARTERS_UI).map((p) => [p.id, p]));

  // The two measured traps, each stated on the surface it applies to. These are the
  // two false findings the protocol produced within minutes of first running, so a
  // rubric that stops mentioning them is a regression in a very specific way.
  assert.match(byId["sheet-author"].rubric, /canUndo/, "sheet rubric must name the undo reader");
  assert.match(byId["sheet-author"].rubric, /no-op|DOES NOT WORK/i, "sheet rubric must state undo is a no-op");
  assert.match(byId["doc-writer"].rubric, /per-keystroke/, "doc rubric must state undo is per-keystroke");

  // And the constraints must NOT bleed across: an explorer told about a toolbar it
  // cannot reach wastes budget discovering that.
  assert.doesNotMatch(byId["sheet-author"].rubric, /formatting toolbar is mounted/);
  assert.match(byId["sheet-author"].rubric, /no formatting toolbar/i);
});

test("every persona's codeScope and docsScope name paths that EXIST", () => {
  // A scope naming a directory that is not there is invisible: the persona runs, the
  // explorer works, candidates reproduce, and then every one of them dies at the
  // gate's citation stage because no citation can ever be in scope. It shipped once —
  // `packages/frontend/src/app/sheets/**`, which is actually `spreadsheet/`.
  const repoRoot = path.resolve(HERE, "..", "..");
  for (const p of loadPersonas(CHARTERS_UI)) {
    for (const glob of [...(p.codeScope ?? []), ...(p.docsScope ?? [])]) {
      // Check the fixed prefix before the first wildcard — that is the part that has
      // to exist on disk for anything under it to match.
      const fixed = glob.split("*")[0].replace(/\/$/, "");
      assert.ok(
        existsSync(path.join(repoRoot, fixed)),
        `${p.id}: scope "${glob}" points at ${fixed}, which does not exist`,
      );
    }
  }
});

test("each persona's codeScope covers the ENGINE its surface actually runs on", () => {
  // The frontend half is where the toolbar and the mount live; the engine half is
  // where the defect usually is. Losing either silently narrows what can be reported.
  const byId = Object.fromEntries(loadPersonas(CHARTERS_UI).map((p) => [p.id, p]));
  assert.ok(byId["doc-writer"].codeScope.some((g) => g.startsWith("packages/docs/src")));
  assert.ok(byId["sheet-author"].codeScope.some((g) => g.startsWith("packages/sheets/src")));
});

test("no rubric offers a visual ground", () => {
  // The agent has no screenshot action. A rubric that invites "looks wrong" invites
  // a claim that is ineligible under every ground and wastes the session producing
  // it — and a rubric is exactly where that would creep back in.
  for (const p of loadPersonas(CHARTERS_UI)) {
    assert.match(p.rubric, /no visual channel|cannot see/i, `${p.id} must say it cannot see`);
  }
});

// --- persona validation ------------------------------------------------------

const PERSONA = {
  id: "doc-writer",
  surface: "doc",
  briefs: [{ id: "a", task: "do a thing" }],
  oracles: ["prediction"],
  codeScope: ["packages/docs/src/**"],
  reportableSeverities: ["critical", "major"],
  verifiers: 2,
};

test("validatePersona fails LOUD on a misconfigured surface", () => {
  // A charter that cannot run must not look like a charter that found nothing. The
  // surface is the new failure mode: it selects which readers the explorer is even
  // shown, so a typo hands it an empty toolbox and it reports nothing, forever.
  assert.match(validatePersona({ ...PERSONA, surface: "docs" }).join(";"), /not one of/);
  assert.match(validatePersona({ ...PERSONA, surface: undefined }).join(";"), /not one of/);
  assert.match(validatePersona({ ...PERSONA, surface: "slides" }).join(";"), /not one of/);
  assert.deepEqual(validatePersona(PERSONA), []);
});

test("validatePersona rejects brief sets that would collide or say nothing", () => {
  assert.match(validatePersona({ ...PERSONA, briefs: [] }).join(";"), /missing briefs/);
  assert.match(
    validatePersona({ ...PERSONA, briefs: [{ id: "a", task: "x" }, { id: "a", task: "y" }] }).join(";"),
    /share an id/,
  );
  assert.match(validatePersona({ ...PERSONA, briefs: [{ id: "a", task: "   " }] }).join(";"), /missing its task/);
});

test("validatePersona refuses a turn ceiling that cannot reach the action budget", () => {
  // Found by the first live run, not by reasoning: `maxActions: 80` against
  // `explorerMaxTurns: 60` meant the turn ceiling bound first, so both briefs died
  // at `error_max_turns` after 61 turns having proposed nothing. $2.82 for two
  // sessions that were configured never to finish.
  const withBudget = (maxActions, explorerMaxTurns) => ({ ...PERSONA, actionBudget: { maxActions }, explorerMaxTurns });
  assert.match(validatePersona(withBudget(80, 60)).join(";"), /must exceed/);
  assert.match(validatePersona(withBudget(50, 50)).join(";"), /must exceed/, "equal is still unreachable");
  assert.deepEqual(validatePersona(withBudget(50, 70)), []);
  // Absent values are not a misconfiguration — both have defaults elsewhere.
  assert.deepEqual(validatePersona({ ...PERSONA }), []);
});

test("the shipped personas keep turns comfortably above actions", () => {
  // The CLI charters sit at 1.25-1.4x. Anything at or below 1x cannot succeed, and
  // barely above it wastes the run on sessions that end mid-exploration.
  for (const p of loadPersonas(CHARTERS_UI)) {
    const ratio = p.explorerMaxTurns / p.actionBudget.maxActions;
    assert.ok(ratio >= 1.2, `${p.id}: turns/actions is ${ratio.toFixed(2)}, too tight to finish`);
  }
});

test("validatePersona floors verifiers at 2", () => {
  assert.match(validatePersona({ ...PERSONA, verifiers: 1 }).join(";"), /verifiers must be >= 2/);
});

// --- selection ---------------------------------------------------------------

const P = (id, surface) => ({ id, surface });

test("selectPersonas: a surface filter EXCLUDES loudly rather than quietly", () => {
  // The single easiest new way to manufacture a zero that reads as a clean run.
  const all = [P("doc-writer", "doc"), P("sheet-author", "sheet")];
  const { selected, excluded } = selectPersonas(all, { surface: ["doc"] });
  assert.deepEqual(selected.map((p) => p.id), ["doc-writer"]);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].persona, "sheet-author");
  assert.equal(excluded[0].kind, "surface-filtered");
  assert.match(excluded[0].why, /limited to/);
});

test("selectPersonas: --charter exclusions are reported too", () => {
  const all = [P("doc-writer", "doc"), P("sheet-author", "sheet")];
  const { selected, excluded } = selectPersonas(all, { charter: ["sheet-author"] });
  assert.deepEqual(selected.map((p) => p.id), ["sheet-author"]);
  assert.equal(excluded[0].kind, "not-selected");
});

test("selectPersonas: no filters selects everything and excludes nothing", () => {
  const all = [P("doc-writer", "doc"), P("sheet-author", "sheet")];
  const { selected, excluded } = selectPersonas(all, {});
  assert.equal(selected.length, 2);
  assert.equal(excluded.length, 0);
  assert.equal(selectPersonas(all).selected.length, 2, "options are optional");
});

// --- evidence ----------------------------------------------------------------

const ACTIONS = [
  { type: "goto", surface: "doc" },
  { type: "read", reader: "doc.text" },
  { type: "type", text: "hello" },
];

test("uiActionEvidence accepts a real plan and names what is wrong with a bad one", () => {
  assert.equal(uiActionEvidence({ actions: ACTIONS, failingIndex: 2 }), null);
  assert.match(uiActionEvidence({ actions: [], failingIndex: 0 }), /no actions/);
  assert.match(uiActionEvidence({ failingIndex: 0 }), /no actions/);
  assert.match(uiActionEvidence({ actions: ACTIONS, failingIndex: 9 }), /out of range/);
  assert.match(uiActionEvidence({ actions: ACTIONS, failingIndex: "2" }), /out of range/);
  assert.match(uiActionEvidence({ actions: ACTIONS, failingIndex: -1 }), /out of range/);
});

test("uiActionEvidence re-validates the CLOSED action vocabulary at the gate", () => {
  // Defence in depth: every action came out of the journal and was validated on the
  // way in. The alternative is a gate that trusts a shape it never checked, and the
  // whole point of a closed vocabulary is that nothing reaches a browser unchecked.
  assert.match(uiActionEvidence({ actions: [{ type: "evaluate", js: "alert(1)" }], failingIndex: 0 }), /unsafe action plan/);
  assert.match(uiActionEvidence({ actions: [{ type: "click", target: { css: ".btn" } }], failingIndex: 0 }), /unsafe action plan/);
  assert.match(uiActionEvidence({ actions: [{ type: "read", reader: "window.fetch" }], failingIndex: 0 }), /unsafe action plan/);
});

test("coerceCandidates + uiActionEvidence: a UI candidate passes, a CLI-shaped one does not", () => {
  const ui = { title: "t", severity: "major", actions: ACTIONS, failingIndex: 2 };
  assert.equal(coerceCandidates([ui], { evidenceOf: uiActionEvidence }).kept.length, 1);
  // And the default (CLI) validator rejects it, so the two cannot be confused.
  assert.equal(coerceCandidates([ui]).kept.length, 0);
});

// --- citations come from the verifiers ---------------------------------------

test("uiCitationsOf reads groundedIn, and survives anything else", () => {
  const v = [{ groundedIn: ["packages/docs/src/a.ts:1"] }, { groundedIn: ["packages/docs/src/b.ts:2"] }];
  assert.deepEqual(uiCitationsOf({}, v), ["packages/docs/src/a.ts:1", "packages/docs/src/b.ts:2"]);
  for (const junk of [null, undefined, "x", [null], [{}], [{ groundedIn: "not an array" }]]) {
    assert.deepEqual(uiCitationsOf({}, junk), []);
  }
});

test("the verifier is told the scope and the path format it is the sole source of", () => {
  // The verifier supplies the ONLY citations the gate ever sees, so a verifier that
  // does not know the persona's codeScope — or writes a bare filename — produces a
  // confirmation that is silently dropped at stage 4 and a defect that goes
  // unreported. It has to be told, in the prompt, every run.
  let seenPrompt = "";
  const askImpl = {
    withRetry: (fn) => fn(),
    askStructured: async ({ prompt }) => { seenPrompt = prompt; return CONFIRMED; },
  };
  const persona = { ...FUNNEL_PERSONA, codeScope: ["packages/docs/src/**", "packages/frontend/src/app/docs/**"], minCitations: 2 };
  return verifyUi(
    { claimed: { severity: "major", title: "t", oracle: "prediction", expected: "e", observed: "o" }, replayEvidence: "" },
    persona,
    { repo: "/r", context: { issues: "" }, sessionLog: [], index: 0, askImpl },
  ).then(() => {
    for (const glob of persona.codeScope) {
      assert.ok(seenPrompt.includes(glob), `the prompt must name the scope glob ${glob}`);
    }
    assert.match(seenPrompt, /[Rr]epo-root-relative/);
    assert.match(seenPrompt, /path\/to\/file\.ext:LINE|file\.ext:LINE/);
    assert.match(seenPrompt, /At least 2 of them/, "the citation count must come from the persona");
    // And it must say what happens if the rules are broken, or the instruction reads
    // as style advice rather than a hard gate.
    assert.match(seenPrompt, /silently dropped by the gate/);
  });
});

test("the UI gate options report on a verifier-supplied citation and nothing else", () => {
  const persona = {
    oracles: ["prediction"],
    reportableSeverities: ["critical", "major"],
    verifiers: 2,
    minCitations: 1,
    codeScope: ["packages/docs/src/**"],
  };
  const record = {
    replay: { status: "reproduced", deterministic: true },
    claimed: { oracle: "prediction", severity: "major", title: "t", expected: "e", observed: "o" },
  };
  const ok = {
    verdict: "confirmed",
    confidence: "high",
    reason: "r",
    confirmationGround: "expectation-violated",
    groundedIn: ["packages/docs/src/editor.ts:12"],
    duplicateOf: null,
  };
  assert.equal(isFilingVerdict(record, [ok, ok], persona, UI_GATE_OPTIONS), true);
  assert.equal(dropReason(record, [ok, ok], persona, UI_GATE_OPTIONS), null);

  // The candidate carries NO citations of its own, so without the UI options the
  // same record cannot report — which is the property that makes the explorer's
  // missing `citations` field safe rather than a hole.
  assert.equal(isFilingVerdict(record, [ok, ok], persona), false);

  // An out-of-scope groundedIn still fails stage 4.
  const outside = { ...ok, groundedIn: ["packages/sheets/src/other.ts:3"] };
  assert.equal(isFilingVerdict(record, [outside, outside], persona, UI_GATE_OPTIONS), false);

  // And a CLI ground is not a UI ground.
  const cliGround = { ...ok, confirmationGround: "doc-contradicts-code" };
  assert.equal(isFilingVerdict(record, [cliGround, cliGround], persona, UI_GATE_OPTIONS), false);
  assert.ok(UI_GROUNDS.has("expectation-violated"));
});

// --- defect identity ---------------------------------------------------------

const JOURNAL = [
  { action: { type: "goto", surface: "doc" }, oracles: [] },
  { action: { type: "read", reader: "doc.text" }, oracles: [] },
  {
    action: {
      type: "click",
      target: { role: "button", name: "Increase font size" },
      expect: { read: "doc.fontSizes", op: "each-greater-than", value: "@read:1", ground: "A" },
    },
    oracles: [],
  },
  { action: { type: "type", text: "x" }, oracles: [{ kind: "dom-invariant", rule: "duplicate-id" }] },
];

test("uiDefectKey identifies a prediction defect by reader/op/ground, not by prose", () => {
  const key = uiDefectKey({ failingRef: 2 }, JOURNAL, { personaId: "doc-writer" });
  assert.equal(key, "doc-writer|click|doc.fontSizes|each-greater-than|A");

  // Two DIFFERENT titles for the same broken thing collapse — which is the point,
  // since two briefs describing one defect will not word it the same way.
  const other = uiDefectKey({ failingRef: 2 }, JOURNAL, { personaId: "doc-writer" });
  assert.equal(key, other);
});

test("uiDefectKey falls back to WHICH oracle fired when there is no prediction", () => {
  assert.equal(
    uiDefectKey({ failingRef: 3 }, JOURNAL, { personaId: "doc-writer" }),
    "doc-writer|type|oracles:dom-invariant:duplicate-id",
  );
});

test("uiDefectKey returns '' — unlocatable — rather than a key that means nothing", () => {
  // An empty key is the signal the caller records as a drop. Inventing a key from a
  // candidate with no prediction and no oracle would let it dedupe against, and
  // suppress, unrelated candidates.
  const bare = [{ action: { type: "type", text: "x" }, oracles: [] }];
  assert.equal(uiDefectKey({ failingRef: 0 }, bare, { personaId: "p" }), "");
  assert.equal(uiDefectKey({ failingRef: 9 }, bare, { personaId: "p" }), "", "out of range");
  assert.equal(uiDefectKey({}, bare, { personaId: "p" }), "", "no failingRef");
  assert.equal(uiDefectKey({ failingRef: 0 }, null, { personaId: "p" }), "", "no journal");
  // A half-formed expect is not a prediction identity either.
  const partial = [{ action: { type: "click", expect: { read: "doc.text" } }, oracles: [] }];
  assert.equal(uiDefectKey({ failingRef: 0 }, partial, { personaId: "p" }), "");
});

test("uiDefectKey separates personas, so one cannot suppress another's finding", () => {
  const a = uiDefectKey({ failingRef: 2 }, JOURNAL, { personaId: "doc-writer" });
  const b = uiDefectKey({ failingRef: 2 }, JOURNAL, { personaId: "other" });
  assert.notEqual(a, b);
});

// --- replay wiring -----------------------------------------------------------
//
// The single easiest thing in the orchestrator to get silently wrong, and the
// failure is invisible from outside: replay still says `reproduced`, just about a
// weaker claim than the one being reported.

const obs = (over = {}) => ({ index: 0, action: { type: "type" }, ok: true, value: "a", oracles: [], ...over });

test("replayUiCandidate folds EVERY observation, not just the failing one", () => {
  const first = [obs({ value: "a" }), obs({ value: "b" }), obs({ value: "c" })];
  // Three attempts identical to the first: reproduced.
  const same = replayUiCandidate(ACTIONS, first, {
    repo: "/nope",
    runPlan: () => [first, first, first],
  });
  assert.equal(same.status, "reproduced");
  assert.equal(same.deterministic, true);

  // Now diverge on an observation that is NOT the failing one. A key over a single
  // observation would call this reproduced; folding the whole plan must not.
  const drifted = [obs({ value: "a" }), obs({ value: "DIFFERENT" }), obs({ value: "c" })];
  const diverged = replayUiCandidate(ACTIONS, first, {
    repo: "/nope",
    runPlan: () => [first, drifted, first],
  });
  assert.equal(diverged.deterministic, false);
  assert.equal(diverged.status, "non-deterministic");
});

test("replayUiCandidate: attempts that agree with each other but not the claim do not reproduce", () => {
  const first = [obs({ value: "a" })];
  const other = [obs({ value: "z" })];
  const rep = replayUiCandidate(ACTIONS, first, { repo: "/nope", runPlan: () => [other, other, other] });
  assert.equal(rep.deterministic, true, "the attempts agreed");
  assert.equal(rep.status, "not-reproduced", "...but not with what was claimed");
});

test("replayUiCandidate: an empty attempt fails CLOSED", () => {
  // Without this, `observedKey(undefined)` yields an empty-shape key, every empty
  // attempt agrees, and a claim that is also empty-shaped replays as reproduced
  // without a browser having done anything.
  const first = [obs()];
  const rep = replayUiCandidate(ACTIONS, first, { repo: "/nope", runPlan: () => [[], [], []] });
  assert.notEqual(rep.status, "reproduced");
});

test("replayUiCandidate folds the PREDICTION's measured value into the key", () => {
  // A violation is computed FROM `actual`. A key blind to it would let replay
  // confirm a different reading as the same observation — the determinism gate
  // checking everything except the number the finding rests on.
  const first = [obs({ actual: [11, 18, 32] })];
  const changed = [obs({ actual: [11, 11, 11] })];
  const rep = replayUiCandidate(ACTIONS, first, { repo: "/nope", runPlan: () => [changed, changed, changed] });
  assert.equal(rep.status, "not-reproduced");
});

// --- report ------------------------------------------------------------------

test("renderUiRepro emits a runnable command over the plan that actually ran", () => {
  const md = renderUiRepro(ACTIONS, { planPath: ".harness-reports/hunt-ui/doc-writer/repro-1.json" });
  assert.match(md, /node scripts\/agent\/hunt-ui\.mjs replay --plan \.harness-reports/);
  // The plan is rendered from the actions, never authored, so it round-trips.
  const json = JSON.parse(md.slice(md.indexOf("{"), md.lastIndexOf("}") + 1));
  assert.deepEqual(json.actions, ACTIONS);
});

const STATS = { proposed: 1, unique: 1, novel: 1, reproduced: 1, refutedAfterReplay: 0, cappedUnverified: 0, reported: 0 };

test("renderUiReport: a filtered-out persona is reported as NOT a clean bill of health", () => {
  const md = renderUiReport({
    runId: "r",
    headSha: "s",
    personas: ["doc-writer"],
    reported: [],
    dropped: [],
    stats: STATS,
    skipped: [{ persona: "sheet-author", kind: "surface-filtered", why: "limited to `doc`" }],
  });
  assert.match(md, /Personas that did NOT run \(1\)/);
  assert.match(md, /not a clean bill of health/);
  assert.match(md, /sheet-author/);
});

test("renderUiReport: no skip section when everything ran", () => {
  const md = renderUiReport({ runId: "r", headSha: "s", personas: ["p"], reported: [], dropped: [], stats: STATS });
  assert.doesNotMatch(md, /did NOT run/);
  assert.match(md, /No candidates reported/);
});

test("renderUiReport: what the cap dropped is SHOWN, not merely counted", () => {
  const md = renderUiReport({
    runId: "r",
    headSha: "s",
    personas: ["p"],
    reported: [],
    dropped: [{ title: "capped one", why: "verification cap reached", capped: true, reproduced: true, claimed: { oracle: "prediction", severity: "major", expected: "e", observed: "o" } }],
    stats: { ...STATS, cappedUnverified: 1 },
  });
  assert.match(md, /Reproduced but not verified — cap reached \(1\)/);
  assert.match(md, /capped one/);
});

test("renderUiReport marks a SEEDED run before anything that reads as a finding", () => {
  // A seeded run fabricates its findings on purpose. A report that looks identical to
  // a real hunt is how one of them gets filed, and the stderr banner does not survive
  // into the artifact a human reads later.
  const md = renderUiReport({
    runId: "r",
    headSha: "s",
    personas: ["doc-writer"],
    reported: [],
    dropped: [],
    stats: STATS,
    fault: "drop-second-char",
  });
  assert.match(md, /SEEDED RUN — NOT A HUNT/);
  assert.match(md, /MANUFACTURED and must not be filed/);
  assert.match(md, /drop-second-char/);
  // The success criterion, stated where the person reading the report will see it.
  // A seeded run that gets REFUTED is the control passing: the fault lives in this
  // repository, so a verifier that reads source will always attribute it to the
  // harness. Measured — four independent verifier sessions did exactly that, citing
  // `page.tsx:112-128`. Without this line a reader sees `0 reported` and concludes
  // the pipeline is broken.
  assert.match(md, /refutation here is SUCCESS/i);
  assert.match(md, /blinding the\n> verifier|blinding the verifier/);
  // Before the funnel, and therefore before any finding.
  assert.ok(md.indexOf("SEEDED RUN") < md.indexOf("## Funnel"), "the warning must precede the results");

  // And absent entirely on a real run, or the warning becomes noise nobody reads.
  const clean = renderUiReport({ runId: "r", headSha: "s", personas: ["p"], reported: [], dropped: [], stats: STATS });
  assert.doesNotMatch(clean, /SEEDED RUN/);
});

test("renderUiReport REDACTS at the egress boundary", () => {
  // The published-report boundary. Per-block renderers redact nothing on their own,
  // so a token echoed inside `observed` or the drop table would otherwise reach a
  // public repo on generic patterns alone.
  const secret = "sk-ant-oat01-ZZZZZZZZZZZZZZZZZZZZ";
  const md = renderUiReport({
    runId: "r",
    headSha: "s",
    personas: ["p"],
    reported: [
      {
        personaId: "p",
        briefId: "b",
        surface: "doc",
        defectKey: "k",
        claimed: { severity: "major", title: "t", oracle: "prediction", expected: `leaked ${secret}`, observed: "o" },
        actions: ACTIONS,
        groundedIn: [],
        secrets: [secret],
      },
    ],
    dropped: [{ title: "d", why: `also ${secret}`, secrets: [secret] }],
    stats: STATS,
  });
  assert.doesNotMatch(md, /ZZZZZZZZZZZZ/, "the token must not survive into the report");
});

test("renderUiReport says the location came from the verifiers", () => {
  const md = renderUiReport({
    runId: "r",
    headSha: "s",
    personas: ["p"],
    reported: [
      {
        personaId: "p",
        briefId: "b",
        surface: "doc",
        defectKey: "k",
        claimed: { severity: "major", title: "t", oracle: "prediction", expected: "e", observed: "o" },
        actions: ACTIONS,
        groundedIn: ["packages/docs/src/a.ts:1"],
        prediction: { read: "doc.text", op: "contains", value: "@input:2", ground: "A", verdict: "violated" },
      },
    ],
    dropped: [],
    stats: { ...STATS, reported: 1 },
  });
  // A reader must not go looking for an explorer citation that was never collected.
  assert.match(md, /located by the verifiers/);
  assert.match(md, /packages\/docs\/src\/a\.ts:1/);
  assert.match(md, /doc\.text.*contains.*violated/);
});

test("summarizeUiObservations shows the prediction's measured value to the VERIFIER", () => {
  // The explorer never sees `actual` — that asymmetry is what stops it rationalising
  // a violated prediction into a weaker claim. The verifier is a different party and
  // needs the number to judge whether the expectation was reasonable at all.
  const text = summarizeUiObservations([obs({ actual: [11, 11, 11], oracles: [{ kind: "console-error", detail: "boom" }] })], ACTIONS);
  assert.match(text, /prediction read: \[11,11,11\]/);
  assert.match(text, /\[console-error\] boom/);
});

// --- session lifetime --------------------------------------------------------

test("exploreUi always closes its session, including when the model throws", async () => {
  // A leaked session here is a leaked Chromium AND a leaked Vite — worse than the
  // leaked scratch directory the CLI hunter guards the same way.
  let closed = 0;
  const session = { act: async () => ({ ok: true }), close: async () => { closed += 1; } };
  const persona = { id: "p", title: "P", surface: "doc", rubric: "r", actionBudget: {} };
  const brief = { id: "b", task: "t" };
  const askImpl = {
    withRetry: (fn) => fn(),
    askStructured: async () => { throw new Error("model exploded"); },
  };
  await assert.rejects(
    exploreUi(persona, brief, {
      repo: "/nope",
      context: { deferrals: "", issues: "", cfg: {} },
      sessionLog: [],
      openSession: async () => session,
      askImpl,
      createServerImpl: async () => ({}),
    }),
    /model exploded/,
  );
  assert.equal(closed, 1, "the session must be closed even when the session body throws");
});

test("exploreUi's prompt carries the persona's rubric and THIS brief's task", async () => {
  const session = { act: async () => ({ ok: true }), close: async () => {} };
  const persona = { id: "p", title: "P", surface: "doc", rubric: "RUBRIC-MARKER", actionBudget: { maxActions: 5 } };
  const brief = { id: "b", task: "TASK-MARKER" };
  let seenPrompt = "";
  const askImpl = {
    withRetry: (fn) => fn(),
    askStructured: async ({ prompt }) => {
      seenPrompt = prompt;
      return { candidates: [], summary: "nothing" };
    },
  };
  const out = await exploreUi(persona, brief, {
    repo: "/nope",
    context: { deferrals: "", issues: "", cfg: {} },
    sessionLog: [],
    openSession: async () => session,
    askImpl,
    createServerImpl: async () => ({}),
  });
  assert.deepEqual(out.out.candidates, []);
  // The brief's task and the persona's rubric both reach the model, or a persona's
  // briefs are decoration and every session explores the same way.
  assert.match(seenPrompt, /RUBRIC-MARKER/);
  assert.match(seenPrompt, /TASK-MARKER/);
  assert.match(seenPrompt, /at most 5 browser actions/);
});

test("exploreUi returns the journal the REAL tool wrote", async () => {
  // This test used to stub `createServerImpl` away entirely and then assert
  // `Array.isArray(out.journal)` — which is true of the empty array the stub leaves
  // behind, so it could not fail. It asserted the name of a property nothing in the
  // test exercised.
  //
  // `createUiTool` is pure (no SDK, no zod, no browser), so the real journal writer
  // can be driven here. Now the assertion has something to be wrong about.
  const { createUiTool } = await import("./hunt-ui-tool.mjs");
  const persona = { id: "p", title: "P", surface: "doc", rubric: "r", actionBudget: { maxActions: 5 } };
  const session = {
    act: async (action) => (action.type === "read" ? { ok: true, value: "hello world" } : { ok: true, value: null }),
    close: async () => {},
  };

  const out = await exploreUi(persona, { id: "b", task: "t" }, {
    repo: "/nope",
    context: { deferrals: "", issues: "", cfg: {} },
    sessionLog: [],
    openSession: async () => session,
    // The REAL tool, over the real journal array exploreUi allocated.
    createServerImpl: async (opts) => ({ __tool: createUiTool(opts) }),
    askImpl: {
      withRetry: (fn) => fn(),
      askStructured: async ({ mcpServers }) => {
        const tool = mcpServers.wafflebase.__tool;
        await tool({ action: { type: "goto", surface: "doc" } });
        await tool({ action: { type: "read", reader: "doc.text" } });
        return { candidates: [], summary: "s" };
      },
    },
  });

  assert.equal(out.journal.length, 2, "every tool call must land in the journal exploreUi returns");
  assert.equal(out.journal[0].action.type, "goto");
  assert.equal(out.journal[1].action.reader, "doc.text");
  assert.equal(out.journal[1].value, "hello world", "the journal holds what the session actually read");
  assert.equal(out.actionCount, 2, "the budget counted both actions");
});

test("exploreUi gives each RETRY a fresh session, journal and budget", async () => {
  // Documented as a correctness property and previously untested, because every stub
  // used `withRetry: (fn) => fn()` — which never retries.
  //
  // The property matters concretely: the model in a second attempt counts its actions
  // from 0, so `actionRefs: [0]` resolved against a journal still holding the FIRST
  // attempt's entries would ship a reproduction of something else entirely. The
  // honesty of every candidate depends on the journal describing exactly one session.
  const { createUiTool } = await import("./hunt-ui-tool.mjs");
  const opened = [];
  const closed = [];
  let attempt = 0;

  const out = await exploreUi(
    { id: "p", title: "P", surface: "doc", rubric: "r", actionBudget: { maxActions: 5 } },
    { id: "b", task: "t" },
    {
      repo: "/nope",
      context: { deferrals: "", issues: "", cfg: {} },
      sessionLog: [],
      openSession: async () => {
        const id = opened.length;
        const session = { id, act: async () => ({ ok: true, value: `from-session-${id}` }), close: async () => closed.push(id) };
        opened.push(session);
        return session;
      },
      createServerImpl: async (opts) => ({ __tool: createUiTool(opts) }),
      askImpl: {
        // A real retry: first attempt throws, second succeeds.
        withRetry: async (fn) => {
          try {
            return await fn();
          } catch {
            return await fn();
          }
        },
        askStructured: async ({ mcpServers }) => {
          const tool = mcpServers.wafflebase.__tool;
          await tool({ action: { type: "read", reader: "doc.text" } });
          if (attempt++ === 0) throw new Error("transient API error");
          await tool({ action: { type: "read", reader: "doc.blockCount" } });
          return { candidates: [], summary: "s" };
        },
      },
    },
  );

  assert.equal(opened.length, 2, "the retry must open a NEW session");
  assert.ok(closed.includes(0), "the abandoned attempt's session must be closed — it is a Chromium and a Vite");
  assert.equal(closed.length, 2, "and the surviving one closes too");

  // The returned journal describes the SECOND attempt only. If it held both, index 0
  // would point at the abandoned session's read.
  assert.equal(out.journal.length, 2, "the journal must not accumulate across attempts");
  assert.equal(out.journal[0].value, "from-session-1", "index 0 must belong to the surviving session");
  assert.equal(out.actionCount, 2, "the budget resets with the journal, or the retry starts already spent");
});

// --- the whole funnel, with stubs -------------------------------------------
//
// The glue between stages is where integration risk lives, and it was previously
// reachable only through a ~$15 live run — which means it was never
// integration-tested at all. These drive `runHunt` end to end with a stubbed
// explorer, verifier and runner: no browser, no SDK, no network, no spend.

const FUNNEL_PERSONA = {
  id: "doc-writer",
  title: "Docs writer",
  surface: "doc",
  rubric: "r",
  oracles: ["prediction"],
  codeScope: ["packages/docs/src/**"],
  reportableSeverities: ["critical", "major"],
  verifiers: 2,
  minCitations: 1,
  maxVerified: 4,
  briefs: [{ id: "b1", task: "t1" }],
};

// A journal shaped exactly as the tool writes one: read a baseline, then type while
// predicting the document still contains what was typed earlier.
const FUNNEL_JOURNAL = [
  { action: { type: "goto", surface: "doc" }, ok: true, value: "doc", oracles: [] },
  { action: { type: "read", reader: "doc.text" }, ok: true, value: "seed", oracles: [] },
  { action: { type: "type", text: "ABCDEF" }, ok: true, value: null, oracles: [] },
  {
    action: {
      type: "type",
      text: "!",
      expect: { read: "doc.text", op: "contains", value: "@input:2", ground: "A", because: "it must still be there" },
    },
    ok: true,
    value: null,
    oracles: [],
    // Written by `createUiTool` via `assessExpectation` — the ONLY place a verdict
    // exists. The report reads it from here, not from the observation.
    prediction: { verdict: "violated", eligible: true, detail: 'expected to contain "ABCDEF", read "ACE"' },
  },
];

const FUNNEL_CANDIDATE = {
  oracle: "prediction",
  severity: "major",
  title: "typed text does not survive",
  expected: "the document contains ABCDEF",
  observed: "it contains ACE",
  actionRefs: [0, 1, 2, 3],
  failingRef: 3,
};

const CONFIRMED = {
  verdict: "confirmed",
  confidence: "high",
  reason: "the input handler drops alternate keys",
  confirmationGround: "expectation-violated",
  groundedIn: ["packages/docs/src/view/text-editor.ts:44"],
  duplicateOf: null,
};

/** Observations shaped as the runner returns them, stable across attempts. */
const FUNNEL_OBS = FUNNEL_JOURNAL.map((e, i) => ({
  index: i,
  action: e.action,
  ok: true,
  value: e.value,
  oracles: [],
  // NO `verdict` here, deliberately. The runner reports `actual` and stops; the
  // verdict is `assessExpectation`'s, written into the JOURNAL. A fixture that
  // invents one on the observation is exactly how the "always unknown" bug hid.
  ...(e.action.expect ? { actual: "ACE" } : {}),
}));

function funnelDeps(over = {}) {
  const written = new Map();
  return {
    written,
    deps: {
      personas: [FUNNEL_PERSONA],
      repo: "/repo",
      outDir: "/out",
      runId: "run1",
      headSha: "sha1",
      seen: [],
      context: { deferrals: "", issues: "", cfg: {} },
      sessionLog: [],
      exploreImpl: async () => ({
        out: { candidates: [FUNNEL_CANDIDATE], summary: "s" },
        journal: FUNNEL_JOURNAL,
        actionCount: 4,
        refusals: [],
      }),
      verifyImpl: async () => CONFIRMED,
      runPlanImpl: (_plan, { attempts = 1 } = {}) => Array.from({ length: attempts }, () => FUNNEL_OBS),
      writeArtifact: (file, body) => written.set(file, body),
      ...over,
    },
  };
}

test("runHunt carries a real candidate all the way to a report", async () => {
  const { written, deps } = funnelDeps();
  const out = await runHunt(deps);

  assert.equal(out.stats.proposed, 1);
  assert.equal(out.stats.unique, 1);
  assert.equal(out.stats.novel, 1);
  assert.equal(out.stats.reproduced, 1);
  assert.equal(out.stats.reported, 1, "a confirmed, reproduced, grounded candidate must report");
  assert.equal(out.stats.refutedAfterReplay, 0);
  assert.equal(out.dropped.length, 0);

  // The citation on the record came from the VERIFIER, since the explorer supplies none.
  assert.deepEqual(out.reported[0].groundedIn, [CONFIRMED.groundedIn[0], CONFIRMED.groundedIn[0]]);

  // The prediction verdict comes from the JOURNAL, where `assessExpectation` wrote
  // it — not from the observation, which has no `verdict` field at all. Reading it
  // off the observation made every reported finding say "unknown", and nothing
  // failed because the fixture had invented the field.
  assert.equal(out.reported[0].prediction.verdict, "violated");
  assert.equal(out.reported[0].prediction.eligible, true);
  assert.match(out.reported[0].prediction.detail, /ABCDEF/);
  // ...alongside the expectation itself, so a reader sees what was claimed and how
  // it was judged in one place.
  assert.equal(out.reported[0].prediction.read, "doc.text");
  assert.equal(out.reported[0].prediction.ground, "A");
  // The repro plan is written before the report names it, so the command can never
  // point at a file that does not exist.
  const planFile = [...written.keys()].find((f) => f.includes("repro-1.json"));
  assert.ok(planFile, "a repro plan must be written");
  assert.deepEqual(JSON.parse(written.get(planFile)).actions, FUNNEL_JOURNAL.map((e) => e.action));
  assert.ok(out.reported[0].planPath.endsWith("repro-1.json"));

  // And the ledger records the disposition, so the next run does not re-report it.
  assert.equal(out.ledgerAdds.length, 1);
  assert.equal(out.ledgerAdds[0].verdict, "reported");
});

test("runHunt forwards the seeded fault to the explorer AND to every replay", async () => {
  // The exact failure this PR exists to fix, one layer up: the fault was accepted at
  // the top and silently dropped before the thing that needed it. Exploration and
  // replay must BOTH be seeded, or the candidate is found in a faulted browser and
  // then replayed in a clean one — which would look like a flaky finding rather than
  // like a broken control.
  const exploreFaults = [];
  const replayFaults = [];
  const { deps } = funnelDeps({
    fault: "drop-second-char",
    exploreImpl: async (_p, _b, opts) => {
      exploreFaults.push(opts.fault);
      return { out: { candidates: [FUNNEL_CANDIDATE], summary: "s" }, journal: FUNNEL_JOURNAL, actionCount: 4, refusals: [] };
    },
    runPlanImpl: (_plan, opts) => {
      replayFaults.push(opts.fault);
      return Array.from({ length: opts.attempts ?? 1 }, () => FUNNEL_OBS);
    },
  });
  await runHunt(deps);

  assert.deepEqual(exploreFaults, ["drop-second-char"], "the explorer must run seeded");
  assert.ok(replayFaults.length >= 2, "replay runs at least a claim pass and a determinism pass");
  for (const f of replayFaults) {
    assert.equal(f, "drop-second-char", "EVERY replay must run seeded, or the finding cannot reproduce");
  }
});

test("runHunt on a CLEAN run seeds nothing, anywhere", async () => {
  const seen = [];
  const { deps } = funnelDeps({
    exploreImpl: async (_p, _b, opts) => {
      seen.push(opts.fault);
      return { out: { candidates: [], summary: "s" }, journal: FUNNEL_JOURNAL, actionCount: 4, refusals: [] };
    },
  });
  await runHunt(deps);
  assert.deepEqual(seen, [null], "a normal hunt must never run against an injected defect");
});

test("runHunt: a SEEDED run writes NOTHING to the ledger", async () => {
  // The stated safety property of the whole positive-control design. The ledger is
  // keyed on the DEFECT, not the run, so recording a manufactured finding as
  // "reported" would suppress a real one with the same reader/op/ground on a later
  // run — a control that blinds the instrument it validates.
  const { deps } = funnelDeps({ fault: "drop-second-char" });
  const out = await runHunt(deps);

  assert.equal(out.stats.reported, 1, "the seeded run still reports — that is what it proves");
  assert.deepEqual(out.ledgerAdds, [], "but it must teach the ledger nothing");
  assert.equal(out.seeded, "drop-second-char", "and it must SAY it was seeded, for cmdRun and the report");

  // The identical run without the fault does record — otherwise the assertion above
  // would pass for a pipeline that never writes a ledger entry at all.
  const clean = await runHunt(funnelDeps().deps);
  assert.equal(clean.stats.reported, 1);
  assert.equal(clean.ledgerAdds.length, 1, "a real run MUST record, or dedupe across runs is dead");
  assert.equal(clean.seeded, null);
});

test("runHunt: a seeded run discards DROP entries too, not just reported ones", async () => {
  // Every ledger write is suppression. A seeded run's refuted candidate would
  // otherwise record a "dropped" verdict against a real defect key.
  const { deps } = funnelDeps({
    fault: "drop-second-char",
    verifyImpl: async () => ({ ...CONFIRMED, verdict: "refuted" }),
  });
  const out = await runHunt(deps);
  assert.equal(out.stats.refutedAfterReplay, 1);
  assert.deepEqual(out.ledgerAdds, []);
});

test("runHunt: a refuted candidate counts as refutedAfterReplay, the precision signal", async () => {
  const { deps } = funnelDeps({ verifyImpl: async () => ({ ...CONFIRMED, verdict: "refuted" }) });
  const out = await runHunt(deps);
  assert.equal(out.stats.reported, 0);
  assert.equal(out.stats.refutedAfterReplay, 1);
  assert.match(out.dropped[0].why, /refuted/);
  assert.equal(out.ledgerAdds[0].verdict, "dropped");
});

test("runHunt: an ERRORED verifier drops but is NOT recorded, so it is retried", async () => {
  // The distinction that cost the CLI hunter two real findings: a crashed verifier
  // produced no opinion, and writing that to the ledger would blind the next run.
  const { deps } = funnelDeps({ verifyImpl: async () => { throw new Error("API error"); } });
  const out = await runHunt(deps);
  assert.equal(out.stats.reported, 0);
  assert.equal(out.stats.refutedAfterReplay, 0, "infrastructure failure is not a refutation");
  assert.match(out.dropped[0].why, /NOT recorded, will be retried/);
  assert.equal(out.ledgerAdds.length, 0, "an unjudged candidate must stay eligible");
});

test("replayPlanFor replays the journal PREFIX, not the cited subset", () => {
  // The false-reproduction bug, in one assertion. A model cites the actions that
  // DEMONSTRATE its finding, not the ones that set up the state — all three
  // candidates in the first live run cited ranges starting at 9 or 32, none
  // including the opening `goto`.
  const cand = { actionRefs: [2, 3], failingRef: 3 };
  const plan = replayPlanFor(cand, FUNNEL_JOURNAL);
  assert.equal(plan.actions.length, 4, "the prefix runs from action 0, not from the first citation");
  assert.equal(plan.actions[0].type, "goto", "without this the browser never navigates and no reader works");
  assert.equal(plan.failingIndex, 3, "and the failing action keeps its journal position");
  // Out-of-range or missing refs yield no plan rather than a truncated one.
  assert.equal(replayPlanFor({ failingRef: 99 }, FUNNEL_JOURNAL), null);
  assert.equal(replayPlanFor({ failingRef: -1 }, FUNNEL_JOURNAL), null);
  assert.equal(replayPlanFor({}, FUNNEL_JOURNAL), null);
});

test("replayDidRun refuses a run in which nothing worked", () => {
  // Three attempts that all fail IDENTICALLY agree perfectly, so `uiPlanKey` matches
  // and `replay()` scores them `reproduced` + `deterministic`. That is exactly how a
  // browser which never navigated produced 3/3 on every candidate.
  const failed = [
    { ok: false, error: "hunt bridge is not installed" },
    { ok: false, error: "hunt bridge is not installed" },
  ];
  assert.equal(replayDidRun(failed), false, "all-failed is not a reproduction");
  assert.equal(replayDidRun([]), false);
  assert.equal(replayDidRun(null), false);
  // One success is enough — a click that missed among working actions is DATA, and
  // refusing those would discard real findings.
  assert.equal(replayDidRun([{ ok: false, error: "click missed" }, { ok: true, value: "x" }]), true);
});

test("runHunt drops a candidate whose replay never exercised the app", async () => {
  // End to end: the guard has to bite in the pipeline, not just in isolation.
  const allFailed = FUNNEL_JOURNAL.map((e, i) => ({ index: i, action: e.action, ok: false, error: "hunt bridge is not installed", oracles: [] }));
  let verifierCalls = 0;
  const { deps } = funnelDeps({
    runPlanImpl: (_p, { attempts = 1 } = {}) => Array.from({ length: attempts }, () => allFailed),
    verifyImpl: async () => { verifierCalls += 1; return CONFIRMED; },
  });
  const out = await runHunt(deps);
  assert.equal(out.stats.reproduced, 0, "identical failures must not score as a reproduction");
  assert.equal(out.stats.reported, 0);
  assert.equal(verifierCalls, 0, "and no verifier tokens are spent on it");
  assert.match(out.dropped[0].why, /never exercised the app/);
});

test("runHunt replays the prefix, so a candidate citing no goto still navigates", async () => {
  const plans = [];
  const { deps } = funnelDeps({
    exploreImpl: async () => ({
      // Cites only the last two actions — the shape every live candidate had.
      out: { candidates: [{ ...FUNNEL_CANDIDATE, actionRefs: [2, 3], failingRef: 3 }], summary: "s" },
      journal: FUNNEL_JOURNAL,
      actionCount: 4,
      refusals: [],
    }),
    runPlanImpl: (plan, { attempts = 1 } = {}) => {
      plans.push(plan.actions.map((a) => a.type));
      return Array.from({ length: attempts }, () => FUNNEL_OBS);
    },
  });
  const out = await runHunt(deps);
  assert.ok(plans.length > 0, "replay must have run");
  for (const p of plans) {
    assert.equal(p[0], "goto", `every replayed plan must start by navigating, got ${JSON.stringify(p)}`);
    assert.equal(p.length, 4, "the whole prefix, not the citation");
  }
  assert.equal(out.stats.reported, 1);
  // And the repro file a maintainer runs is the plan that actually reproduces.
  assert.equal(out.reported[0].actions[0].type, "goto");
});

test("runHunt: a candidate that does not replay never reaches a verifier", async () => {
  let verifierCalls = 0;
  const drift = FUNNEL_OBS.map((o, i) => (i === 1 ? { ...o, value: "DIFFERENT" } : o));
  let call = 0;
  const { deps } = funnelDeps({
    // First run returns the claim; the replay attempts diverge.
    runPlanImpl: (_p, { attempts = 1 } = {}) => {
      call += 1;
      return Array.from({ length: attempts }, () => (call === 1 ? FUNNEL_OBS : drift));
    },
    verifyImpl: async () => { verifierCalls += 1; return CONFIRMED; },
  });
  const out = await runHunt(deps);
  assert.equal(out.stats.reproduced, 0);
  assert.equal(out.stats.reported, 0);
  assert.equal(verifierCalls, 0, "verification must not be spent on something that did not reproduce");
  assert.match(out.dropped[0].why, /replay: not-reproduced/);
});

test("runHunt: the verification cap truncates and SAYS SO, without touching the ledger", async () => {
  const many = Array.from({ length: 3 }, (_u, i) => ({
    ...FUNNEL_CANDIDATE,
    title: `defect ${i}`,
    // Distinct predictions, or dedupe would collapse them into one.
    actionRefs: [0, 1, 2, 3],
  }));
  // Give each candidate its own failing action so the defect keys differ.
  // `because` is REQUIRED on a prediction — `assertSafeActionPlan` rejects the whole
  // plan without it. Worth stating rather than just satisfying: a first draft of this
  // fixture omitted it, both candidates were dropped as malformed, and the test read
  // as "dedupe collapsed them" instead of "the fixture was invalid".
  const journal = [
    ...FUNNEL_JOURNAL,
    { action: { type: "type", text: "y", expect: { read: "doc.blockCount", op: "equals", value: "@read:1", ground: "A", because: "adding text must not change the block count" } }, ok: true, value: null, oracles: [] },
    { action: { type: "type", text: "z", expect: { read: "doc.linkCount", op: "equals", value: "@read:1", ground: "A", because: "typing plain text must not create a link" } }, ok: true, value: null, oracles: [] },
  ];
  many[1].failingRef = 4;
  many[1].actionRefs = [0, 1, 2, 4];
  many[2].failingRef = 5;
  many[2].actionRefs = [0, 1, 2, 5];
  const obs = journal.map((e, i) => ({ index: i, action: e.action, ok: true, value: e.value, oracles: [], ...(e.action.expect ? { actual: "ACE" } : {}) }));

  const { deps } = funnelDeps({
    personas: [{ ...FUNNEL_PERSONA, maxVerified: 2 }],
    exploreImpl: async () => ({ out: { candidates: many, summary: "s" }, journal, actionCount: 6, refusals: [] }),
    runPlanImpl: (plan, { attempts = 1 } = {}) =>
      Array.from({ length: attempts }, () => plan.actions.map((a, i) => obs.find((o) => o.action === a) ?? obs[i])),
  });
  const out = await runHunt(deps);
  assert.equal(out.stats.unique, 3, "three distinct predictions must not dedupe together");
  assert.equal(out.stats.reported, 2);
  assert.equal(out.stats.cappedUnverified, 1);
  const capped = out.dropped.find((d) => d.capped);
  assert.ok(capped, "the capped candidate must be marked so the report can show it");
  assert.match(capped.why, /NOT recorded, will be retried/);
  // Two ledger entries for the two reported, none for the capped one.
  assert.equal(out.ledgerAdds.length, 2);
});

test("runHunt: a candidate citing actions that never happened is dropped, not repaired", async () => {
  const { deps } = funnelDeps({
    exploreImpl: async () => ({
      out: { candidates: [{ ...FUNNEL_CANDIDATE, actionRefs: [0, 99], failingRef: 99 }], summary: "s" },
      journal: FUNNEL_JOURNAL,
      actionCount: 4,
      refusals: [],
    }),
  });
  const out = await runHunt(deps);
  assert.equal(out.stats.reported, 0);
  assert.match(out.dropped[0].why, /cited actions that did not happen/);
});

test("runHunt: a failed brief becomes a visible skip, not a silent zero", async () => {
  const { deps } = funnelDeps({ exploreImpl: async () => { throw new Error("chromium died"); } });
  const out = await runHunt(deps);
  assert.equal(out.stats.reported, 0);
  const skip = out.skipped.find((s) => s.kind === "session-failed");
  assert.ok(skip, "a crashed session must be reported as never having run");
  assert.match(skip.why, /chromium died/);
  // And the report says so, so a zero cannot read as a clean bill of health.
  const md = renderUiReport({ runId: "r", headSha: "s", personas: ["doc-writer"], ...out });
  assert.match(md, /Personas that did NOT run/);
});

test("runHunt PERSISTS the journal of a brief that failed", async () => {
  // The first live run's whole diagnostic loss. Both briefs hit `error_max_turns`,
  // and because `briefResults` only collected successes, `explore-raw.json` was
  // written as `[]` — no way to tell an explorer that was predicting well and ran
  // out of room from one that spent sixty turns achieving nothing.
  //
  // A failed brief is the MOST likely thing to need diagnosing, so it is the last
  // thing whose evidence should be discarded.
  const partial = [
    { action: { type: "goto", surface: "doc" }, ok: true, value: "doc", oracles: [] },
    { action: { type: "read", reader: "doc.text" }, ok: true, value: "seed", oracles: [] },
  ];
  const { written, deps } = funnelDeps({
    exploreImpl: async () => {
      const err = new Error("hunt-ui query hit a run limit: error_max_turns after 61 turns");
      err.journal = partial;
      err.actionCount = 2;
      err.refusals = [{ kind: "surface-scope", detail: "reader sheet.cellValue belongs to another surface" }];
      throw err;
    },
  });
  const out = await runHunt(deps);

  const rawFile = [...written.keys()].find((f) => f.endsWith("explore-raw.json"));
  assert.ok(rawFile, "explore-raw.json must still be written");
  const raw = JSON.parse(written.get(rawFile));
  assert.equal(raw.length, 1, "the failed brief must appear, not be omitted");
  assert.match(raw[0].failed, /error_max_turns/, "and must SAY it did not finish");
  assert.equal(raw[0].journal.length, 2, "with the actions it did manage");
  assert.equal(raw[0].refusals.length, 1, "and its refusals, which explain wasted budget");

  // The actions it ran still count in the funnel — they DID happen.
  assert.equal(out.stats.actionsRun, 2);
  assert.equal(out.stats.actionRefusals, 1);
  // But it contributes no candidates, and is still a visible skip.
  assert.equal(out.stats.proposed, 0);
  assert.ok(out.skipped.some((s) => s.kind === "session-failed"));
});

test("exploreUi attaches its partial journal to the error it throws", async () => {
  // The other half: `runHunt` can only persist what `exploreUi` hands it.
  const { createUiTool } = await import("./hunt-ui-tool.mjs");
  const session = { act: async () => ({ ok: true, value: "read-it" }), close: async () => {} };
  const err = await exploreUi(
    { id: "p", title: "P", surface: "doc", rubric: "r", actionBudget: { maxActions: 5 } },
    { id: "b", task: "t" },
    {
      repo: "/nope",
      context: { deferrals: "", issues: "", cfg: {} },
      sessionLog: [],
      openSession: async () => session,
      createServerImpl: async (opts) => ({ __tool: createUiTool(opts) }),
      askImpl: {
        withRetry: (fn) => fn(),
        askStructured: async ({ mcpServers }) => {
          await mcpServers.wafflebase.__tool({ action: { type: "read", reader: "doc.text" } });
          throw new Error("error_max_turns");
        },
      },
    },
  ).then(() => null, (e) => e);

  assert.ok(err, "it must still throw — a failed brief is not a successful one");
  assert.equal(err.journal.length, 1, "the action it managed must survive the throw");
  assert.equal(err.journal[0].value, "read-it");
  assert.equal(err.actionCount, 1);
  assert.ok(Array.isArray(err.refusals));
});

test("runHunt: the ledger suppresses a defect already dispositioned", async () => {
  const dk = uiDefectKey({ failingRef: 3 }, FUNNEL_JOURNAL, { personaId: "doc-writer" });
  const { deps } = funnelDeps({ seen: [{ fp: dk, keyVersion: 1, charterId: "doc-writer", verdict: "dropped", sha: "old" }] });
  const out = await runHunt(deps);
  assert.equal(out.stats.novel, 0);
  assert.equal(out.stats.reported, 0);
  assert.match(out.dropped[0].why, /already seen in a previous run/);
});

test("runHunt: raw proposals AND the journal are persisted before any filtering", async () => {
  // For a run that reports nothing, what the model actually did is the only thing
  // that explains why — and it is not recoverable from the candidates it withheld.
  const { written, deps } = funnelDeps({
    exploreImpl: async () => ({ out: { candidates: [], summary: "found nothing" }, journal: FUNNEL_JOURNAL, actionCount: 4, refusals: [] }),
  });
  await runHunt(deps);
  const rawFile = [...written.keys()].find((f) => f.endsWith("explore-raw.json"));
  assert.ok(rawFile, "explore-raw.json must be written even on a zero-candidate run");
  const raw = JSON.parse(written.get(rawFile));
  assert.equal(raw[0].summary, "found nothing");
  assert.equal(raw[0].journal.length, 4, "the journal must ride along");
});

// --- static-import guard (the thing that broke CI on #600) -------------------

test("hunt-ui.mjs static-imports nothing third-party", () => {
  // `agent:tests` runs with scripts/agent/node_modules ABSENT. Any static import of
  // the SDK or zod makes this whole file unloadable in that lane, which is exactly
  // how #600 broke CI. ask.mjs's recursive walk guards the directory; this pins the
  // orchestrator specifically because it is the file most tempted to import the SDK.
  const src = readFileSync(path.join(HERE, "hunt-ui.mjs"), "utf8");
  const statics = [...src.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  for (const spec of statics) {
    assert.ok(
      spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("node:"),
      `static import of ${spec} — third-party imports must be lazy (await import)`,
    );
  }
});
