import { describe, it, expect } from "vitest";
import { SLIDES_CLIPBOARD_MIME, serializeElements, type Element } from "@wafflebase/slides";
import {
  MAX_PASTED_STICKIES,
  boardPasteOffset,
  isElementClipboardText,
  layoutPastedStickies,
  parsePastedCells,
  stickyTextFromClipboard,
} from "./sticky-paste";

describe("parsePastedCells", () => {
  it("makes one cell per non-empty line, in a near-square grid", () => {
    expect(parsePastedCells("a\n\n b \r\nc\nd\ne")).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });

  it("keeps a single line as one cell", () => {
    expect(parsePastedCells("  just one idea ")).toEqual([["just one idea"]]);
  });

  it("keeps spreadsheet rows and columns, with empty cells as gaps", () => {
    expect(parsePastedCells("a\tb\tc\n\t\t\nd\t\tf\n")).toEqual([
      ["a", "b", "c"],
      ["d", "", "f"],
    ]);
  });

  it("returns nothing for blank text", () => {
    expect(parsePastedCells(" \n\t\n")).toEqual([]);
  });
});

describe("layoutPastedStickies", () => {
  const size = { w: 100, h: 100 };

  it("centres the grid on the point and skips empty cells", () => {
    const { stickies, dropped } = layoutPastedStickies(
      [["a", "b"], ["", "d"]],
      { x: 0, y: 0 },
      size,
      20,
    );
    expect(dropped).toBe(0);
    expect(stickies).toEqual([
      { text: "a", center: { x: -60, y: -60 } },
      { text: "b", center: { x: 60, y: -60 } },
      { text: "d", center: { x: 60, y: 60 } },
    ]);
  });

  it("caps the count and reports what it dropped", () => {
    const grid = [Array.from({ length: MAX_PASTED_STICKIES + 5 }, (_, i) => String(i))];
    const { stickies, dropped } = layoutPastedStickies(grid, { x: 0, y: 0 }, size, 0);
    expect(stickies).toHaveLength(MAX_PASTED_STICKIES);
    expect(dropped).toBe(5);
  });
});

describe("clipboard routing", () => {
  const elementPayload = serializeElements([
    {
      id: "a",
      type: "shape",
      frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
      data: { kind: "rect" },
    } as Element,
  ]);

  const clip = (text: string, extra: { types?: string[]; image?: boolean } = {}) => ({
    types: [...(extra.types ?? []), "text/plain"],
    getData: (t: string) => (t === "text/plain" ? text : ""),
    items: extra.image
      ? [{ kind: "file", type: "image/png", getAsFile: () => null }]
      : [],
  });

  it("recognises the element clipboard payload, and only it", () => {
    expect(isElementClipboardText(elementPayload)).toBe(true);
    expect(isElementClipboardText("{ not json")).toBe(false);
    expect(isElementClipboardText("[1, 2]")).toBe(false);
    expect(isElementClipboardText("hello")).toBe(false);
  });

  it("takes plain text and leaves element payloads, images and blanks alone", () => {
    expect(stickyTextFromClipboard(clip("one\ntwo"))).toBe("one\ntwo");
    expect(stickyTextFromClipboard(clip(elementPayload))).toBeNull();
    expect(stickyTextFromClipboard(clip("x", { types: [SLIDES_CLIPBOARD_MIME] }))).toBeNull();
    expect(stickyTextFromClipboard(clip("x", { image: true }))).toBeNull();
    expect(stickyTextFromClipboard(clip("   "))).toBeNull();
    expect(stickyTextFromClipboard(null)).toBeNull();
  });
});

describe("boardPasteOffset", () => {
  const visible = { x: 0, y: 0, w: 1000, h: 800, rotation: 0 };

  it("keeps the slides nudge while the copy stays on screen", () => {
    expect(boardPasteOffset({ x: 100, y: 100, w: 50, h: 50, rotation: 0 }, visible)).toEqual({
      dx: 10,
      dy: 10,
    });
  });

  it("brings a copy of an off-screen source to the viewport centre", () => {
    expect(
      boardPasteOffset({ x: 5000, y: -3000, w: 200, h: 100, rotation: 0 }, visible),
    ).toEqual({ dx: 500 - 5100, dy: 400 + 2950 });
  });
});
