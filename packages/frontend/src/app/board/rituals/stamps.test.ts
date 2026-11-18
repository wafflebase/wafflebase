import { describe, expect, it } from "vitest";
import {
  applyStampEdit,
  describeStamps,
  planStampClick,
  stampKey,
  stampKeysForElements,
  stampsByElement,
} from "./stamps";
import type { BoardStamp, BoardStamps } from "./types";

function stamp(over: Partial<BoardStamp> = {}): BoardStamp {
  return { el: "e1", by: "u1", name: "alice", kind: "plus1", u: 0.5, v: 0.5, at: 1, ...over };
}

const base = {
  userKey: "u1",
  userName: "alice",
  kind: "heart" as const,
  u: 0.25,
  v: 0.75,
  now: 42,
  nonce: "n1",
};

describe("planStampClick", () => {
  it("adds a stamp on an element at the clicked fraction", () => {
    const edit = planStampClick({ ...base, stamps: {}, hitOwnKey: null, elementId: "e1" });
    expect(edit).toEqual({
      op: "add",
      key: "e1~u1~n1",
      stamp: { el: "e1", by: "u1", name: "alice", kind: "heart", u: 0.25, v: 0.75, at: 42 },
    });
  });

  it("does nothing on empty canvas", () => {
    expect(planStampClick({ ...base, stamps: {}, hitOwnKey: null, elementId: null })).toBeNull();
  });

  it("clicking your own stamp removes it", () => {
    const stamps: BoardStamps = { k1: stamp() };
    expect(planStampClick({ ...base, stamps, hitOwnKey: "k1", elementId: "e1" })).toEqual({
      op: "remove",
      key: "k1",
    });
  });

  it("never removes someone else's stamp — it stamps on top instead", () => {
    const stamps: BoardStamps = { k1: stamp({ by: "u2", name: "bob" }) };
    const edit = planStampClick({ ...base, stamps, hitOwnKey: "k1", elementId: "e1" });
    expect(edit?.op).toBe("add");
    expect(stamps.k1.by).toBe("u2");
  });

  it("round-trips add then remove through applyStampEdit", () => {
    const stamps: BoardStamps = {};
    const add = planStampClick({ ...base, stamps, hitOwnKey: null, elementId: "e1" })!;
    applyStampEdit(stamps, add);
    expect(Object.keys(stamps)).toEqual(["e1~u1~n1"]);
    const remove = planStampClick({ ...base, stamps, hitOwnKey: "e1~u1~n1", elementId: "e1" })!;
    applyStampEdit(stamps, remove);
    expect(stamps).toEqual({});
  });

  it("two users stamping the same element write distinct keys", () => {
    const a = planStampClick({ ...base, stamps: {}, hitOwnKey: null, elementId: "e1" });
    const b = planStampClick({
      ...base,
      userKey: "u2",
      stamps: {},
      hitOwnKey: null,
      elementId: "e1",
    });
    expect(a?.op === "add" && b?.op === "add" && a.key !== b.key).toBe(true);
  });
});

describe("stampKey", () => {
  it("keeps Yorkie-illegal dots out of keys", () => {
    expect(stampKey("a.b", "u.1", "n")).not.toContain(".");
  });
});

describe("stampKeysForElements / stampsByElement", () => {
  const stamps: BoardStamps = {
    a: stamp({ el: "e1", at: 2 }),
    b: stamp({ el: "e2" }),
    c: stamp({ el: "e1", at: 1, kind: "star", by: "u2", name: "bob" }),
  };

  it("finds the stamps of deleted elements", () => {
    expect(stampKeysForElements(stamps, new Set(["e1"])).sort()).toEqual(["a", "c"]);
    expect(stampKeysForElements(undefined, new Set(["e1"]))).toEqual([]);
  });

  it("skips stamps a peer wrote with an unknown kind or a malformed owner", () => {
    const peerWritten = {
      ok: stamp(),
      future: stamp({ kind: "confetti" as BoardStamp["kind"] }),
      noOwner: stamp({ by: 7 as unknown as string }),
      noName: stamp({ name: null as unknown as string }),
      nowhere: stamp({ u: Number.NaN }),
    } satisfies BoardStamps;
    const grouped = stampsByElement(peerWritten, new Set(["e1"]));
    expect(grouped.get("e1")?.map((s) => s.key)).toEqual(["ok"]);
  });

  it("groups by live element, oldest first, and drops orphans", () => {
    const grouped = stampsByElement(stamps, new Set(["e1"]));
    expect([...grouped.keys()]).toEqual(["e1"]);
    expect(grouped.get("e1")!.map((s) => s.key)).toEqual(["c", "a"]);
  });

  it("describes who stamped what", () => {
    const list = stampsByElement(stamps, new Set(["e1"])).get("e1")!;
    expect(describeStamps(list)).toBe("Star: bob · +1: alice");
  });
});
