import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COVERAGE_KEY_VERSION,
  coverageFromJournal,
  mergeCoverage,
  renderCoverageBrief,
  selectionShape,
} from "./hunt-ui-coverage.mjs";

const click = (name) => ({ action: { type: "click", target: { role: "button", name } }, ok: true });
const read = (reader, value) => ({ action: { type: "read", reader }, ok: true, value });
const sel = (a, f, blockB) => read("doc.selection", { anchor: { blockId: "b1", offset: a }, focus: { blockId: blockB ?? "b1", offset: f } });

test("selectionShape names only what the readers can actually tell apart", () => {
  assert.equal(selectionShape(null), "none");
  assert.equal(selectionShape({ anchor: { blockId: "b1", offset: 3 }, focus: { blockId: "b1", offset: 3 } }), "collapsed");
  assert.equal(selectionShape({ anchor: { blockId: "b1", offset: 0 }, focus: { blockId: "b1", offset: 5 } }), "forward-range");
  // #715 and #749 both hid specifically in a RIGHT-TO-LEFT selection, so it is its own shape.
  assert.equal(selectionShape({ anchor: { blockId: "b1", offset: 5 }, focus: { blockId: "b1", offset: 0 } }), "backward-range");
  assert.equal(selectionShape({ anchor: { blockId: "b1", offset: 0 }, focus: { blockId: "b2", offset: 2 } }), "multi-block");
  assert.equal(selectionShape({ start: "B2", end: "B2" }), "cell");
  assert.equal(selectionShape({ start: "A1", end: "C3" }), "cell-range");
  // Anything unrecognised degrades rather than throwing — a reader that changes shape
  // must cost a stale memory, never a crashed run.
  for (const junk of [undefined, 7, "x", {}, { anchor: 1, focus: 2 }]) assert.equal(selectionShape(junk), "none");
});

test("a control applied once is NOT recorded as round-tripped", () => {
  // THE WHOLE POINT. Command-level coverage would mark Bold covered here and steer the
  // next run away from it — while #715 and #749 both live in Bold/Italic PAIRS.
  const c = coverageFromJournal([sel(0, 5), click("Bold")]);
  assert.deepEqual(c.shapes, [{ control: "Bold", shape: "forward-range", roundTripped: false }]);

  const round = coverageFromJournal([sel(0, 5), click("Bold"), click("Bold")]);
  assert.equal(round.shapes[0].roundTripped, true, "the same control twice IS the round trip");
});

test("the same control on a different selection shape is different coverage", () => {
  const c = coverageFromJournal([sel(0, 5), click("Bold"), click("Bold"), sel(5, 0), click("Bold")]);
  const byShape = Object.fromEntries(c.shapes.map((s) => [s.shape, s.roundTripped]));
  assert.deepEqual(byShape, { "forward-range": true, "backward-range": false },
    "round-tripped forward, only applied backward — the backward round trip is still unexplored");
});

test("an intervening mutation breaks the round trip", () => {
  // Bold, type, Bold is two applications, not an apply-and-reverse: the document moved
  // in between, so the second click cannot be undoing the first.
  const c = coverageFromJournal([sel(0, 5), click("Bold"), { action: { type: "type", text: "x" }, ok: true }, click("Bold")]);
  assert.equal(c.shapes[0].roundTripped, false);
  // A READ in between does not break it — observing is not acting.
  const withRead = coverageFromJournal([sel(0, 5), click("Bold"), read("doc.runs", []), click("Bold")]);
  assert.equal(withRead.shapes[0].roundTripped, true);
});

test("pairs of DIFFERENT controls are recorded, which the triple cannot express", () => {
  // #783 is heading -> list; #793 is a swatch -> None. Neither is same-control-twice.
  const c = coverageFromJournal([sel(0, 5), click("Heading 2"), click("Bulleted list")]);
  assert.deepEqual(c.pairs, ["Heading 2|Bulleted list"]);
  // A control repeated is a round trip, not a pair.
  assert.deepEqual(coverageFromJournal([sel(0, 5), click("Bold"), click("Bold")]).pairs, []);
});

test("readAfterMutation records the only way a stale-indicator defect is visible", () => {
  // #792 is destroyed by the wrong next step: any other style action repairs the stale
  // control. So "was it READ before anything else touched the document" is coverage.
  const looked = coverageFromJournal([click("Heading 2"), read("dom.snapshot", "x")]);
  assert.deepEqual(looked.readAfterMutation, ["Heading 2"]);

  const actedFirst = coverageFromJournal([click("Heading 2"), click("Bold"), read("dom.snapshot", "x")]);
  assert.deepEqual(actedFirst.readAfterMutation, ["Bold"], "Heading 2 was never observed before Bold moved on");
});

test("mergeCoverage unions, keeps roundTripped sticky, and drops a stale key version", () => {
  const older = coverageFromJournal([sel(0, 5), click("Bold"), click("Bold")], { sha: "aaa" });
  const newer = coverageFromJournal([sel(0, 5), click("Bold")], { sha: "bbb" });
  const merged = mergeCoverage(older, newer);
  assert.equal(merged.shapes.length, 1);
  assert.equal(merged.shapes[0].roundTripped, true, "a later apply-only run must not un-cover a round trip");
  assert.equal(merged.sha, "bbb", "the newest sha wins, so staleness is measured from the last run");

  // A key whose meaning changed cannot claim to have covered anything.
  const stale = { keyVersion: COVERAGE_KEY_VERSION - 1, shapes: [{ control: "Ghost", shape: "collapsed", roundTripped: true }] };
  assert.deepEqual(mergeCoverage(stale, newer).shapes.map((s) => s.control), ["Bold"]);
  // Junk on either side degrades to the other, never throws.
  for (const junk of [null, undefined, 7, "x", []]) {
    assert.equal(mergeCoverage(junk, newer).shapes.length, 1);
    assert.equal(mergeCoverage(newer, junk).shapes.length, 1);
  }
});

test("the rendered brief tells the explorer to vary WHAT it round-trips, not to stop", () => {
  // The one way this feature can backfire: trading depth for breadth. Every defect came
  // from the round trip; broad exploration that never repeated a control found nothing.
  const c = coverageFromJournal([sel(0, 5), click("Bold"), click("Bold"), click("Insert link")], { sha: "abc123def" });
  const md = renderCoverageBrief(c, { sha: "abc123def" });
  assert.match(md, /Do not stop round-tripping/i);
  assert.match(md, /ROUND-TRIPPED/);
  assert.match(md, /`Bold` on a forward-range selection/);
  assert.match(md, /NEVER REVERSED/, "applied-but-not-reversed must be called out as still unexplored");
  assert.match(md, /`Insert link`/);

  // A first run gets no heading with nothing under it.
  assert.equal(renderCoverageBrief(coverageFromJournal([])), "");
  assert.equal(renderCoverageBrief(null), "");
  assert.equal(renderCoverageBrief({ keyVersion: COVERAGE_KEY_VERSION - 1, shapes: [{ control: "X" }] }), "");

  // Staleness is disclosed rather than silently trusted.
  assert.match(renderCoverageBrief(c, { sha: "999999999" }), /describes a tree, not a promise/);
  assert.doesNotMatch(renderCoverageBrief(c, { sha: "abc123def" }), /describes a tree/);
});
