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

test("sheet.activeCell's bare sref is a cell selection, not an absent one", () => {
  // KEY VERSION 4. This reader answers `"A1"`, and for a year that classified as `none`
  // because only objects were understood — 7 of the sheet persona's 12 live entries were
  // keyed that way, and it is the reader the explorer reaches for most.
  for (const sref of ["A1", "B2", "C210", "ZZZ1000000"]) {
    assert.equal(selectionShape(sref), "cell", `${sref} is a cell reference`);
  }
  // Same state, two readers, one key: `sheet.selectionRange` on a single cell already
  // reported `cell`, and splitting them would make one selection cover two entries.
  assert.equal(selectionShape("B2"), selectionShape({ start: "B2", end: "B2" }));
  // Still shape-matched, so a string that is not a reference degrades as before rather
  // than inventing coverage for whatever a changed reader starts returning.
  for (const junk of ["x", "a1", "1A", "A", "12", "A1:B2", "", "Sheet1!A1"]) {
    assert.equal(selectionShape(junk), "none", `${JSON.stringify(junk)} is not a cell reference`);
  }
});

test("a slides selection reading keys coverage by element shape, not as none", () => {
  // The other half of #847's array branch. `selectionShape` understanding a list is
  // useless if no reader is wired to feed it one — the surface would key every action
  // `none`, which is exactly the bug that fix was for.
  const pick = (ids) => ({ action: { type: "read", reader: "slides.selection" }, ok: true, value: ids });
  const one = coverageFromJournal([pick(["badge"]), click("Arrange")]);
  assert.deepEqual(one.shapes, [{ control: "Arrange", shape: "element", roundTripped: false, sha: null }]);

  const many = coverageFromJournal([pick(["badge", "card"]), click("Arrange")]);
  assert.equal(many.shapes[0].shape, "element-multi", "one element and several are different coverage");

  const empty = coverageFromJournal([pick([]), click("Add slide")]);
  assert.equal(empty.shapes[0].shape, "none", "nothing selected really is `none`");
});

test("a list of selected ids is an element selection", () => {
  // Nothing returns this yet — it is the shape a canvas surface reports, where selection
  // is a set of objects rather than a span. Ordered before the object branches because an
  // array IS an object: without that, every reading would have answered `none`, which is
  // the exact failure `sheet.activeCell` just spent a year in.
  assert.equal(selectionShape([]), "none");
  assert.equal(selectionShape(["el-1"]), "element");
  assert.equal(selectionShape(["el-1", "el-2"]), "element-multi");
  assert.equal(selectionShape(["el-1", "el-2", "el-3"]), "element-multi");
});

const failedClick = (name) => ({
  action: { type: "click", target: { role: "button", name } },
  ok: false,
  error: "locator.click: Timeout 30000ms exceeded",
});

test("a DRAG between two clicks of a control is not a round trip", () => {
  // A drag changes the document, so it breaks a run of clicks exactly as typing does. Counted
  // as a non-mutation, the two Bold clicks read as apply-then-reverse with nothing in between
  // and the memory records a round trip that never happened — then steers the next run away
  // from the reversal it believes was already tested.
  const drag = () => ({
    action: {
      type: "drag",
      target: { reader: "slides.elementCenter", args: ["badge"] },
      to: { reader: "slides.pointAt", args: [700, 800] },
    },
    ok: true,
  });
  const spoiled = coverageFromJournal([sel(0, 5), click("Bold"), drag(), click("Bold")]);
  assert.equal(
    spoiled.shapes.find((x) => x.control === "Bold")?.roundTripped,
    false,
    "something happened between the two clicks, so the second is a fresh application",
  );

  // The control case: with nothing in between it IS a round trip.
  const real = coverageFromJournal([sel(0, 5), click("Bold"), click("Bold")]);
  assert.equal(real.shapes.find((x) => x.control === "Bold")?.roundTripped, true);
});

test("a click that did not land records no coverage at all", () => {
  // 7 of the 280 clicks across this repository's runs failed, and every one of them was
  // recorded as tried — `Text style`, `Text alignment`, `Heading 2⌘+⌥2`, `Right⌘+⇧R` and
  // two off-screen `sheet.cellCenter` refusals.
  const c = coverageFromJournal([sel(0, 5), failedClick("Text style")]);
  assert.deepEqual(c.shapes, [], "a click that threw explored nothing");
  assert.deepEqual(c.pairs, []);
  assert.deepEqual(c.readAfterMutation, []);
});

