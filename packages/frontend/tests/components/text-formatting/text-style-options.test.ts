import { describe, it, expect } from "vitest";
import {
  STYLE_OPTIONS,
  blockTypeToStyleId,
  getBlockLabel,
} from "../../../src/components/text-formatting/text-style-options.ts";

describe("STYLE_OPTIONS", () => {
  it("exposes Normal, Title, Subtitle and Heading 1–6", () => {
    const labels = STYLE_OPTIONS.map((o) => o.label);
    expect(labels).toEqual([
      "Normal text",
      "Title",
      "Subtitle",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Heading 5",
      "Heading 6",
    ]);
  });

  it("carries a matching styleId on every option", () => {
    expect(STYLE_OPTIONS.find((o) => o.label === "Heading 4")?.styleId).toBe(
      "heading-4"
    );
    expect(STYLE_OPTIONS.find((o) => o.label === "Normal text")?.styleId).toBe(
      "normal"
    );
  });
});

describe("blockTypeToStyleId", () => {
  it("maps each toolbar block type to its style id", () => {
    expect(blockTypeToStyleId("paragraph")).toBe("normal");
    expect(blockTypeToStyleId("list-item")).toBe("normal");
    expect(blockTypeToStyleId("title")).toBe("title");
    expect(blockTypeToStyleId("subtitle")).toBe("subtitle");
    expect(blockTypeToStyleId("heading", 2)).toBe("heading-2");
    expect(blockTypeToStyleId("heading")).toBe("heading-1");
  });
});

describe("getBlockLabel", () => {
  it("labels headings by level", () => {
    expect(getBlockLabel("heading", 5)).toBe("Heading 5");
    expect(getBlockLabel("paragraph")).toBe("Normal text");
  });
});
