import { describe, expect, it } from "vitest";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";
import { YorkieBoardStore } from "../yorkie-board-store";
import { makeShapeInit, makeYorkieBoardDoc } from "../__testkit__";
import { BoardCommentStore } from "./board-comment-store";
import { elementAnchor, pointAnchor } from "./board-anchor";
import {
  writeBallot,
  writeClearVoting,
  writeDone,
  writeEndVoting,
  writeStampEdit,
  writeStartVoting,
} from "./ritual-writes";
import { createVoting, tallyVotes } from "./voting";
import { yorkiePlain } from "./yorkie-plain";
import type { BoardStamps, BoardVoting } from "./types";

function setup() {
  const doc = makeYorkieBoardDoc();
  const store = new YorkieBoardStore(doc);
  let id = "";
  store.batch(() => {
    id = store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
    store.updateElementFrame(SYNTHETIC_SLIDE_ID, id, { x: 100, y: 100 });
  });
  const stamps = () => yorkiePlain<BoardStamps>(doc.getRoot().stamps) ?? {};
  const voting = () => yorkiePlain<BoardVoting>(doc.getRoot().voting);
  return { doc, store, id, stamps, voting };
}

const author = { userId: "1", username: "alice" };

describe("ritual writes through YorkieBoardStore", () => {
  it("adds and removes a stamp, each one undo unit", () => {
    const { store, id, stamps } = setup();
    const stamp = { el: id, by: "u1", name: "alice", kind: "star" as const, u: 0.5, v: 0.5, at: Date.now() };
    writeStampEdit(store, { op: "add", key: "k1", stamp });
    expect(stamps().k1).toMatchObject({ el: id, kind: "star", at: stamp.at });
    store.undo();
    expect(stamps().k1).toBeUndefined();
    store.redo();
    writeStampEdit(store, { op: "remove", key: "k1" });
    expect(stamps()).toEqual({});
  });

  it("refuses a ritual write outside a batch", () => {
    const { store } = setup();
    expect(() => store.updateRituals(() => undefined)).toThrow(/batch/);
  });

  it("runs a vote: ballots per user, done, end, tally, clear", () => {
    const { store, id, voting } = setup();
    const session = createVoting({
      id: "s1",
      prompt: "Pick",
      perPerson: 3,
      onlyStickies: false,
      userKey: "u1",
      userName: "alice",
    });
    writeStartVoting(store, session);
    writeBallot(store, "s1", "u1", [id]);
    writeBallot(store, "s1", "u2", [id, id]);
    // A write for a stale session id is ignored.
    writeBallot(store, "old", "u3", [id]);
    writeDone(store, "s1", "u2", true);
    expect(voting()).toMatchObject({ status: "active", ballots: { u1: [id], u2: [id, id] }, done: { u2: true } });
    writeEndVoting(store, "s1");
    // Ballots are frozen once ended.
    writeBallot(store, "s1", "u1", []);
    expect(tallyVotes(voting())).toEqual([{ elementId: id, votes: 3 }]);
    writeClearVoting(store, "s1");
    expect(voting()).toBeUndefined();
  });

  it("deleting an element drops its stamps and freezes its comment pins, in one undo unit", async () => {
    const { doc, store, id, stamps } = setup();
    const comments = new BoardCommentStore(doc);
    writeStampEdit(store, {
      op: "add",
      key: "k1",
      stamp: { el: id, by: "u1", name: "alice", kind: "plus1", u: 0, v: 0, at: 1 },
    });
    const frame = store.read().slides[0].elements[0].frame;
    const t = await comments.addThread(elementAnchor(id, frame, { x: 150, y: 150 }), "hi", author);
    const point = await comments.addThread(pointAnchor({ x: 5, y: 6 }), "there", author);

    // Move, then delete: the orphan must keep the MOVED position.
    store.batch(() => store.updateElementFrame(SYNTHETIC_SLIDE_ID, id, { x: 1000, y: 2000 }));
    store.batch(() => store.removeElements(SYNTHETIC_SLIDE_ID, [id]));

    expect(stamps()).toEqual({});
    const threads = comments.listThreadsSync();
    expect(threads.find((x) => x.id === t.id)!.anchor).toMatchObject({ elementId: id, x: 1050, y: 2050 });
    expect(threads.find((x) => x.id === point.id)!.anchor).toEqual({ kind: "board", x: 5, y: 6 });

    store.undo();
    expect(Object.keys(stamps())).toEqual(["k1"]);
    expect(store.read().slides[0].elements).toHaveLength(1);
    comments.dispose();
  });

  it("removeElement (single) prunes too", () => {
    const { store, id, stamps } = setup();
    writeStampEdit(store, {
      op: "add",
      key: "k1",
      stamp: { el: id, by: "u1", name: "alice", kind: "plus1", u: 0, v: 0, at: 1 },
    });
    store.batch(() => store.removeElement(SYNTHETIC_SLIDE_ID, id));
    expect(stamps()).toEqual({});
  });
});

describe("BoardCommentStore", () => {
  it("adds, replies, resolves, reopens and deletes threads", async () => {
    const { doc } = setup();
    let n = 0;
    const store = new BoardCommentStore(doc, { newId: () => `id${++n}`, now: () => 1_700_000_000_000 });
    let notified = 0;
    store.subscribe(() => notified++);
    const t = await store.addThread(pointAnchor({ x: 1, y: 2 }), "first", author);
    expect(t).toMatchObject({ id: "id1", anchor: { kind: "board", x: 1, y: 2 }, createdAt: 1_700_000_000_000 });
    await store.addReply(t.id, "second", { userId: "2", username: "bob" });
    await store.setThreadResolved(t.id, true, author);
    let [listed] = await store.listThreads();
    expect(listed.comments.map((c) => c.body)).toEqual(["first", "second"]);
    expect(listed.resolved).toBe(true);
    expect(listed.resolvedBy).toEqual(author);
    await store.setThreadResolved(t.id, false, author);
    [listed] = await store.listThreads({ resolved: false });
    expect(listed.resolvedAt).toBeUndefined();
    await store.deleteComment(t.id, listed.comments[0].id);
    expect(await store.listThreads()).toEqual([]);
    expect(notified).toBeGreaterThan(0);
    await expect(store.addThread(pointAnchor({ x: 0, y: 0 }), "  ", author)).rejects.toThrow();
    store.dispose();
  });
});
