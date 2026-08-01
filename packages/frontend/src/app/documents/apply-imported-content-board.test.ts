import { describe, it, expect, vi } from "vitest";
import { applyBoardElements } from "./apply-imported-content";
import type { ElementInit } from "@wafflebase/slides";

describe("applyBoardElements", () => {
  it("adds every element inside a single batch, on the synthetic slide", () => {
    const calls: { slideId: string; init: ElementInit }[] = [];
    let batches = 0;
    const store = {
      batch: (fn: () => void) => {
        batches++;
        fn();
      },
      addElement: (slideId: string, init: ElementInit) => {
        calls.push({ slideId, init });
        return "new-id";
      },
    };

    const elements = [
      {
        type: "shape",
        frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        data: { kind: "rect" },
      },
      {
        type: "text",
        frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        data: { blocks: [] },
      },
    ] as unknown as ElementInit[];

    applyBoardElements(store as never, elements);

    expect(batches).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].slideId).toBe("board");
  });

  it("strips the mapper-only __id before writing", () => {
    const seen: ElementInit[] = [];
    const store = {
      batch: (fn: () => void) => fn(),
      addElement: (_s: string, init: ElementInit) => {
        seen.push(init);
        return "x";
      },
    };

    applyBoardElements(store as never, [
      {
        __id: "tmp",
        type: "shape",
        frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        data: { kind: "rect" },
      },
    ] as unknown as ElementInit[]);

    expect(seen[0]).not.toHaveProperty("__id");
  });

  it("no-ops on an empty element list without opening a batch", () => {
    const batch = vi.fn();
    applyBoardElements({ batch, addElement: vi.fn() } as never, []);
    expect(batch).not.toHaveBeenCalled();
  });
});
