import { describe, expect, it } from "vitest";
import type { ChatMessageDto } from "@/api/chat";
import {
  countNewSince,
  countsAsUnread,
  findUnreadDivider,
} from "@/components/chat/unread-marker";

const ME = 1;
const msg = (
  seq: number,
  over: Partial<ChatMessageDto> & { authorId?: number | null } = {},
): ChatMessageDto => {
  const { authorId = 2, ...rest } = over;
  return {
    id: `m${seq}`,
    channelId: "c1",
    seq,
    author:
      authorId === null
        ? null
        : { id: authorId, username: `user${authorId}`, photo: null },
    body: `message ${seq}`,
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deleted: false,
    createdAt: "2026-11-20T10:00:00.000Z",
    ...rest,
  };
};

describe("countsAsUnread", () => {
  it("follows the server's unread rule", () => {
    expect(countsAsUnread(msg(1), ME)).toBe(true);
    // A deleted account's message is still somebody else's.
    expect(countsAsUnread(msg(1, { authorId: null }), ME)).toBe(true);
    expect(countsAsUnread(msg(1, { authorId: ME }), ME)).toBe(false);
    expect(countsAsUnread(msg(1, { deleted: true }), ME)).toBe(false);
    expect(countsAsUnread(msg(1, { threadRootId: "r" }), ME)).toBe(false);
    expect(
      countsAsUnread(msg(1, { threadRootId: "r", alsoInChannel: true }), ME),
    ).toBe(true);
  });
});

describe("findUnreadDivider", () => {
  const log = [1, 2, 3, 4, 5].map((s) => msg(s));

  it("is absent when nothing was unread", () => {
    expect(findUnreadDivider(log, { count: 0, boundarySeq: 5 }, ME)).toBeNull();
  });

  it("sits above the oldest of the unread messages", () => {
    expect(findUnreadDivider(log, { count: 2, boundarySeq: 5 }, ME)).toBe("m4");
  });

  it("skips what the unread count never included", () => {
    const mixed = [
      msg(1),
      msg(2),
      msg(3, { authorId: ME }),
      msg(4, { deleted: true }),
      msg(5),
    ];
    // Two unread: m5 and m2; m3 (mine) and m4 (deleted) are not counted.
    expect(findUnreadDivider(mixed, { count: 2, boundarySeq: 5 }, ME)).toBe(
      "m2",
    );
  });

  it("does not move when messages arrive after the boundary", () => {
    const grown = [...log, msg(6), msg(7)];
    expect(findUnreadDivider(grown, { count: 2, boundarySeq: 5 }, ME)).toBe(
      "m4",
    );
  });

  it("sits at the oldest loaded message while the rest is not loaded", () => {
    expect(findUnreadDivider(log, { count: 9, boundarySeq: 5 }, ME)).toBe("m1");
    // Loading older pages lets it settle where it belongs.
    const older = [msg(-2), msg(-1), msg(0), ...log];
    expect(findUnreadDivider(older, { count: 7, boundarySeq: 5 }, ME)).toBe(
      "m-1",
    );
  });

  it("is absent when no loaded message counts", () => {
    const mine = [msg(1, { authorId: ME })];
    expect(findUnreadDivider(mine, { count: 1, boundarySeq: 1 }, ME)).toBeNull();
  });
});

describe("countNewSince", () => {
  it("counts unread-eligible messages after the seen position", () => {
    const log = [
      msg(1),
      msg(2),
      msg(3, { authorId: ME }),
      msg(4, { deleted: true }),
      msg(5),
      msg(6),
    ];
    expect(countNewSince(log, 6, ME)).toBe(0);
    expect(countNewSince(log, 2, ME)).toBe(2);
    expect(countNewSince(log, 0, ME)).toBe(4);
  });
});
