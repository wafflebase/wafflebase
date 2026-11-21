import { describe, expect, it } from "vitest";
import type {
  ChannelSummary,
  ChatMessageDto,
  StreamMessageEvent,
} from "@/api/chat";
import {
  applyChatEvent,
  lastSeqOf,
  markChannelRead,
  markMessageDeleted,
  mergeMessages,
  parseStreamMessage,
  parseStreamUpdate,
  totalUnread,
} from "@/components/chat/chat-cache";

const channel = (id: string, over: Partial<ChannelSummary> = {}) =>
  ({
    id,
    kind: "public",
    name: id,
    topic: null,
    archived: false,
    isMember: true,
    members: [],
    unreadCount: 0,
    mentionCount: 0,
    lastMessageAt: null,
    ...over,
  }) satisfies ChannelSummary;

const event = (over: Partial<StreamMessageEvent> = {}): StreamMessageEvent => ({
  workspaceId: "w1",
  channelId: "c2",
  seq: 7,
  threadRootId: null,
  authorId: 2,
  ...over,
});

const msg = (seq: number, over: Partial<ChatMessageDto> = {}) =>
  ({
    id: `m${seq}`,
    channelId: "c1",
    seq,
    author: { id: 2, username: "minji", photo: null },
    body: `message ${seq}`,
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deleted: false,
    createdAt: "2026-11-20T10:00:00.000Z",
    ...over,
  }) satisfies ChatMessageDto;

const state = (openChannelId: string | null) => ({
  channels: [channel("c1"), channel("c2", { unreadCount: 1 })],
  openChannelId,
  me: 1,
});

describe("applyChatEvent", () => {
  it("asks to fetch after the event's predecessor in the open channel", () => {
    const out = applyChatEvent(state("c2"), event());
    expect(out.fetchAfter).toEqual({ channelId: "c2", seq: 6 });
    // The open channel is being read, so it does not become unread.
    expect(out.channels.find((c) => c.id === "c2")?.unreadCount).toBe(1);
    expect(out.invalidateThread).toBeNull();
  });

  it("counts a top-level message in another channel as unread", () => {
    const out = applyChatEvent(state("c1"), event());
    expect(out.channels.find((c) => c.id === "c2")?.unreadCount).toBe(2);
    expect(out.fetchAfter).toBeNull();
  });

  it("does not guess the mention count", () => {
    const out = applyChatEvent(state("c1"), event());
    expect(out.channels.find((c) => c.id === "c2")?.mentionCount).toBe(0);
  });

  it("never counts the caller's own message as unread", () => {
    const out = applyChatEvent(state("c1"), event({ authorId: 1 }));
    expect(out.channels.find((c) => c.id === "c2")?.unreadCount).toBe(1);
  });

  it("invalidates the thread for a reply and leaves the unread count", () => {
    const out = applyChatEvent(state("c1"), event({ threadRootId: "root" }));
    expect(out.invalidateThread).toBe("root");
    expect(out.channels.find((c) => c.id === "c2")?.unreadCount).toBe(1);
  });

  it("still fetches the open channel for a reply, which may be also-sent", () => {
    const out = applyChatEvent(state("c2"), event({ threadRootId: "root" }));
    expect(out.invalidateThread).toBe("root");
    expect(out.fetchAfter).toEqual({ channelId: "c2", seq: 6 });
  });

  it("leaves the list untouched for a channel it does not know", () => {
    const before = state(null);
    const out = applyChatEvent(before, event({ channelId: "new" }));
    expect(out.channels).toEqual(before.channels);
  });
});

describe("mergeMessages", () => {
  it("dedupes by id, prefers the incoming copy and sorts by seq", () => {
    const merged = mergeMessages(
      [msg(1), msg(2)],
      [msg(3), msg(2, { body: "edited", editedAt: "x" })],
    );
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(merged[1].body).toBe("edited");
  });

  it("starts from nothing", () => {
    expect(mergeMessages(undefined, [msg(2), msg(1)]).map((m) => m.seq)).toEqual(
      [1, 2],
    );
  });
});

describe("lastSeqOf", () => {
  it("is the highest seq, or null when empty", () => {
    expect(lastSeqOf([msg(4), msg(9), msg(2)])).toBe(9);
    expect(lastSeqOf([])).toBeNull();
    expect(lastSeqOf(undefined)).toBeNull();
  });
});

describe("markChannelRead", () => {
  it("clears both counts on the one channel", () => {
    const out = markChannelRead(
      [channel("c1", { unreadCount: 3, mentionCount: 1 }), channel("c2", { unreadCount: 2 })],
      "c1",
    );
    expect(out.map((c) => [c.unreadCount, c.mentionCount])).toEqual([
      [0, 0],
      [2, 0],
    ]);
  });
});

describe("totalUnread", () => {
  it("sums followed, live channels only", () => {
    expect(
      totalUnread([
        channel("a", { unreadCount: 2 }),
        channel("b", { unreadCount: 3, kind: "dm" }),
        channel("c", { unreadCount: 5, isMember: false }),
        channel("d", { unreadCount: 7, archived: true }),
      ]),
    ).toBe(5);
  });
});

describe("parseStreamMessage", () => {
  it("reads a well-formed frame", () => {
    expect(
      parseStreamMessage(
        '{"workspaceId":"w","channelId":"c","seq":3,"threadRootId":null,"authorId":null}',
      ),
    ).toEqual({
      workspaceId: "w",
      channelId: "c",
      seq: 3,
      threadRootId: null,
      authorId: null,
    });
  });

  it("rejects malformed JSON and wrong types", () => {
    expect(parseStreamMessage("nope")).toBeNull();
    expect(parseStreamMessage('{"workspaceId":"w","channelId":"c","seq":"3","threadRootId":null,"authorId":1}')).toBeNull();
    expect(parseStreamMessage('{"workspaceId":"w","channelId":"c","seq":3,"threadRootId":5,"authorId":1}')).toBeNull();
  });
});

describe("parseStreamUpdate", () => {
  it("accepts an update frame", () => {
    const frame = {
      workspaceId: "w1",
      channelId: "c1",
      messageId: "m1",
      threadRootId: null,
    };
    expect(parseStreamUpdate(JSON.stringify(frame))).toEqual(frame);
  });

  it("rejects a malformed frame", () => {
    expect(parseStreamUpdate("nope")).toBeNull();
    expect(
      parseStreamUpdate(
        JSON.stringify({ workspaceId: "w1", channelId: "c1", messageId: 4 }),
      ),
    ).toBeNull();
    expect(
      parseStreamUpdate(
        JSON.stringify({
          workspaceId: "w1",
          channelId: "c1",
          messageId: "m1",
          threadRootId: 7,
        }),
      ),
    ).toBeNull();
  });
});

describe("markMessageDeleted", () => {
  it("blanks one message and leaves the rest", () => {
    const next = markMessageDeleted([msg(1), msg(2)], "m2");
    expect(next?.map((m) => [m.body, m.deleted])).toEqual([
      ["message 1", false],
      ["", true],
    ]);
  });

  it("leaves a missing cache missing", () => {
    expect(markMessageDeleted(undefined, "m1")).toBeUndefined();
  });
});
