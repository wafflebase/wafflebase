import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary } from "@/api/chat";
import { useMentionableMembers } from "@/components/chat/use-mentionable-members";

const useChannelMembers = vi.fn();

vi.mock("@/components/comments/use-workspace-members", () => ({
  useWorkspaceMembers: () => [
    { userId: "1", username: "me" },
    { userId: "2", username: "insider" },
    { userId: "3", username: "outsider" },
  ],
}));
vi.mock("@/components/chat/use-chat", () => ({
  useChannelMembers: (...args: unknown[]) => useChannelMembers(...args),
}));

function channel(over: Partial<ChannelSummary>): ChannelSummary {
  return {
    id: "c1",
    kind: "public",
    name: "room",
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
  };
}

const names = (members: { username: string }[]) =>
  members.map((m) => m.username);

beforeEach(() => {
  useChannelMembers.mockReset();
  useChannelMembers.mockReturnValue({
    data: [
      { id: 1, username: "me", photo: null, canRemove: false },
      { id: 2, username: "insider", photo: null, canRemove: false },
    ],
  });
});

describe("useMentionableMembers", () => {
  it("offers the whole workspace in a public channel", () => {
    const { result } = renderHook(() =>
      useMentionableMembers("w1", channel({ kind: "public" })),
    );
    expect(names(result.current)).toEqual(["me", "insider", "outsider"]);
    // A public channel's members are never fetched for this.
    expect(useChannelMembers).toHaveBeenCalledWith("w1", "c1", false);
  });

  it("offers only a private channel's members", () => {
    const { result } = renderHook(() =>
      useMentionableMembers("w1", channel({ kind: "private" })),
    );
    expect(useChannelMembers).toHaveBeenCalledWith("w1", "c1", true);
    expect(result.current).toEqual([
      { userId: "1", username: "me", photo: undefined },
      { userId: "2", username: "insider", photo: undefined },
    ]);
  });

  it("offers only a DM's people, from its summary", () => {
    const { result } = renderHook(() =>
      useMentionableMembers(
        "w1",
        channel({
          kind: "dm",
          name: null,
          members: [{ id: 3, username: "outsider", photo: "p.png" }],
        }),
      ),
    );
    expect(result.current).toEqual([
      { userId: "3", username: "outsider", photo: "p.png" },
    ]);
  });

  it("offers nobody until the channel is known or its members load", () => {
    useChannelMembers.mockReturnValue({ data: undefined });
    expect(
      renderHook(() => useMentionableMembers("w1", undefined)).result.current,
    ).toEqual([]);
    expect(
      renderHook(() => useMentionableMembers("w1", channel({ kind: "private" })))
        .result.current,
    ).toEqual([]);
  });
});
