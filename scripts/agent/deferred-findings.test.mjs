import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADVISORY_CONCLUSIONS,
  DEFERRED_CHECK_NAME,
  DEFERRED_CONCLUSION,
  DEFERRED_SCHEMA,
  MAX_TEXT_CHARS,
  assertAdvisory,
  buildDeferredCheck,
  buildDeferredText,
  collectDeferred,
  deferredRecord,
  isDeferred,
  readLensFindings,
  renderDeferredSummary,
} from "./deferred-findings.mjs";
import { lensCheckNames } from "./prior-findings.mjs";

const CLI = fileURLToPath(new URL("./deferred-findings.mjs", import.meta.url));
const PANEL = "5ee400b4210b10ffe66765f66de7df51a6e7dbf0";
const tmp = () => mkdtempSync(path.join(tmpdir(), "deferred-findings-"));

/** A native minor: never reached the gate, so `annotateFindings` left it with no lane. */
const MINOR = { severity: "minor", confidence: "high", file: "a.mjs", line: 12, summary: "s", evidence: "e", claimType: "presence" };
/** A demoted major: reached the gate, routed to `backlog` by the novelty gate. */
const DEMOTED = { severity: "major", confidence: "medium", file: "b.mjs", line: 7, summary: "s2", evidence: "e2", lane: "backlog", novelty: { origin: "relocated" } };
/** A blocker that actually gates. Belongs to the OTHER channel and must never appear here. */
const BLOCKER = { severity: "major", confidence: "high", file: "c.mjs", line: 1, summary: "s3", evidence: "e3", lane: "blocking" };

// ---------------------------------------------------------------- the population

test("the two deferred populations are in, and gating blockers are not", () => {
  assert.equal(isDeferred(MINOR), true, "a native minor is deferred");
  assert.equal(isDeferred({ ...MINOR, severity: "nit" }), true, "a nit is deferred");
  assert.equal(isDeferred(DEMOTED), true, "a demoted major is deferred");
  assert.equal(isDeferred(BLOCKER), false, "a blocking finding is NOT deferred — it gates");
  assert.equal(isDeferred({ ...BLOCKER, lane: undefined }), false, "a blocker with no lane still gates");
  assert.equal(isDeferred({ severity: "critical", lane: "blocking" }), false, "a critical gates");
});

test("a critical demoted by the surface gate's carve-out cannot appear: it is never backlogged", () => {
  // `routeFinding` carves critical out of the surface gate ("A critical defect should
  // stop the PR wherever it lives"), so the only critical reaching this channel would
  // be one the NOVELTY gate demoted, which is a real population and correctly in.
  assert.equal(isDeferred({ severity: "critical", lane: "backlog", novelty: { origin: "relocated" } }), true);
});

test("an UNRECOGNISED severity is not quietly filed as deferred work", () => {
  // `normalizeSeverity` maps junk to `major` (fail-safe), so this channel inherits the
  // gate's own fail direction: unknown severity stays a blocker unless explicitly
  // demoted. The flattering bug would be treating it as non-blocking.
  assert.equal(isDeferred({ severity: "wobbly", summary: "s" }), false);
  assert.equal(isDeferred({ severity: undefined, summary: "s" }), false);
  assert.equal(isDeferred({ severity: "wobbly", lane: "backlog" }), true, "…but an explicit demotion still counts");
});

test("junk is not a finding", () => {
  for (const bad of [null, undefined, "minor", 3, [], [{ severity: "minor" }]]) {
    assert.equal(isDeferred(bad), false, `${JSON.stringify(bad)} was treated as a finding`);
  }
});

test("a refuted finding cannot reach this channel, and is not tested for", () => {
  // `keepUnrefuted` runs before `writeVerdict`, so `lane: "discarded"` is absent from
  // verdict.json by construction. If it ever DID appear it must not be recorded as
  // deferred work — the verifier decided it was wrong, which is not a deferral.
  assert.equal(isDeferred({ severity: "major", lane: "discarded" }), false);
});

