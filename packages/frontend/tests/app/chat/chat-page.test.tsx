import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary, ChatMessageDto } from "@/api/chat";
import ChatPage from "@/app/chat/chat-page";

const fetchMessageSpy =
  vi.fn<
    (workspaceId: string, messageId: string) => Promise<ChatMessageDto | null>
  >();
const fetchChannelsSpy = vi.fn<(w: string) => Promise<ChannelSummary[]>>();
const mobile = { value: false };

vi.mock("@/api/chat", () => ({
  CHAT_PAGE_SIZE: 50,
  fetchMessage: (w: string, id: string) => fetchMessageSpy(w, id),
  fetchChannels: (w: string) => fetchChannelsSpy(w),
}));
vi.mock("@/api/auth", () => ({
  fetchMe: () => Promise.resolve({ id: 1, username: "me" }),
}));
vi.mock("@/api/workspaces", () => ({
  fetchWorkspaces: () =>
    Promise.resolve([{ id: "w1", slug: "team", name: "Team" }]),
}));
vi.mock("@/hooks/use-mobile", () => ({
  MOBILE_BREAKPOINT: 768,
  useIsMobile: () => mobile.value,
}));
// The page's own logic is the subject; its columns are stand-ins.
vi.mock("@/components/chat/conversation", () => ({
  Conversation: () => <div data-testid="conversation" />,
}));
vi.mock("@/components/chat/thread-view", () => ({
  ThreadView: () => <div data-testid="thread" />,
}));
vi.mock("@/app/chat/channel-list", () => ({
  ChannelList: () => <div data-testid="channel-list" />,
}));
vi.mock("@/app/chat/new-channel-dialog", () => ({
  NewChannelDialog: () => null,
}));
vi.mock("@/app/chat/new-dm-dialog", () => ({
  NewDmDialog: () => null,
  AddPeopleDialog: () => null,
}));

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

const reply = (over: Partial<ChatMessageDto> = {}) =>
  ({
    id: "r1",
    channelId: "c1",
    seq: 2,
    author: { id: 2, username: "minji", photo: null },
    body: "a reply",
    threadRootId: "root1",
    alsoInChannel: false,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deleted: false,
    createdAt: "2026-11-20T10:00:00.000Z",
    ...over,
  }) satisfies ChatMessageDto;

function renderAt(url: string) {
  const location: { current: string } = { current: url };
  function Probe(): ReactNode {
    const l = useLocation();
    location.current = `${l.pathname}${l.search}`;
    return null;
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/w/:workspaceId/chat/:channelId?"
            element={
              <>
                <ChatPage />
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return location;
}

/**
 * Let queries settle and effects run before asserting that nothing moved.
 * React Query batches its notifications on a timer, so microtasks alone do
 * not reach the effect a negative test is about.
 */
const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

beforeEach(() => {
  mobile.value = false;
  window.localStorage.clear();
  fetchChannelsSpy.mockResolvedValue([channel("c1"), channel("c2")]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ChatPage deep links", () => {
  it("opens the thread of a thread-only reply", async () => {
    fetchMessageSpy.mockResolvedValue(reply());
    const location = renderAt("/w/team/chat/c1?message=r1");

    await waitFor(() =>
      expect(location.current).toBe(
        "/w/team/chat/c1?message=r1&thread=root1",
      ),
    );
    expect(fetchMessageSpy).toHaveBeenCalledWith("w1", "r1");
  });

  it("leaves a reply also sent to the channel in the channel", async () => {
    fetchMessageSpy.mockResolvedValue(reply({ alsoInChannel: true }));
    const location = renderAt("/w/team/chat/c1?message=r1");

    await waitFor(() => expect(fetchMessageSpy).toHaveBeenCalled());
    await settle();
    expect(location.current).toBe("/w/team/chat/c1?message=r1");
  });

  it("does not look the message up when a thread is already open", async () => {
    fetchMessageSpy.mockResolvedValue(reply({ threadRootId: "other" }));
    const location = renderAt("/w/team/chat/c1?thread=root1&message=r1");

    await waitFor(() => expect(fetchChannelsSpy).toHaveBeenCalled());
    await settle();
    expect(fetchMessageSpy).not.toHaveBeenCalled();
    expect(location.current).toBe("/w/team/chat/c1?thread=root1&message=r1");
  });
});

describe("ChatPage last channel", () => {
  it("returns to the last channel on desktop", async () => {
    window.localStorage.setItem("wafflebase:chat-last:w1", "c2");
    const location = renderAt("/w/team/chat");

    await waitFor(() => expect(location.current).toBe("/w/team/chat/c2"));
  });

  it("stays on the list on a phone", async () => {
    mobile.value = true;
    window.localStorage.setItem("wafflebase:chat-last:w1", "c2");
    const location = renderAt("/w/team/chat");

    await waitFor(() => expect(fetchChannelsSpy).toHaveBeenCalled());
    await settle();
    expect(location.current).toBe("/w/team/chat");
  });
});