test("a failed click leaves its control on the NEVER TRIED list", () => {
  // THE CONSEQUENCE THAT COST SOMETHING. Striking a control off this list is permanent
  // and it is the most valuable line in the brief, so a control the explorer never once
  // managed to click must stay on offer.
  const inv = {
    action: { type: "read", reader: "dom.controls" },
    ok: true,
    value: [
      { role: "button", name: "Bold" },
      { role: "button", name: "Text style" },
    ],
  };
  const md = renderCoverageBrief(coverageFromJournal([inv, sel(0, 5), click("Bold"), failedClick("Text style")]));
  assert.match(md, /NEVER TRIED/);
  assert.match(md, /`Text style`/, "the click threw, so nothing about it was explored");
  assert.doesNotMatch(
    md.slice(md.indexOf("NEVER TRIED")),
    /`Bold`/,
    "Bold DID land, so it is not untried",
  );
});

test("a failed click does not break the round trip it sits inside", () => {
  // A no-op has to be a no-op in both directions. The click changed nothing, so
  // Bold -> (threw) -> Bold is still apply-then-reverse with nothing in between; treating
  // the failure as an intervening mutation would hide the round trip as well as the
  // failure, which is the more expensive of the two mistakes.
  const c = coverageFromJournal([sel(0, 5), click("Bold"), failedClick("Italic"), click("Bold")]);
  assert.deepEqual(c.shapes, [{ control: "Bold", shape: "forward-range", roundTripped: true, sha: null }]);
  assert.deepEqual(c.pairs, [], "a click that never landed is not half of a sequence");
});

test("a failed click does not consume the read that follows a real mutation", () => {
  // #792's shape is a mutation whose effect was observed BEFORE anything else touched the
  // document. A click that threw touched nothing, so it must not count as the something
  // else that spoils it.
  const c = coverageFromJournal([
    sel(0, 5),
    click("Heading 2"),
    failedClick("Text style"),
    read("doc.runs", []),
  ]);
  assert.deepEqual(c.readAfterMutation.map((x) => x.control), ["Heading 2"]);
});

test("a control applied once is NOT recorded as round-tripped", () => {
  // THE WHOLE POINT. Command-level coverage would mark Bold covered here and steer the
  // next run away from it — while #715 and #749 both live in Bold/Italic PAIRS.
  const c = coverageFromJournal([sel(0, 5), click("Bold")]);
  assert.deepEqual(c.shapes, [{ control: "Bold", shape: "forward-range", roundTripped: false, sha: null }]);

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
  assert.deepEqual(c.pairs.map((x) => x.pair), ["Heading 2|Bulleted list"]);
  // A control repeated is a round trip, not a pair.
  assert.deepEqual(coverageFromJournal([sel(0, 5), click("Bold"), click("Bold")]).pairs, []);
  // A non-click mutation breaks the PAIR chain too: two clicks separated by typing are
  // not the adjacency this list claims to record.
  const typed = coverageFromJournal([click("Bold"), { action: { type: "type", text: "x" }, ok: true }, click("Italic")]);
  assert.deepEqual(typed.pairs, [], "typing between two different clicks must not record a pair");
  const shortcut = coverageFromJournal([click("Bold"), { action: { type: "key", key: "Enter" }, ok: true }, click("Italic")]);
  assert.deepEqual(shortcut.pairs, [], "a keypress breaks it for the same reason");
});

test("readAfterMutation records the only way a stale-indicator defect is visible", () => {
  // #792 is destroyed by the wrong next step: any other style action repairs the stale
  // control. So "was it READ before anything else touched the document" is coverage.
  const looked = coverageFromJournal([click("Heading 2"), read("dom.snapshot", "x")]);
  assert.deepEqual(looked.readAfterMutation.map((x) => x.control), ["Heading 2"]);

  const actedFirst = coverageFromJournal([click("Heading 2"), click("Bold"), read("dom.snapshot", "x")]);
  assert.deepEqual(actedFirst.readAfterMutation.map((x) => x.control), ["Bold"], "Heading 2 was never observed before Bold moved on");
});

