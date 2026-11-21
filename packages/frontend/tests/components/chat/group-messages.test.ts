import { describe, expect, it } from "vitest";
import type { ChatMessageDto } from "@/api/chat";
import { groupMessages } from "@/components/chat/group-messages";

const minji = { id: 2, username: "minji", photo: null };
const jun = { id: 3, username: "jun", photo: null };

let seq = 0;
const msg = (
  author: ChatMessageDto["author"],
  at: string,
  over: Partial<ChatMessageDto> = {},
): ChatMessageDto => {
  seq += 1;
  return {
    id: `m${seq}`,
    channelId: "c1",
    seq,
    author,
    body: `message ${seq}`,
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deleted: false,
    createdAt: `2026-11-20T${at}:00.000Z`,
    ...over,
  };
};

const shape = (groups: ReturnType<typeof groupMessages>) =>
  groups.map((g) => [g.author?.username ?? null, 1 + g.rest.length]);

describe("groupMessages", () => {
  it("collapses consecutive messages by one author within five minutes", () => {
    const groups = groupMessages([
      msg(minji, "10:00"),
      msg(minji, "10:02"),
      msg(minji, "10:05"),
    ]);
    expect(shape(groups)).toEqual([["minji", 3]]);
    expect(groups[0].first.seq).toBeLessThan(groups[0].rest[0].seq);
  });

  it("starts a new group when the author changes", () => {
    expect(
      shape(
        groupMessages([
          msg(minji, "10:00"),
          msg(jun, "10:01"),
          msg(minji, "10:02"),
        ]),
      ),
    ).toEqual([
      ["minji", 1],
      ["jun", 1],
      ["minji", 1],
    ]);
  });

  it("starts a new group after more than five minutes", () => {
    expect(
      shape(groupMessages([msg(minji, "10:00"), msg(minji, "10:06")])),
    ).toEqual([
      ["minji", 1],
      ["minji", 1],
    ]);
  });

  it("breaks the group after a message that carries a reply count", () => {
    expect(
      shape(
        groupMessages([
          msg(minji, "10:00", { replyCount: 2 }),
          msg(minji, "10:01"),
          msg(minji, "10:02"),
        ]),
      ),
    ).toEqual([
      ["minji", 1],
      ["minji", 2],
    ]);
  });

  it("never merges messages from deleted accounts", () => {
    expect(shape(groupMessages([msg(null, "10:00"), msg(null, "10:01")]))).toEqual(
      [
        [null, 1],
        [null, 1],
      ],
    );
  });

  it("is empty for no messages", () => {
    expect(groupMessages([])).toEqual([]);
  });
});
