import { describe, expect, it } from "vitest";
import type { ChannelSummary } from "@/api/chat";
import {
  adjacentChannelId,
  browsableChannels,
  channelLabel,
  groupChannels,
  switcherItems,
} from "@/app/chat/group-channels";

const channel = (id: string, over: Partial<ChannelSummary> = {}) =>
  ({
    id,
    kind: "public",
    name: id,
    topic: null,
    archived: false,
    isDefault: false,
    isMember: true,
    canManage: false,
    members: [],
    lastSeq: 0,
    lastReadSeq: 0,
    unreadCount: 0,
    mentionCount: 0,
    lastMessageAt: null,
    ...over,
  }) satisfies ChannelSummary;

const user = (id: number, username: string) => ({ id, username, photo: null });

describe("groupChannels", () => {
  it("splits channels from DMs", () => {
    const out = groupChannels([
      channel("general"),
      channel("dm1", { kind: "dm", name: null }),
      channel("secret", { kind: "private" }),
    ]);
    expect(out.channels.map((c) => c.id)).toEqual(["general", "secret"]);
    expect(out.directMessages.map((c) => c.id)).toEqual(["dm1"]);
  });

  it("moves archived channels the caller is in to their own group", () => {
    const out = groupChannels([
      channel("old", { archived: true }),
      channel("dm-old", { kind: "dm", name: null, archived: true }),
      channel("live"),
    ]);
    expect(out.channels.map((c) => c.id)).toEqual(["live"]);
    expect(out.directMessages).toEqual([]);
    expect(out.archived.map((c) => c.id)).toEqual(["old"]);
  });

  it("keeps archived channels the caller is not in out of the list", () => {
    const out = groupChannels([
      channel("public-old", { archived: true, isMember: false }),
      channel("secret-old", { kind: "private", archived: true }),
    ]);
    expect(out.archived.map((c) => c.id)).toEqual(["secret-old"]);
  });

  it("sorts archived channels by name", () => {
    const out = groupChannels([
      channel("z", { name: "zeta", archived: true }),
      channel("a", { name: "alpha", archived: true }),
    ]);
    expect(out.archived.map((c) => c.name)).toEqual(["alpha", "zeta"]);
  });

  it("leaves out public channels the caller has not joined", () => {
    const out = groupChannels([
      channel("browse-me", { isMember: false }),
      channel("joined"),
    ]);
    expect(out.channels.map((c) => c.id)).toEqual(["joined"]);
  });

  it("sorts channels by name", () => {
    const out = groupChannels([
      channel("c", { name: "zeta" }),
      channel("a", { name: "alpha" }),
      channel("b", { name: "mid" }),
    ]);
    expect(out.channels.map((c) => c.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("sorts DMs by most recent message, quiet ones last", () => {
    const dm = (id: string, lastMessageAt: string | null) =>
      channel(id, { kind: "dm", name: null, lastMessageAt });
    const out = groupChannels([
      dm("quiet", null),
      dm("older", "2026-11-19T10:00:00.000Z"),
      dm("newer", "2026-11-20T10:00:00.000Z"),
    ]);
    expect(out.directMessages.map((c) => c.id)).toEqual([
      "newer",
      "older",
      "quiet",
    ]);
  });
});

describe("browsableChannels", () => {
  const all = [
    channel("z", { name: "zeta", archived: true, isMember: false }),
    channel("a", { name: "alpha", archived: true, isMember: false }),
    channel("joined-old", { archived: true }),
    channel("joined"),
    channel("open-b", { name: "beta", isMember: false }),
    channel("open-a", { name: "able", isMember: false }),
    channel("secret", { kind: "private", isMember: false }),
    channel("dm", { kind: "dm", name: null, archived: true, isMember: false }),
  ];

  it("lists live public channels the caller has not joined, by name", () => {
    expect(browsableChannels(all).live.map((c) => c.id)).toEqual([
      "open-a",
      "open-b",
    ]);
  });

  it("lists archived public channels the caller is not in apart, by name", () => {
    expect(browsableChannels(all).archived.map((c) => c.id)).toEqual([
      "a",
      "z",
    ]);
  });
});

describe("channelLabel", () => {
  it("is the channel name for a channel", () => {
    expect(channelLabel(channel("x", { name: "q4-planning" }), 1)).toBe(
      "q4-planning",
    );
  });

  it("joins the other members' usernames for a DM", () => {
    const dm = channel("d", {
      kind: "dm",
      name: null,
      members: [user(1, "me"), user(2, "minji"), user(3, "jun")],
    });
    expect(channelLabel(dm, 1)).toBe("minji, jun");
  });

  it("names the caller when the DM is with themselves only", () => {
    const dm = channel("d", {
      kind: "dm",
      name: null,
      members: [user(1, "me")],
    });
    expect(channelLabel(dm, 1)).toBe("me");
  });
});

describe("groupChannels preview", () => {
  it("includes the open unjoined channel, sorted by name, and only it", () => {
    const out = groupChannels(
      [
        channel("zeta"),
        channel("beta", { isMember: false }),
        channel("gamma", { isMember: false }),
        channel("alpha"),
      ],
      "beta",
    );
    expect(out.channels.map((c) => c.id)).toEqual(["alpha", "beta", "zeta"]);
  });
});

describe("adjacentChannelId", () => {
  const dm = (id: string, lastMessageAt: string) =>
    channel(id, {
      kind: "dm",
      name: null,
      members: [user(1, "me"), user(2, id)],
      lastMessageAt,
    });
  const list = [
    channel("b"),
    channel("a"),
    channel("arch", { archived: true }),
    dm("d-old", "2026-11-01T00:00:00Z"),
    dm("d-new", "2026-11-20T00:00:00Z"),
  ];

  it("walks Channels then DMs, skipping archived, wrapping at the ends", () => {
    expect(adjacentChannelId(list, "a", 1)).toBe("b");
    expect(adjacentChannelId(list, "b", 1)).toBe("d-new");
    expect(adjacentChannelId(list, "d-old", 1)).toBe("a");
    expect(adjacentChannelId(list, "a", -1)).toBe("d-old");
  });

  it("starts from an end when the open channel is not in the order", () => {
    expect(adjacentChannelId(list, "arch", 1)).toBe("a");
    expect(adjacentChannelId(list, "arch", -1)).toBe("d-old");
    expect(adjacentChannelId(list, null, 1)).toBe("a");
  });

  it("steps from a previewed channel in its sorted place", () => {
    const withPreview = [...list, channel("aa", { isMember: false })];
    expect(adjacentChannelId(withPreview, "aa", 1)).toBe("b");
    expect(adjacentChannelId(withPreview, "aa", -1)).toBe("a");
  });

  it("finds the nearest unread one, ignoring unread in archived channels", () => {
    const unread = [
      channel("a"),
      channel("b", { unreadCount: 2 }),
      channel("c"),
      channel("arch", { archived: true, unreadCount: 9 }),
    ];
    expect(adjacentChannelId(unread, "c", 1, true)).toBe("b");
    expect(adjacentChannelId(unread, "a", -1, true)).toBe("b");
    expect(adjacentChannelId(unread, "b", 1, true)).toBeNull();
  });

  it("has nowhere to go in an empty list", () => {
    expect(adjacentChannelId([], null, 1)).toBeNull();
  });
});

describe("switcherItems", () => {
  const list = [
    channel("planning"),
    channel("general"),
    channel("plan-b", { isMember: false }),
    channel("old", { archived: true }),
    channel("d1", {
      kind: "dm",
      name: null,
      members: [user(1, "me"), user(2, "minji")],
    }),
  ];

  it("lists joined channels and DMs, then the joinable ones, never archived", () => {
    expect(switcherItems(list, 1, "").map((i) => [i.label, i.joinable])).toEqual([
      ["general", false],
      ["planning", false],
      ["minji", false],
      ["plan-b", true],
    ]);
  });

  it("filters by substring, prefix matches first, ignoring a leading #", () => {
    expect(switcherItems(list, 1, "#n").map((i) => i.label)).toEqual([
      "general",
      "planning",
      "minji",
      "plan-b",
    ]);
    expect(switcherItems(list, 1, "PLAN").map((i) => i.label)).toEqual([
      "planning",
      "plan-b",
    ]);
    expect(switcherItems(list, 1, "an").map((i) => i.label)).toEqual([
      "planning",
      "plan-b",
    ]);
  });
});
