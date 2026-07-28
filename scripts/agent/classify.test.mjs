import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeClass, parseClassComment, truncate, localizationFromDiff } from "./classify.mjs";

test("serializeClass / parseClassComment round-trip", () => {
  const rec = {
    schema: 1, issue: 42, primary_type: "A1", secondary_types: [],
    spec_quality: "full", test_availability: "provided", confidence: 0.9,
    rationale: "off-by-one in loop bound", bug: { bug_class: "B1", secondary_classes: [], confidence: 0.8, rationale: "wrong condition" },
    localization_scope: "single_file", verified: true, pr: 566,
  };
  const body = serializeClass(rec);
  assert.ok(body.startsWith("<!-- agent-class "));
  assert.ok(body.endsWith(" -->"));
  assert.deepEqual(parseClassComment(body), rec);
});

test("serializeClass neutralizes an embedded terminator so the parser can't be broken", () => {
  const body = serializeClass({ rationale: "a --> b" });
  // exactly one closing terminator (the real one), regex still recovers the record
  assert.equal(body.match(/-->/g).length, 1);
  assert.equal(parseClassComment(body).rationale, "a -- > b");
});

test("parseClassComment returns null for non-class / malformed bodies", () => {
  assert.equal(parseClassComment("<!-- agent-metric {\"turns\":3} -->"), null); // different marker
  assert.equal(parseClassComment("just a normal PR comment"), null);
  assert.equal(parseClassComment(""), null);
  assert.equal(parseClassComment("<!-- agent-class not json -->"), null); // matches marker, bad JSON
});

test("truncate leaves short input untouched and marks long input", () => {
  assert.equal(truncate("abc", 10), "abc");
  const out = truncate("abcdef", 3);
  assert.ok(out.startsWith("abc"));
  assert.ok(out.includes("[truncated]"));
});

test("localizationFromDiff classifies scope from the diff", () => {
  assert.equal(localizationFromDiff(""), "unknown");
  assert.equal(localizationFromDiff("+++ b/pkg/a/x.ts\n@@ -1 +1 @@"), "single_hunk");
  assert.equal(localizationFromDiff("+++ b/pkg/a/x.ts\n@@ -1 +1 @@\n@@ -9 +9 @@"), "single_file");
  assert.equal(
    localizationFromDiff("+++ b/pkg/a/x.ts\n@@ -1 +1 @@\n+++ b/pkg/a/y.ts\n@@ -1 +1 @@"),
    "multi_file", // two files, same first-two-segment module (pkg/a)
  );
  assert.equal(
    localizationFromDiff("+++ b/pkg/a/x.ts\n@@ -1 +1 @@\n+++ b/pkg/b/y.ts\n@@ -1 +1 @@"),
    "cross_module", // two files, different modules (pkg/a vs pkg/b)
  );
});
