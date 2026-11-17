import { describe, it, expect, vi } from "vitest";
import type { Element } from "@wafflebase/slides";
import { buildStickyInit } from "./sticky";
import { drawStickyAuthor, fitWithEllipsis, stickyAuthorLabel } from "./sticky-author";

const sticky = (author?: string, showAuthor?: boolean): Element =>
  ({
    ...buildStickyInit("#FFF8B8", { x: 100, y: 100 }, { author, showAuthor }),
    id: "s",
  }) as Element;

describe("stickyAuthorLabel", () => {
  it("is the recorded author of a sticky", () => {
    expect(stickyAuthorLabel(sticky("Ada"), false)).toBe("Ada");
  });

  it("is nothing on an anonymous board, with the tag off, or with no author", () => {
    expect(stickyAuthorLabel(sticky("Ada"), true)).toBeNull();
    expect(stickyAuthorLabel(sticky("Ada", false), false)).toBeNull();
    expect(stickyAuthorLabel(sticky(), false)).toBeNull();
  });

  it("is nothing for a non-sticky carrying the field", () => {
    const rect = {
      id: "r",
      type: "shape",
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      data: { kind: "rect", author: "Ada" },
    } as unknown as Element;
    expect(stickyAuthorLabel(rect, false)).toBeNull();
  });
});

describe("fitWithEllipsis", () => {
  const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) as TextMetrics };

  it("keeps text that fits and cuts text that does not", () => {
    expect(fitWithEllipsis(ctx, "abc", 30)).toBe("abc");
    expect(fitWithEllipsis(ctx, "abcdef", 40)).toBe("abc…");
    expect(fitWithEllipsis(ctx, "abcdef", 5)).toBe("");
  });
});

describe("drawStickyAuthor", () => {
  function spyCtx() {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillText: vi.fn(),
      measureText: (t: string) => ({ width: t.length * 6 }) as TextMetrics,
      font: "",
      fillStyle: "",
      textAlign: "",
      textBaseline: "",
    };
  }

  it("paints the name inside the sticky's bottom-left, balanced save/restore", () => {
    const ctx = spyCtx();
    drawStickyAuthor(ctx as unknown as CanvasRenderingContext2D, sticky("Ada"), false);
    expect(ctx.translate).toHaveBeenCalledWith(100, 100);
    const [text, x, y] = ctx.fillText.mock.calls[0];
    expect(text).toBe("Ada");
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it("paints nothing on an anonymous board", () => {
    const ctx = spyCtx();
    drawStickyAuthor(ctx as unknown as CanvasRenderingContext2D, sticky("Ada"), true);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.save).not.toHaveBeenCalled();
  });
});