test("mergeCoverage unions, keeps roundTripped sticky, and drops a stale key version", () => {
  const older = coverageFromJournal([sel(0, 5), click("Bold"), click("Bold")], { sha: "aaa" });
  const newer = coverageFromJournal([sel(0, 5), click("Bold")], { sha: "bbb" });
  const merged = mergeCoverage(older, newer);
  assert.equal(merged.shapes.length, 1);
  assert.equal(merged.shapes[0].roundTripped, true, "a later apply-only run must not un-cover a round trip");
  assert.equal(merged.shapes[0].sha, "bbb", "an entry re-touched at a newer tree carries the newer sha");

  // A key whose meaning changed cannot claim to have covered anything.
  const stale = { keyVersion: COVERAGE_KEY_VERSION - 1, shapes: [{ control: "Ghost", shape: "collapsed", roundTripped: true }] };
  assert.deepEqual(mergeCoverage(stale, newer).shapes.map((s) => s.control), ["Bold"]);
  // Junk on either side degrades to the other, never throws.
  for (const junk of [null, undefined, 7, "x", []]) {
    assert.equal(mergeCoverage(junk, newer).shapes.length, 1);
    assert.equal(mergeCoverage(newer, junk).shapes.length, 1);
  }
});

test("a key-version bump keeps WHICH CONTROLS were used, so untried stays honest", () => {
  // THE REGRESSION THIS EXISTS FOR, measured on the live sheet memory at the 3 -> 4 bump.
  // `untried` is `inventory` MINUS the used controls. Carrying the inventory across a bump
  // while dropping the used-set made the brief announce the ENTIRE surface as never
  // tried — including `Bold`, round-tripped many times, and `Undo`, which the sheet rubric
  // calls the single most likely false finding on that surface.
  const stale = {
    keyVersion: COVERAGE_KEY_VERSION - 1,
    shapes: [
      { control: "Bold", shape: "cell", roundTripped: true },
      { control: "Italic", shape: "cell-range", roundTripped: true },
    ],
    inventory: [
      { role: "button", control: "Bold", sha: "old1" },
      { role: "button", control: "Italic", sha: "old1" },
      { role: "button", control: "Paint format", sha: "old1" },
    ],
  };
  const merged = mergeCoverage(stale, { keyVersion: COVERAGE_KEY_VERSION, shapes: [], inventory: [] });

  assert.deepEqual(merged.shapes, [], "a shape key that changed meaning still claims nothing");
  assert.deepEqual(merged.usedControls, ["Bold", "Italic"], "but WHICH controls were clicked survives");

  const md = renderCoverageBrief(merged);
  const neverTried = md.slice(md.indexOf("NEVER TRIED"));
  assert.match(neverTried, /`Paint format`/, "a genuinely untouched control is still offered");
  assert.doesNotMatch(neverTried, /`Bold`/, "a control that HAS been clicked must not be offered as never tried");
  assert.doesNotMatch(neverTried, /`Italic`/);
});

test("usedControls survives a bump even with no shapes to derive it from", () => {
  // A record written AFTER this change carries the list directly, so a second bump must
  // read it from there rather than re-deriving from shapes that are already gone.
  const twiceStale = { keyVersion: COVERAGE_KEY_VERSION - 2, usedControls: ["Bold"], shapes: [], inventory: [] };
  assert.deepEqual(mergeCoverage(twiceStale, { keyVersion: COVERAGE_KEY_VERSION }).usedControls, ["Bold"]);
});

test("coverageFromJournal records usedControls alongside the shape keys", () => {
  const c = coverageFromJournal([sel(0, 5), click("Bold"), click("Italic")]);
  assert.deepEqual(c.usedControls, ["Bold", "Italic"]);
});

