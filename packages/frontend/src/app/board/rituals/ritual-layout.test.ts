import { describe, expect, it } from "vitest";
import type { Frame } from "@wafflebase/slides";
import type { BoardAnchor, Thread } from "@/types/comments";
import {
  hitAnyStamp,
  hitOwnStamp,
  hitOwnVoteDot,
  layoutRituals,
  stampSize,
  type RitualLayoutInput,
} from "./ritual-layout";

const frame = (x: number, y: number): Frame => ({ x, y, w: 100, h: 100, rotation: 0 });

function thread(id: string, anchor: BoardAnchor, resolved = false): Thread<BoardAnchor> {
  return {
    id,
    anchor,
    resolved,
    createdAt: 1,
    comments: [{ id: `${id}-c`, author: { userId: "1", username: "alice" }, body: "hi", createdAt: 1 }],
  };
}

function input(over: Partial<RitualLayoutInput> = {}): RitualLayoutInput {
  return {
    viewport: { panX: 0, panY: 0, zoom: 1 },
    frames: new Map([["e1", frame(0, 0)]]),
    stamps: {
      mine: { el: "e1", by: "u1", name: "alice", kind: "plus1", u: 0.5, v: 0.5, at: 1 },
      theirs: { el: "e1", by: "u2", name: "bob", kind: "heart", u: 0, v: 0, at: 2 },
      orphan: { el: "gone", by: "u1", name: "alice", kind: "star", u: 0, v: 0, at: 3 },
    },
    myKey: "u1",
    myVotes: new Map(),
    results: new Map(),
    threads: [],
    activeThreadId: null,
    pending: null,
    ...over,
  };
}

describe("layoutRituals", () => {
  it("places stamps on their element and moves them with it and the viewport", () => {
    const at1 = layoutRituals(input());
    expect(at1.stamps.map((s) => [s.key, s.x, s.y, s.mine])).toEqual([
      ["mine", 50, 50, true],
      ["theirs", 0, 0, false],
    ]);
    const moved = layoutRituals(
      input({
        frames: new Map([["e1", frame(200, 0)]]),
        viewport: { panX: 10, panY: 20, zoom: 2 },
      }),
    );
    expect(moved.stamps.find((s) => s.key === "mine")).toMatchObject({ x: 510, y: 120 });
  });

  it("scales stamps with zoom inside a clamp", () => {
    expect(stampSize(1)).toBe(32);
    expect(stampSize(0.1)).toBe(16);
    expect(stampSize(8)).toBe(48);
  });

  it("hit-tests only the viewer's own stamps for removal", () => {
    const layout = layoutRituals(input());
    expect(hitOwnStamp(layout, 50, 50)).toBe("mine");
    expect(hitOwnStamp(layout, 0, 0)).toBeNull();
    expect(hitAnyStamp(layout, 0, 0)?.key).toBe("theirs");
  });

  it("shows own vote dots while voting and result badges once ended", () => {
    const voting = layoutRituals(input({ myVotes: new Map([["e1", 2]]) }));
    expect(voting.voteDots).toHaveLength(2);
    expect(hitOwnVoteDot(voting, voting.voteDots[1].x, voting.voteDots[1].y)).toBe("e1");
    const ended = layoutRituals(input({ results: new Map([["e1", 5], ["gone", 2]]) }));
    expect(ended.results).toEqual([{ key: "e1", elementId: "e1", votes: 5, x: 100, y: 0 }]);
  });

  it("pins follow elements, orphans stay put, resolved threads leave the canvas", () => {
    const layout = layoutRituals(
      input({
        threads: [
          thread("t1", { kind: "board", elementId: "e1", u: 1, v: 1, x: 0, y: 0 }),
          thread("t2", { kind: "board", elementId: "gone", u: 0, v: 0, x: 300, y: 400 }),
          thread("t3", { kind: "board", x: 1, y: 1 }, true),
        ],
        activeThreadId: "t2",
        pending: { kind: "board", x: 9, y: 9 },
      }),
    );
    expect(layout.pins.map((p) => [p.key, p.x, p.y, p.orphan, p.active])).toEqual([
      ["t1", 100, 100, false, false],
      ["t2", 300, 400, true, true],
      ["__pending__", 9, 9, false, true],
    ]);
  });

  it("draws no marks on the contents of a hidden section", () => {
    const layout = layoutRituals(
      input({
        hidden: new Set(["e1"]),
        myVotes: new Map([["e1", 1]]),
        results: new Map([["e1", 3]]),
        threads: [thread("t1", { kind: "board", elementId: "e1", u: 1, v: 1, x: 0, y: 0 })],
      }),
    );
    expect(layout).toEqual({ stamps: [], voteDots: [], results: [], pins: [] });
  });
});
