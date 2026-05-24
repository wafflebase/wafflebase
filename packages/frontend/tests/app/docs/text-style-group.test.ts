import { test, expect } from 'vitest';
import {
  getFilteredStyleOptions,
  STYLE_OPTIONS,
} from "../../../src/components/text-formatting/text-style-options.ts";

test("getFilteredStyleOptions returns full list when allowedBlockTypes is undefined", () => {
  const result = getFilteredStyleOptions(undefined);
  expect(result).toEqual(STYLE_OPTIONS);
});

test("getFilteredStyleOptions returns all entries when allowedBlockTypes includes all types", () => {
  const allTypes = ["paragraph", "title", "subtitle", "heading"] as const;
  const result = getFilteredStyleOptions(allTypes);
  expect(result.length).toBe(STYLE_OPTIONS.length);
});

test("getFilteredStyleOptions filters to paragraph and heading only", () => {
  const result = getFilteredStyleOptions(["paragraph", "heading"]);
  const labels = result.map((o) => o.label);
  expect(labels.includes("Normal text"), "should include Normal text").toBeTruthy();
  expect(labels.includes("Heading 1"), "should include Heading 1").toBeTruthy();
  expect(labels.includes("Heading 2"), "should include Heading 2").toBeTruthy();
  expect(labels.includes("Heading 3"), "should include Heading 3").toBeTruthy();
  expect(!labels.includes("Title"), "should exclude Title").toBeTruthy();
  expect(!labels.includes("Subtitle"), "should exclude Subtitle").toBeTruthy();
});

test("getFilteredStyleOptions with empty array returns no options", () => {
  const result = getFilteredStyleOptions([]);
  expect(result.length).toBe(0);
});