// ---------------------------------------------------------------- the record

test("a native minor's record has NO lane, and a demoted one's says backlog", () => {
  const minor = deferredRecord(MINOR, "correctness");
  assert.equal("lane" in minor, false, "absence of a lane is the signal that it never reached the gate");
  assert.equal(deferredRecord(DEMOTED, "security").lane, "backlog");
});

test("novelty.origin and surface.scope are recorded SEPARATELY, and absent when unstamped", () => {
  // The two gates make opposite claims about the same code, so collapsing them loses
  // the reason. `severity.mjs::demotedBy` defaults to `relocated` for unstamped rows —
  // storing its answer would bake a default into the archive as if it were measured.
  const relocated = deferredRecord({ ...DEMOTED, novelty: { origin: "relocated" } }, "l");
  assert.equal(relocated.noveltyOrigin, "relocated");
  assert.equal("surfaceScope" in relocated, false);

  const outOfScope = deferredRecord({ severity: "major", lane: "backlog", surface: { scope: "out-of-scope" }, summary: "s" }, "l");
  assert.equal(outOfScope.surfaceScope, "out-of-scope");
  assert.equal("noveltyOrigin" in outOfScope, false, "an out-of-scope demotion must not be reported as relocated");

  const neither = deferredRecord(MINOR, "l");
  assert.equal("noveltyOrigin" in neither, false);
  assert.equal("surfaceScope" in neither, false);
});

test("no derived 'why deferred' discriminator is stored", () => {
  // Two ways to express one fact is two ways to disagree — `annotateFindings`' own
  // argument for refusing non-blockers a lane.
  const keys = new Set(Object.keys(deferredRecord(DEMOTED, "l")));
  for (const forbidden of ["deferral", "deferredBecause", "reason", "demotedBy", "population"]) {
    assert.equal(keys.has(forbidden), false, `${forbidden} is derivable from severity + lane and must not be stored`);
  }
});

test("line comes from findingLocation, so an omitted line is recovered from the evidence", () => {
  // The gating channel's projection has no `line` at all; this one must be navigable.
  assert.equal(deferredRecord(MINOR, "l").line, 12, "an explicit line is used");
  const cited = deferredRecord(
    { severity: "minor", file: "a.mjs", summary: "s", evidence: "see other.mjs:99 and a.mjs:42" },
    "l",
  );
  assert.equal(cited.line, 42, "the first SAME-FILE citation wins, not the first citation");
  const unplaceable = deferredRecord({ severity: "minor", file: "a.mjs", summary: "s", evidence: "no citation" }, "l");
  assert.equal("line" in unplaceable, false, "no location is absent, never a fabricated 0");
});

test("confidence is carried, and absent rather than invented when the lens omitted it", () => {
  assert.equal(deferredRecord(MINOR, "l").confidence, "high");
  assert.equal("confidence" in deferredRecord({ severity: "minor", summary: "s" }, "l"), false);
});

test("oversized model strings are clipped so one finding cannot spend the budget", () => {
  const r = deferredRecord({ severity: "minor", summary: "x".repeat(9000), evidence: "y".repeat(9000), file: "f".repeat(900) }, "l");
  assert.equal(r.summary.length, 2001, "2000 chars plus the ellipsis");
  assert.equal(r.evidence.length, 2001);
  assert.equal(r.file.length, 301);
});

// ---------------------------------------------------------------- aggregation

test("one record set for the whole panel, in manifest then per-lens order", () => {
  const records = collectDeferred([
    { lens: "correctness", findings: [MINOR, BLOCKER, DEMOTED] },
    { lens: "security", findings: [{ ...MINOR, severity: "nit" }] },
  ]);
  assert.deepEqual(records.map((r) => [r.lens, r.severity]), [
    ["correctness", "minor"],
    ["correctness", "major"],
    ["security", "nit"],
  ]);
});

