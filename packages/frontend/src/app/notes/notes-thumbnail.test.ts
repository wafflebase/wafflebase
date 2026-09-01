import { describe, expect, it } from "vitest";
import { outlineOf } from "./notes-thumbnail";

describe("outlineOf", () => {
  it("marks headings and strips their markers", () => {
    expect(outlineOf("# Weekly Report\nsome body")).toEqual([
      { text: "Weekly Report", heading: true },
      { text: "some body", heading: false },
    ]);
  });

  it("drops blank lines so a note padded with them still shows content", () => {
    expect(outlineOf("\n\n\nHello\n\n\nWorld")).toEqual([
      { text: "Hello", heading: false },
      { text: "World", heading: false },
    ]);
  });

  it("skips fenced code, which reads as noise at thumbnail size", () => {
    const md = ["# Title", "```ts", "const x = 1;", "```", "after"].join("\n");
    expect(outlineOf(md)).toEqual([
      { text: "Title", heading: true },
      { text: "after", heading: false },
    ]);
  });

  it("does not let an unterminated fence swallow the note", () => {
    // Toggling rather than skipping to the end: a stray ``` would otherwise
    // produce an empty thumbnail for the whole rest of the document.
    expect(outlineOf("```\ncode")).toEqual([]);
    expect(outlineOf("intro\n```\ncode\n```\ntail")).toEqual([
      { text: "intro", heading: false },
      { text: "tail", heading: false },
    ]);
  });

  it("turns list markers into bullets and unwraps quotes", () => {
    expect(outlineOf("- one\n* two\n> quoted")).toEqual([
      { text: "• one", heading: false },
      { text: "• two", heading: false },
      { text: "quoted", heading: false },
    ]);
  });

  it("strips emphasis and code markers from the text", () => {
    expect(outlineOf("**bold** and `code`")).toEqual([
      { text: "bold and code", heading: false },
    ]);
  });

  it("returns nothing for an empty or whitespace-only note", () => {
    // The renderer turns this into `null`, so the card keeps its type icon
    // rather than showing a blank rectangle.
    expect(outlineOf("")).toEqual([]);
    expect(outlineOf("   \n\t\n  ")).toEqual([]);
  });

  it("caps the number of lines it will draw", () => {
    const md = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const out = outlineOf(md);
    expect(out.length).toBeLessThanOrEqual(13);
    expect(out[0]).toEqual({ text: "line 0", heading: false });
  });

  it("does not scan a huge single-line file end to end", () => {
    // A minified or generated note must not be measured whole just to draw
    // thirteen lines of it.
    const md = `${"x".repeat(100_000)}\n# never reached`;
    expect(outlineOf(md)).toHaveLength(1);
  });
});
