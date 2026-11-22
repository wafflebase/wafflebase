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
    expect(findUnreadDivider(log, { readSeq: 5, lastSeq: 5 }, ME)).toBeNull();
  });

  it("sits above the first message after the read position", () => {
    expect(findUnreadDivider(log, { readSeq: 3, lastSeq: 5 }, ME)).toBe("m4");
  });

  it("skips what does not count as unread", () => {
    const mixed = [
      msg(1),
      msg(2, { authorId: ME }),
      msg(3, { deleted: true }),
      msg(4, { threadRootId: "r" }),
      msg(5),
    ];
    // Mine, deleted and thread-only are read past, as the server counts.
    expect(findUnreadDivider(mixed, { readSeq: 1, lastSeq: 5 }, ME)).toBe(
      "m5",
    );
  });

  it("ignores what arrived after the channel opened", () => {
    // Read through 5 at open; 6 and 7 arrived live and are not "new" here.
    const grown = [...log, msg(6), msg(7)];
    expect(findUnreadDivider(grown, { readSeq: 5, lastSeq: 5 }, ME)).toBeNull();
    expect(findUnreadDivider(grown, { readSeq: 4, lastSeq: 5 }, ME)).toBe(
      "m5",
    );
  });

  it("sits at the oldest loaded unread while older pages are not loaded", () => {
    const tail = [8, 9, 10].map((s) => msg(s));
    expect(findUnreadDivider(tail, { readSeq: 2, lastSeq: 10 }, ME)).toBe(
      "m8",
    );
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
