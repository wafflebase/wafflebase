import { describe, expect, it } from "vitest";
import type { ChannelSummary } from "@/api/chat";
import {
  browsableChannels,
  channelLabel,
  groupChannels,
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