test("a lens with no id, or junk findings, contributes nothing and does not throw", () => {
  assert.deepEqual(collectDeferred([{ lens: "", findings: [MINOR] }, { findings: [MINOR] }, { lens: "a", findings: null }, null]), []);
  assert.deepEqual(collectDeferred(null), []);
});

// ---------------------------------------------------------------- the trim tally

test("the tally is in the machine-readable channel, and text is an OBJECT so it can be", () => {
  const { text } = buildDeferredText([deferredRecord(MINOR, "l")], { panelSha: PANEL });
  const parsed = JSON.parse(text);
  assert.equal(parsed.schema, DEFERRED_SCHEMA);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.emitted, 1);
  assert.equal(parsed.omitted, 0);
  assert.equal(parsed.records.length, 1);
});

test("🔴 a trim that drops findings SAYS SO — total, emitted and omitted all survive it", () => {
  // The channel this is modelled on drops trailing findings until the string fits and
  // records nothing. "A silent truncation reads as 'this is everything'."
  const many = Array.from({ length: 60 }, (_, i) => deferredRecord({ ...MINOR, summary: `s${i}`.padEnd(300, "x") }, `l${i}`));
  const { text, total, emitted, omitted } = buildDeferredText(many, { panelSha: PANEL, maxChars: 4000 });
  assert.ok(text.length <= 4000, `text is ${text.length} chars, over budget`);
  assert.equal(total, 60);
  assert.ok(emitted < 60, "the fixture must actually overflow, or this test proves nothing");
  assert.equal(omitted, 60 - emitted);
  const parsed = JSON.parse(text);
  assert.equal(parsed.total, 60, "the count of what EXISTED survives the trim");
  assert.equal(parsed.omitted, 60 - emitted);
  assert.equal(parsed.records.length, emitted);
});

test("the trim keeps text PARSEABLE — it re-serialises rather than slicing the string", () => {
  const many = Array.from({ length: 200 }, (_, i) => deferredRecord({ ...MINOR, summary: `s${i}`.padEnd(500, "x") }, `l${i}`));
  const { text } = buildDeferredText(many, { panelSha: PANEL, maxChars: 3000 });
  assert.doesNotThrow(() => JSON.parse(text), "a sliced serialisation would not parse");
});

test("a budget too small for even one record floors at a truthful header, not a lie", () => {
  const many = Array.from({ length: 5 }, (_, i) => deferredRecord({ ...MINOR, summary: `s${i}` }, `l${i}`));
  const { text, total, emitted, omitted } = buildDeferredText(many, { panelSha: PANEL, maxChars: 1 });
  const parsed = JSON.parse(text);
  assert.equal(emitted, 0);
  assert.equal(total, 5);
  assert.equal(omitted, 5, "it reports losing all five rather than reporting none existed");
  assert.deepEqual(parsed.records, []);
});

test("the default budget is the gating channel's own 60k, and it is this channel's OWN", () => {
  assert.equal(MAX_TEXT_CHARS, 60000);
});

// ---------------------------------------------------------------- the generation stamp

test("🔴 the generation stamp rides once per run, not per record", () => {
  const { text } = buildDeferredText([deferredRecord(MINOR, "l"), deferredRecord(DEMOTED, "l")], { panelSha: PANEL });
  const parsed = JSON.parse(text);
  assert.equal(parsed.panel_sha, PANEL);
  for (const r of parsed.records) {
    assert.equal("panel_sha" in r, false, "a per-record stamp would be 40 bytes of budget per finding");
  }
});

test("🔴 an unresolvable generation stamp is null, never fabricated or partial", () => {
  // `severity` means whatever the rubric in force said it meant, so a WRONG stamp is
  // worse than none: it would claim these records are comparable to another run's.
  for (const bad of ["", null, undefined, "main", "HEAD", PANEL.slice(0, 12), `${PANEL}extra`, PANEL.toUpperCase()]) {
    const parsed = JSON.parse(buildDeferredText([deferredRecord(MINOR, "l")], { panelSha: bad }).text);
    assert.equal(parsed.panel_sha, null, `${JSON.stringify(bad)} was accepted as a generation stamp`);
  }
});

