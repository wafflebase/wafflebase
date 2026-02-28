import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractFileRefs } from "../verify-entropy.mjs";

describe("extractFileRefs", () => {
  it("extracts backtick-wrapped file paths with extensions", () => {
    const content = "See `src/model/sheet.ts` for details.";
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, [
      { path: "src/model/sheet.ts", source: "test.md" },
    ]);
  });

  it("extracts markdown link targets with file extensions", () => {
    const content = "Check [the doc](packages/sheet/README.md) here.";
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, [
      { path: "packages/sheet/README.md", source: "test.md" },
    ]);
  });

  it("ignores URLs", () => {
    const content = "See `https://example.com/file.ts` for info.";
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, []);
  });

  it("ignores paths inside fenced code blocks", () => {
    const content = [
      "Some text.",
      "```json",
      '{ "entry": "src/main.ts" }',
      "```",
      "See `src/real.ts` here.",
    ].join("\n");
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, [
      { path: "src/real.ts", source: "test.md" },
    ]);
  });

  it("strips anchor fragments from markdown link targets", () => {
    const content = "See [section](README.md#overview) for details.";
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, [
      { path: "README.md", source: "test.md" },
    ]);
  });

  it("deduplicates repeated references in the same file", () => {
    const content = "Use `src/a.ts` and then `src/a.ts` again.";
    const refs = extractFileRefs(content, "test.md");
    assert.deepStrictEqual(refs, [
      { path: "src/a.ts", source: "test.md" },
    ]);
  });
});
