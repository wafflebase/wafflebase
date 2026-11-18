import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Element, Frame, SlidesDocument } from "@wafflebase/slides";
import { buildSectionInit } from "@wafflebase/board";

const { rasterizeSlideRegion } = vi.hoisted(() => ({
  rasterizeSlideRegion: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    bytes: new Uint8Array(),
    width: 1,
    height: 1,
    scale: 1,
  })),
}));
vi.mock("@wafflebase/slides", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wafflebase/slides")>()),
  rasterizeSlideRegion,
}));
vi.mock("../docs/export-utils", () => ({
  docsImageFetcher: vi.fn(),
  downloadBlob: vi.fn(),
  safeFilename: (t: string, ext: string) => `${t}.${ext}`,
}));
vi.mock("../slides/pdf-actions", () => ({ loadDeckFonts: vi.fn(async () => undefined) }));

import { boardExportPlan, exportBoard } from "./board-export";

const f = (x: number, y: number, w: number, h: number): Frame => ({ x, y, w, h, rotation: 0 });

function section(id: string, frame: Frame, hidden = false): Element {
  const el = { ...buildSectionInit(frame, { title: id }), id } as Element;
  const data = (el as unknown as { data: { section: Record<string, unknown> } }).data;
  data.section = { ...data.section, hidden };
  return el;
}

const rect = (id: string, x: number, y: number) =>
  ({ id, type: "shape", frame: f(x, y, 100, 100), data: { kind: "rect" } }) as unknown as Element;

// "secret" sits inside the hidden section; "open" sits inside a visible one.
const elements = [
  section("hidden", f(0, 0, 1000, 1000), true),
  rect("secret", 100, 100),
  section("visible", f(2000, 0, 1000, 1000)),
  rect("open", 2100, 100),
];

/** A 2D context that records the text drawn and counts filled rects. */
function recordingCtx() {
  const texts: string[] = [];
  const noop = () => undefined;
  return {
    texts,
    measureText: (s: string) => ({ width: s.length }),
    fillText: (s: string) => texts.push(s),
    fillRect: noop, strokeRect: noop, beginPath: noop, rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop, moveTo: noop, lineTo: noop, save: noop, restore: noop,
  };
}

describe("boardExportPlan", () => {
  it("never rasterizes a hidden section's contents", () => {
    const plan = boardExportPlan(elements);
    expect(plan.elementIds).toEqual(["hidden", "visible", "open"]);
    // The section pass still sees the hidden member, to count it.
    expect(plan.sectionElements.map((e) => e.id)).toContain("secret");
  });

  it("drops a hidden member from a selection that names it without its section", () => {
    const plan = boardExportPlan(elements, ["secret", "open"]);
    expect(plan.elementIds).toEqual(["open"]);
    // The unselected hidden section paints no cover, so its member adds nothing.
    expect(plan.sectionElements.some((e) => e.id === "hidden")).toBe(false);
  });

  it("has nothing to export when only hidden contents are selected", () => {
    expect(boardExportPlan(elements, ["secret"]).region).toBeUndefined();
  });
});

describe("exportBoard", () => {
  beforeEach(() => rasterizeSlideRegion.mockClear());

  it("paints section titles and hidden covers, and leaves hidden contents out", async () => {
    const doc = { slides: [{ id: "board", elements }] } as unknown as SlidesDocument;
    await exportBoard({ doc, format: "png", title: "Retro" });
    expect(rasterizeSlideRegion).toHaveBeenCalledTimes(1);
    const opts = rasterizeSlideRegion.mock.calls[0][3] as {
      elementIds: string[];
      paintAfterElements: (ctx: CanvasRenderingContext2D) => void;
    };
    expect(opts.elementIds).not.toContain("secret");
    const ctx = recordingCtx();
    opts.paintAfterElements(ctx as unknown as CanvasRenderingContext2D);
    expect(ctx.texts).toContain("visible");
    expect(ctx.texts).toContain("1 hidden item");
  });
});
