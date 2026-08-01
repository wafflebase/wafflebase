import { describe, it, expect, vi } from "vitest";
import { applyBoardElements } from "./apply-imported-content";
import type { ElementInit } from "@wafflebase/slides";

/**
 * A store double that mints a DISTINCT id per call, like every real store
 * does.
 *
 * The original double returned the constant `"new-id"`, and that is precisely
 * what hid the id-remap bug: with one id for everything, a connector written
 * with the mapper's own handle is indistinguishable from one written with the
 * store's. Any stub here must keep ids unique.
 */
function recordingStore() {
  const calls: { slideId: string; init: ElementInit }[] = [];
  let batches = 0;
  let n = 0;
  return {
    calls,
    get batches() {
      return batches;
    },
    store: {
      batch: (fn: () => void) => {
        batches++;
        fn();
      },
      addElement: (slideId: string, init: ElementInit) => {
        calls.push({ slideId, init });
        return `real-${++n}`;
      },
    },
  };
}

describe("applyBoardElements", () => {
  it("adds every element inside a single batch, on the synthetic slide", () => {
    const rec = recordingStore();
    const { calls, store } = rec;

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

    expect(rec.batches).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].slideId).toBe("board");
  });

  it("strips the mapper-only __id before writing", () => {
    const { calls, store } = recordingStore();

    applyBoardElements(store as never, [
      {
        __id: "tmp",
        type: "shape",
        frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        data: { kind: "rect" },
      },
    ] as unknown as ElementInit[]);

    expect(calls[0].init).not.toHaveProperty("__id");
  });

  it("no-ops on an empty element list without opening a batch", () => {
    const batch = vi.fn();
    const result = applyBoardElements(
      { batch, addElement: vi.fn() } as never,
      [],
    );
    expect(batch).not.toHaveBeenCalled();
    expect(result).toEqual({ droppedConnectors: 0 });
  });

  it("rewrites connector endpoints from the mapper handle to the store's id", () => {
    const { calls, store } = recordingStore();

    applyBoardElements(store as never, [
      {
        __id: "m-a",
        type: "shape",
        frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        data: { kind: "rect" },
      },
      {
        __id: "m-c",
        type: "connector",
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
        routing: "straight",
        start: { kind: "attached", elementId: "m-a", siteIndex: 0 },
        end: { kind: "attached", elementId: "m-b", siteIndex: 2 },
        arrowheads: {},
      },
      {
        __id: "m-b",
        type: "shape",
        frame: { x: 9, y: 9, w: 1, h: 1, rotation: 0 },
        data: { kind: "rect" },
      },
    ] as unknown as ElementInit[]);

    // The connector is written LAST even though it arrived second — the split
    // is by type, not by array position, because the connector feed is
    // separate and carries no ordering guarantee against its targets.
    const written = calls.map((c) => c.init.type);
    expect(written).toEqual(["shape", "shape", "connector"]);

    const shapeIds = calls
      .filter((c) => c.init.type === "shape")
      .map((_, i) => `real-${i + 1}`);
    const connector = calls[2].init as unknown as {
      start: { elementId: string; siteIndex: number };
      end: { elementId: string; siteIndex: number };
    };
    expect(shapeIds).toContain(connector.start.elementId);
    expect(shapeIds).toContain(connector.end.elementId);
    // Not the mapper's handles.
    expect(connector.start.elementId).not.toBe("m-a");
    expect(connector.end.elementId).not.toBe("m-b");
    // Everything else on the endpoint survives the rewrite.
    expect(connector.end.siteIndex).toBe(2);
  });

  it("drops and counts a connector whose endpoint has no real id", () => {
    const { calls, store } = recordingStore();

    const { droppedConnectors } = applyBoardElements(store as never, [
      {
        __id: "m-a",
        type: "shape",
        frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        data: { kind: "rect" },
      },
      {
        __id: "m-c",
        type: "connector",
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
        routing: "straight",
        start: { kind: "attached", elementId: "m-a", siteIndex: 0 },
        end: { kind: "attached", elementId: "never-written", siteIndex: 0 },
        arrowheads: {},
      },
    ] as unknown as ElementInit[]);

    // A dangling attached endpoint resolves to (0, 0) at render time, so
    // writing it would strand an invisible arrow at the world origin. Refuse,
    // and say how many were refused.
    expect(droppedConnectors).toBe(1);
    expect(calls.map((c) => c.init.type)).toEqual(["shape"]);
  });

  it("passes a free endpoint through untouched", () => {
    const { calls, store } = recordingStore();

    applyBoardElements(store as never, [
      {
        __id: "m-c",
        type: "connector",
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
        routing: "straight",
        start: { kind: "free", x: 10, y: 20 },
        end: { kind: "free", x: 30, y: 40 },
        arrowheads: {},
      },
    ] as unknown as ElementInit[]);

    const connector = calls[0].init as unknown as { start: unknown; end: unknown };
    expect(connector.start).toEqual({ kind: "free", x: 10, y: 20 });
    expect(connector.end).toEqual({ kind: "free", x: 30, y: 40 });
  });
});