test("the stamp survives the trim — it is what makes the surviving records interpretable", () => {
  const many = Array.from({ length: 60 }, (_, i) => deferredRecord({ ...MINOR, summary: `s${i}`.padEnd(300, "x") }, `l${i}`));
  const parsed = JSON.parse(buildDeferredText(many, { panelSha: PANEL, maxChars: 4000 }).text);
  assert.equal(parsed.panel_sha, PANEL);
});

// ---------------------------------------------------------------- never gates

test("🔴 the check name is OUTSIDE the agent-review- namespace set-state.mjs reads by prefix", () => {
  assert.equal(DEFERRED_CHECK_NAME.startsWith("agent-review-"), false);
  // And it collides with no lens name the real manifest can produce.
  const manifest = JSON.parse(readFileSync(new URL("./lenses/lenses.json", import.meta.url), "utf8"));
  assert.equal(lensCheckNames(manifest).includes(DEFERRED_CHECK_NAME), false);
  assert.ok(manifest.length > 0, "the manifest must be non-empty or this proves nothing");
});

test("🔴 the conclusion is never a gating one", () => {
  assert.equal(DEFERRED_CONCLUSION, "neutral");
  assert.equal(ADVISORY_CONCLUSIONS.includes("failure"), false);
});

test("🔴 assertAdvisory REFUSES a name inside the lens namespace", () => {
  assert.throws(
    () => assertAdvisory({ name: "agent-review-deferred", conclusion: "neutral" }),
    /namespace/,
  );
  assert.doesNotThrow(() => assertAdvisory({ name: DEFERRED_CHECK_NAME, conclusion: DEFERRED_CONCLUSION }));
});

test("🔴 assertAdvisory REFUSES a gating conclusion", () => {
  for (const bad of ["failure", "action_required", "timed_out", "cancelled", "", null, undefined]) {
    assert.throws(
      () => assertAdvisory({ name: DEFERRED_CHECK_NAME, conclusion: bad }),
      /not advisory/,
      `conclusion ${JSON.stringify(bad)} was accepted`,
    );
  }
});

test("🔴 buildDeferredCheck emits a neutral, correctly-named payload and nothing else", () => {
  const check = buildDeferredCheck({
    lensFindings: [{ lens: "correctness", findings: [MINOR, BLOCKER, DEMOTED] }],
    panelSha: PANEL,
  });
  assert.equal(check.name, DEFERRED_CHECK_NAME);
  assert.equal(check.conclusion, "neutral");
  assert.equal(check.total, 2, "the blocker is not deferred");
  assert.equal(check.emitted, 2);
  assert.equal(check.omitted, 0);
  assert.match(check.output.title, /2 deferred/);
});

test("the title says when the record is partial, so the check list itself shows it", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ ...MINOR, summary: `s${i}`.padEnd(300, "x") }));
  const check = buildDeferredCheck({ lensFindings: [{ lens: "l", findings: many }], panelSha: PANEL, maxChars: 4000 });
  assert.match(check.output.title, /not recorded/);
});

// ---------------------------------------------------------------- the human body

test("the summary splits the two populations rather than pooling them", () => {
  const check = buildDeferredCheck({
    lensFindings: [{ lens: "correctness", findings: [MINOR, DEMOTED, { ...MINOR, severity: "nit" }] }],
    panelSha: PANEL,
  });
  assert.match(check.output.summary, /2 non-blocking, 1 demoted/);
  assert.match(check.output.summary, /never gates/);
  assert.match(check.output.summary, new RegExp(PANEL));
});

