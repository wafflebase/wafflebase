import { test } from "node:test";
import assert from "node:assert/strict";
import { CITATION, parseCitation } from "./citation.mjs";

test("CITATION: matches a file:line anywhere, rejects anything that locates nothing", () => {
  assert.ok(CITATION.test("scripts/agent/ask.mjs:105"));
  assert.ok(CITATION.test("see review-panel.mjs:436 for the guard")); // embedded in prose
  assert.ok(CITATION.test("a.ts:1"));
  // A bare filename locates nothing — rejected deliberately (the prompt asks for
  // file:line, and rejecting merely keeps the finding).
  assert.equal(CITATION.test("scripts/agent/ask.mjs"), false);
  assert.equal(CITATION.test("looks fine"), false); // the costume-of-evidence case
  assert.equal(CITATION.test(""), false);
  assert.equal(CITATION.test("no-extension:105"), false); // needs a .ext
});

test("CITATION: has no `g` flag, so three importers cannot poison each other", () => {
  // With /g, `.test` advances lastIndex and the SAME string would alternate
  // true/false between callers. Pin it: repeated calls must agree.
  assert.equal(CITATION.flags.includes("g"), false);
  const s = "ask.mjs:105";
  assert.ok(CITATION.test(s));
  assert.ok(CITATION.test(s));
  assert.ok(CITATION.test(s));
});

test("parseCitation: extracts file and line from the first citation", () => {
  assert.deepEqual(parseCitation("scripts/agent/ask.mjs:105"), {
    file: "scripts/agent/ask.mjs",
    line: 105,
  });
  assert.deepEqual(parseCitation("as seen in a/b/c.test.mjs:42 today"), {
    file: "a/b/c.test.mjs",
    line: 42,
  });
  // First citation wins when several are present.
  assert.deepEqual(parseCitation("x.mjs:1 and y.mjs:2"), { file: "x.mjs", line: 1 });
});

test("parseCitation: returns null — never throws, never guesses — on anything unlocatable", () => {
  for (const bad of [null, undefined, 42, {}, [], "", "looks fine", "ask.mjs", "ask.mjs:0"]) {
    assert.equal(parseCitation(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("parseCitation: a dotted path keeps the last colon as the separator", () => {
  // `a.b.c.mjs:7` must not split on an earlier dot-ish boundary.
  assert.deepEqual(parseCitation("a.b.c.mjs:7"), { file: "a.b.c.mjs", line: 7 });
});