test("a key-version bump drops shapes but KEEPS the control inventory", () => {
  // `keyVersion` versions the SHAPE key. The inventory is keyed `role|name`, which no
  // bump has changed the meaning of, and it is the expensive half of this memory to
  // rebuild — top-level controls come back on the next run's first `dom.controls` read,
  // but menu items only reappear when someone opens that menu again.
  const stale = {
    keyVersion: COVERAGE_KEY_VERSION - 1,
    shapes: [{ control: "Ghost", shape: "collapsed", roundTripped: true }],
    inventory: [
      { role: "button", control: "Clear formatting", sha: "old111111" },
      { role: "menuitemcheckbox", control: "Courier New", sha: "old111111" },
    ],
  };
  const merged = mergeCoverage(stale, { keyVersion: COVERAGE_KEY_VERSION, shapes: [], inventory: [] });

  assert.deepEqual(merged.shapes, [], "a shape key that changed meaning claims nothing");
  assert.deepEqual(
    merged.inventory.map((x) => x.control),
    ["Clear formatting", "Courier New"],
    "the denominator survives — it is what makes NEVER TRIED computable at all",
  );
  // Carrying `role|name` forward must not smuggle a stale `control|shape` claim past the
  // version gate; that is the one thing the gate exists to stop.
  assert.equal(merged.shapes.length, 0);
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

test("staleness is per ENTRY, because a record-level sha under-warns", () => {
  // The failure this shape exists to avoid: one sha for the whole record takes the
  // NEWEST run's, so a memory whose last run was minutes ago discloses nothing while
  // the entries inside it may be forty commits old. Under-warning costs a missed defect.
  const old = coverageFromJournal([sel(0, 5), click("Bold")], { sha: "old111111" });
  const fresh = coverageFromJournal([sel(0, 5), click("Italic")], { sha: "new222222" });
  const merged = mergeCoverage(old, fresh);

  const bySha = Object.fromEntries(merged.shapes.map((x) => [x.control, x.sha]));
  assert.deepEqual(bySha, { Bold: "old111111", Italic: "new222222" }, "each entry keeps its own tree");

  const md = renderCoverageBrief(merged, { sha: "new222222" });
  assert.match(md, /`Bold` on a forward-range selection — last seen at `old111111`/, "the stale one is marked");
  assert.doesNotMatch(md, /`Italic` on a forward-range selection — last seen/, "the current one is not");
  assert.match(md, /describes a tree, not a promise/);

  // Pairs and readAfterMutation carry provenance too, so a reader never has to know
  // which lists happen to have it.
  const p = coverageFromJournal([click("Heading 2"), click("Bulleted list")], { sha: "aaa111111" });
  assert.equal(p.pairs[0].sha, "aaa111111");
  assert.equal(coverageFromJournal([click("Bold"), read("doc.runs", [])], { sha: "bbb222222" }).readAfterMutation[0].sha, "bbb222222");
});

test("a malformed record degrades to empty coverage instead of killing the run", () => {
  // renderCoverageBrief sits on the path that assembles the explorer's prompt, so a
  // hand-edited or truncated coverage file must cost a repeated experiment, never a
  // dead run. It threw a TypeError on a null entry before this.
  const withJunk = {
    keyVersion: COVERAGE_KEY_VERSION,
    shapes: [null, 7, { control: "" }, { control: "Bold", shape: "forward-range", roundTripped: true, sha: "aaa" }],
    pairs: [null, "not-an-object", { pair: "Bold|Italic", sha: "aaa" }],
    readAfterMutation: [undefined, { control: "Bold", sha: "aaa" }],
  };
  const md = renderCoverageBrief(withJunk, { sha: "aaa" });
  assert.match(md, /`Bold` on a forward-range selection/, "the usable entry survives");
  assert.doesNotMatch(md, /undefined|\[object/, "and nothing malformed reaches the prompt");

  // mergeCoverage is the normaliser the loader runs records through.
  const normalised = mergeCoverage(null, withJunk);
  assert.deepEqual(normalised.shapes.map((x) => x.control), ["Bold"]);
  assert.deepEqual(normalised.pairs.map((x) => x.pair), ["Bold|Italic"]);
  assert.deepEqual(normalised.readAfterMutation.map((x) => x.control), ["Bold"]);

  for (const junk of [null, undefined, 7, "x", [], { keyVersion: 999, shapes: [{ control: "Ghost" }] }]) {
    assert.equal(renderCoverageBrief(junk, { sha: "aaa" }), "", "nothing usable renders nothing");
    assert.deepEqual(mergeCoverage(null, junk).shapes, []);
  }
});

test("the inventory gives the memory the denominator it lacked", () => {
  // Past journals answer "what was used". Only an inventory answers "what was never
  // touched" — a control nobody clicked appears in no journal, which is why `Clear
  // formatting` was invisible to this memory for eight doc runs.
  const inv = {
    action: { type: "read", reader: "dom.controls" },
    ok: true,
    value: [
      { role: "button", name: "Bold" },
      { role: "button", name: "Italic" },
      { role: "button", name: "Clear formatting" },
    ],
  };
  const c = coverageFromJournal([inv, click("Bold")], { sha: "aaa111111" });
  assert.deepEqual(c.inventory.map((x) => x.control), ["Bold", "Clear formatting", "Italic"]);
  assert.equal(c.inventory[0].sha, "aaa111111", "the inventory carries provenance like everything else");

  const md = renderCoverageBrief(c, { sha: "aaa111111" });
  assert.match(md, /NEVER TRIED/);
  assert.match(md, /- `Clear formatting`/);
  assert.match(md, /- `Italic`/);
  // Bold WAS clicked, so it belongs to the already-tried lists, not the untried one.
  const untriedBlock = md.slice(md.indexOf("NEVER TRIED"));
  assert.doesNotMatch(untriedBlock.split("\n\n")[0], /`Bold`/);
});

test("the inventory UNIONS across runs, because a closed menu hides controls", () => {
  // A run that read `dom.controls` with the Text style menu closed sees fewer controls
  // than one that opened it. Letting the newer reading replace the older would delete
  // every menu item from the memory and re-mark them untried for ever.
  const closed = coverageFromJournal(
    [{ action: { type: "read", reader: "dom.controls" }, ok: true, value: [{ role: "button", name: "Text style" }] }],
    { sha: "aaa" },
  );
  const open = coverageFromJournal(
    [{ action: { type: "read", reader: "dom.controls" }, ok: true, value: [{ role: "menuitem", name: "Heading 2" }] }],
    { sha: "bbb" },
  );
  const merged = mergeCoverage(closed, open);
  assert.deepEqual(merged.inventory.map((x) => x.control).sort(), ["Heading 2", "Text style"]);

  // A failed read contributes nothing rather than emptying the memory.
  const failed = coverageFromJournal([{ action: { type: "read", reader: "dom.controls" }, ok: false, error: "boom" }]);
  assert.deepEqual(failed.inventory, []);
  // As does junk inside a successful one.
  const junk = coverageFromJournal([
    { action: { type: "read", reader: "dom.controls" }, ok: true, value: [null, 7, { role: "button" }, { name: "  " }] },
  ]);
  assert.deepEqual(junk.inventory, []);
});

test("role is part of a control's identity, and a missing one is refused", () => {
  // `target` takes `{role, name}`. A `menuitem` and a `button` can legitimately share a
  // name, so collapsing on name alone loses a control and leaves the survivor's role a
  // coin toss — and a GUESSED role produces a target that does not resolve, which is the
  // failure this reader exists to prevent.
  const c = coverageFromJournal(
    [
      {
        action: { type: "read", reader: "dom.controls" },
        ok: true,
        value: [
          { role: "button", name: "Bold" },
          { role: "menuitem", name: "Bold" },
          { name: "no-role-at-all" },
          { role: "   ", name: "blank-role" },
        ],
      },
    ],
    { sha: "aaa" },
  );
  assert.deepEqual(
    c.inventory.map((x) => `${x.role}|${x.control}`),
    ["button|Bold", "menuitem|Bold"],
    "both roles survive; entries without a usable role are dropped rather than defaulted",
  );

  // And the pair survives a merge, which keyed on name alone before.
  const a = coverageFromJournal([{ action: { type: "read", reader: "dom.controls" }, ok: true, value: [{ role: "button", name: "Bold" }] }], { sha: "a" });
  const b = coverageFromJournal([{ action: { type: "read", reader: "dom.controls" }, ok: true, value: [{ role: "menuitem", name: "Bold" }] }], { sha: "b" });
  const merged = mergeCoverage(a, b);
  assert.deepEqual(merged.inventory.map((x) => `${x.role}|${x.control}`), ["button|Bold", "menuitem|Bold"]);
  assert.equal(merged.inventory.every((x) => typeof x.role === "string" && x.role !== ""), true, "role survives serialisation");
});

test("a run that discovered controls and clicked nothing still renders its brief", () => {
  // The most valuable brief there is — an entire surface offered as never-tried — and the
  // early return on `shapes` silenced it completely.
  const discovered = coverageFromJournal(
    [
      {
        action: { type: "read", reader: "dom.controls" },
        ok: true,
        value: [{ role: "button", name: "Clear formatting" }, { role: "button", name: "Insert table" }],
      },
    ],
    { sha: "aaa" },
  );
  assert.deepEqual(discovered.shapes, [], "nothing was clicked");
  const md = renderCoverageBrief(discovered, { sha: "aaa" });
  assert.notEqual(md, "", "an inventory-only run must still say something");
  assert.match(md, /NEVER TRIED/);
  assert.match(md, /- `Clear formatting`/);
  assert.match(md, /- `Insert table`/);

  // Genuinely nothing still renders nothing.
  assert.equal(renderCoverageBrief(coverageFromJournal([]), { sha: "aaa" }), "");
});

test("menu leaves are counted, not listed — they drowned the list that matters", () => {
  // Measured on the doc surface after one run opened the Font menu: 120 untried
  // controls, 116 of them typefaces, and the ONE genuinely untried button buried under
  // them. A menu item is reachable only through its opener, so once that opener has been
  // tried its items are variations rather than new capabilities.
  const inv = {
    action: { type: "read", reader: "dom.controls" },
    ok: true,
    value: [
      { role: "button", name: "Font" },
      { role: "button", name: "Insert image" },
      ...Array.from({ length: 40 }, (_, i) => ({ role: "menuitemcheckbox", name: `Typeface ${i}` })),
    ],
  };
  const c = coverageFromJournal([inv, click("Font")], { sha: "aaa" });
  const md = renderCoverageBrief(c, { sha: "aaa" });

  // The actionable list holds the button and nothing else.
  const headline = md.slice(md.indexOf("NEVER TRIED"), md.indexOf("Also unused"));
  assert.match(headline, /`Insert image`/);
  assert.doesNotMatch(headline, /Typeface/, "40 typefaces must not drown one untried button");

  // COUNTED, never silently dropped — the number is the invitation to look.
  assert.match(md, /Also unused: 40 item\(s\) INSIDE menus/);
  assert.match(md, /Typeface 0/, "a sample is still shown");

  // A leaf whose opener was never tried is still just a leaf; the grouping is by ROLE,
  // not by whether the opener happens to have been clicked.
  const noOpener = coverageFromJournal([inv], { sha: "aaa" });
  assert.match(renderCoverageBrief(noOpener, { sha: "aaa" }), /Also unused: 40 item/);
});

test("when every top-level control is used, the brief says depth beats breadth", () => {
  // The state the doc surface is actually in. Without this the brief would print a menu
  // count and nothing else, which reads as "almost nothing left" when what is left is
  // every un-reversed round trip.
  const inv = {
    action: { type: "read", reader: "dom.controls" },
    ok: true,
    value: [
      { role: "button", name: "Bold" },
      { role: "menuitemcheckbox", name: "Typeface 1" },
    ],
  };
  const c = coverageFromJournal([inv, click("Bold")], { sha: "aaa" });
  const md = renderCoverageBrief(c, { sha: "aaa" });
  assert.doesNotMatch(md, /NEVER TRIED/, "nothing top-level is untried, so no headline list");
  assert.match(md, /EVERY top-level control on this surface has been clicked/);
  assert.match(md, /Depth is now/);

  // And it does NOT claim that when something top-level is still untried.
  const partial = coverageFromJournal(
    [{ action: { type: "read", reader: "dom.controls" }, ok: true, value: [{ role: "button", name: "Bold" }, { role: "button", name: "Italic" }] }, click("Bold")],
    { sha: "aaa" },
  );
  assert.doesNotMatch(renderCoverageBrief(partial, { sha: "aaa" }), /EVERY top-level control/);
});
