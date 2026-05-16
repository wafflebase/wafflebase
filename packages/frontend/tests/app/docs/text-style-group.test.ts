import assert from "node:assert/strict";
import test from "node:test";
import {
  getFilteredStyleOptions,
  STYLE_OPTIONS,
} from "../../../src/components/text-formatting/text-style-options.ts";

test("getFilteredStyleOptions returns full list when allowedBlockTypes is undefined", () => {
  const result = getFilteredStyleOptions(undefined);
  assert.deepEqual(result, STYLE_OPTIONS);
});

test("getFilteredStyleOptions returns all entries when allowedBlockTypes includes all types", () => {
  const allTypes = ["paragraph", "title", "subtitle", "heading"] as const;
  const result = getFilteredStyleOptions(allTypes);
  assert.equal(result.length, STYLE_OPTIONS.length);
});

test("getFilteredStyleOptions filters to paragraph and heading only", () => {
  const result = getFilteredStyleOptions(["paragraph", "heading"]);
  const labels = result.map((o) => o.label);
  assert.ok(labels.includes("Normal text"), "should include Normal text");
  assert.ok(labels.includes("Heading 1"), "should include Heading 1");
  assert.ok(labels.includes("Heading 2"), "should include Heading 2");
  assert.ok(labels.includes("Heading 3"), "should include Heading 3");
  assert.ok(!labels.includes("Title"), "should exclude Title");
  assert.ok(!labels.includes("Subtitle"), "should exclude Subtitle");
});

test("getFilteredStyleOptions with empty array returns no options", () => {
  const result = getFilteredStyleOptions([]);
  assert.equal(result.length, 0);
});