test("the summary states the omission when the record is partial", () => {
  const many = Array.from({ length: 60 }, (_, i) => deferredRecord({ ...MINOR, summary: `s${i}`.padEnd(300, "x") }, "l"));
  const { total, emitted, omitted } = buildDeferredText(many, { panelSha: PANEL, maxChars: 4000 });
  const md = renderDeferredSummary({ total, emitted, omitted, records: many.slice(0, emitted), panelSha: PANEL });
  assert.match(md, /PARTIAL/);
  assert.match(md, new RegExp(`${omitted} were dropped`));
});

test("an empty round says so, and still says it never gates", () => {
  const check = buildDeferredCheck({ lensFindings: [{ lens: "l", findings: [BLOCKER] }], panelSha: PANEL });
  assert.equal(check.total, 0);
  assert.match(check.output.summary, /None this round/);
  assert.match(check.output.summary, /never gates/);
  assert.equal(JSON.parse(check.output.text).records.length, 0);
});

// ---------------------------------------------------------------- reading verdict.json

test("readLensFindings reads the manifest's lenses and degrades to fewer, never throws", () => {
  const dir = path.join(tmp(), ".agent-review");
  mkdirSync(path.join(dir, "correctness"), { recursive: true });
  writeFileSync(path.join(dir, "correctness", "verdict.json"), JSON.stringify({ findings: [MINOR] }));
  mkdirSync(path.join(dir, "security"), { recursive: true });
  writeFileSync(path.join(dir, "security", "verdict.json"), "{ not json");
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "verdict.json"), JSON.stringify({ findings: "nope" }));
  // `blast-radius` has no directory at all — the lens never ran.
  const manifest = [{ id: "correctness" }, { id: "security" }, { id: "docs" }, { id: "blast-radius" }, { id: "" }];
  const got = readLensFindings(dir, manifest);
  assert.deepEqual(got.map((g) => [g.lens, g.findings.length]), [["correctness", 1], ["docs", 0]]);
});

// ---------------------------------------------------------------- end to end

test("END TO END: the CLI writes a guarded payload from a real .agent-review tree", () => {
  const root = tmp();
  const dir = path.join(root, ".agent-review");
  mkdirSync(path.join(dir, "correctness"), { recursive: true });
  writeFileSync(
    path.join(dir, "correctness", "verdict.json"),
    JSON.stringify({ findings: [MINOR, BLOCKER, DEMOTED], summary: "s", valid: true, conclusion: "failure" }),
  );
  const lenses = path.join(root, "lenses.json");
  writeFileSync(lenses, JSON.stringify([{ id: "correctness" }]));
  const out = path.join(root, "check.json");
  const stdout = execFileSync(
    process.execPath,
    [CLI, "--review-dir", dir, "--lenses", lenses, "--panel-sha", PANEL, "--out-json", out],
    { encoding: "utf8" },
  );
  assert.match(stdout, /2 deferred, 2 recorded, 0 omitted/);
  const check = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(check.name, DEFERRED_CHECK_NAME);
  assert.equal(check.conclusion, "neutral");
  const text = JSON.parse(check.output.text);
  assert.equal(text.panel_sha, PANEL);
  assert.equal(text.total, 2);
  assert.deepEqual(text.records.map((r) => r.severity), ["minor", "major"]);
  assert.equal("lane" in text.records[0], false, "the native minor keeps no lane through the whole pipeline");
  assert.equal(text.records[1].lane, "backlog");
  assert.equal(text.records[1].noveltyOrigin, "relocated");
});

test("END TO END: a missing manifest REFUSES rather than writing an empty record", () => {
  const root = tmp();
  const out = path.join(root, "check.json");
  assert.throws(
    () => execFileSync(
      process.execPath,
      [CLI, "--review-dir", root, "--lenses", path.join(root, "absent.json"), "--out-json", out],
      { encoding: "utf8", stdio: "pipe" },
    ),
    (e) => e.status === 1 && /cannot read/.test(String(e.stderr)),
    "an unreadable manifest must not produce a record that reads as 'nothing was deferred'",
  );
});
