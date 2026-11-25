import { describe, expect, it } from "vitest";

import type { ChannelSummary } from "@/api/chat";
import { panelChannels, pickPanelChannel } from "../chat-panel-channel";
import { landingChannelId } from "../last-channel";

function channel(over: Partial<ChannelSummary> & { id: string }): ChannelSummary {
  return {
    kind: "public",
    name: over.id,
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
  } as ChannelSummary;
}

const general = channel({ id: "general", isDefault: true, lastMessageAt: "2026-11-01T00:00:00Z" });
const planning = channel({ id: "planning", lastMessageAt: "2026-11-20T00:00:00Z" });
const design = channel({ id: "design", lastMessageAt: "2026-11-10T00:00:00Z" });
const notJoined = channel({ id: "random", isMember: false, lastMessageAt: "2026-11-24T00:00:00Z" });
const archived = channel({ id: "old", archived: true, lastMessageAt: "2026-11-25T00:00:00Z" });
const channels = [general, planning, design, notJoined, archived];

describe("pickPanelChannel", () => {
  const pick = (over: Partial<Parameters<typeof pickPanelChannel>[0]>) =>
    pickPanelChannel({ channels, requested: null, sharedIn: null, last: null, ...over });

  it("shows the channel asked for, even one the user has not joined", () => {
    expect(pick({ requested: "random", sharedIn: "design", last: "planning" })).toBe("random");
  });

  it("skips a requested channel that is not in the list", () => {
    expect(pick({ requested: "gone", last: "planning" })).toBe("planning");
  });

  it("then the channel the document was shared in", () => {
    expect(pick({ sharedIn: "design", last: "planning" })).toBe("design");
  });

  it("then the last opened channel, while the user is still in it", () => {
    expect(pick({ last: "planning" })).toBe("planning");
    expect(pick({ last: "random" })).toBe("general");
    expect(pick({ last: "old" })).toBe("general");
  });

  it("falls back to the default channel, else the most recent one", () => {
    expect(pick({})).toBe("general");
    expect(
      pickPanelChannel({
        channels: [design, planning],
        requested: null,
        sharedIn: null,
        last: null,
      }),
    ).toBe("planning");
    expect(
      pickPanelChannel({ channels: [], requested: null, sharedIn: null, last: null }),
    ).toBeNull();
  });
});

describe("panelChannels", () => {
  it("lists joined, live channels, most recent first", () => {
    expect(panelChannels(channels, "general").map((c) => c.id)).toEqual([
      "planning",
      "design",
      "general",
    ]);
  });

  it("keeps a previewed channel at the top", () => {
    expect(panelChannels(channels, "random").map((c) => c.id)).toEqual([
      "random",
      "planning",
      "design",
      "general",
    ]);
  });
});

describe("landingChannelId", () => {
  it("lands on the last channel while the user can still talk in it", () => {
    expect(landingChannelId(channels, "planning")).toBe("planning");
  });

  it("falls back to the default channel past one left or archived", () => {
    expect(landingChannelId(channels, "random")).toBe("general");
    expect(landingChannelId(channels, "old")).toBe("general");
    expect(landingChannelId(channels, null)).toBe("general");
  });

  it("is null without a default channel to land on", () => {
    expect(landingChannelId([planning], "gone")).toBeNull();
  });
});
