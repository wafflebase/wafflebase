import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  fetchChannelMembers: () =>
    Promise.resolve([
      { id: 1, username: "me", photo: null },
      { id: 2, username: "minji", photo: null },
    ]),
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

  it("does not return to a channel the caller has left", async () => {
    fetchChannelsSpy.mockResolvedValue([
      channel("general", { isDefault: true }),
      // Left: a public channel stays in the list after you leave it.
      channel("c2", { isMember: false }),
    ]);
    window.localStorage.setItem("wafflebase:chat-last:w1", "c2");
    const location = renderAt("/w/team/chat");

    await waitFor(() =>
      expect(location.current).toBe("/w/team/chat/general"),
    );
  });

  it("opens the default channel when there is no last channel", async () => {
    fetchChannelsSpy.mockResolvedValue([
      channel("c2"),
      channel("general", { isDefault: true }),
    ]);
    const location = renderAt("/w/team/chat");

    await waitFor(() =>
      expect(location.current).toBe("/w/team/chat/general"),
    );
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

describe("ChatPage channel actions", () => {
  const openMenu = async () => {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Channel actions" }),
    );
    return screen.findByRole("menu");
  };

  it("offers rename, topic and archive to somebody who may manage it", async () => {
    fetchChannelsSpy.mockResolvedValue([channel("c1", { canManage: true })]);
    renderAt("/w/team/chat/c1");

    const menu = await openMenu();
    expect(menu).toHaveTextContent("Rename channel…");
    expect(menu).toHaveTextContent("Edit topic…");
    expect(menu).toHaveTextContent("Archive channel…");
    expect(menu).toHaveTextContent("Leave channel");
  });

  it("offers only membership actions to somebody who may not", async () => {
    fetchChannelsSpy.mockResolvedValue([channel("c1", { canManage: false })]);
    renderAt("/w/team/chat/c1");

    const menu = await openMenu();
    expect(menu).toHaveTextContent("Add people");
    expect(menu).toHaveTextContent("Leave channel");
    expect(menu).not.toHaveTextContent("Rename");
    expect(menu).not.toHaveTextContent("topic");
    expect(menu).not.toHaveTextContent("Archive");
  });

  it("offers only rename and topic on the default channel", async () => {
    fetchChannelsSpy.mockResolvedValue([
      channel("c1", { canManage: true, isDefault: true }),
    ]);
    renderAt("/w/team/chat/c1");

    const menu = await openMenu();
    expect(menu).toHaveTextContent("Rename channel…");
    expect(menu).toHaveTextContent("Edit topic…");
    expect(menu).not.toHaveTextContent("Add people");
    expect(menu).not.toHaveTextContent("Archive");
    expect(menu).not.toHaveTextContent("Leave");
  });

  it("offers no menu on the default channel to somebody who may not manage it", async () => {
    fetchChannelsSpy.mockResolvedValue([
      channel("c1", { canManage: false, isDefault: true }),
    ]);
    renderAt("/w/team/chat/c1");

    await screen.findByTestId("conversation");
    expect(
      screen.queryByRole("button", { name: "Channel actions" }),
    ).not.toBeInTheDocument();
  });

  it("offers unarchiving, not posting-time actions, on an archived channel", async () => {
    fetchChannelsSpy.mockResolvedValue([
      channel("c1", { canManage: true, archived: true }),
    ]);
    renderAt("/w/team/chat/c1");

    const menu = await openMenu();
    expect(menu).toHaveTextContent("Unarchive channel");
    expect(menu).not.toHaveTextContent("Rename");
    expect(menu).not.toHaveTextContent("Add people");
  });
});

describe("ChatPage members", () => {
  it("shows the member count on a channel and opens the list", async () => {
    const user = userEvent.setup();
    renderAt("/w/team/chat/c1");

    await user.click(
      await screen.findByRole("button", { name: "Members: 2" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Members of #c1" }),
    ).toBeInTheDocument();
  });

  it("shows no member control on a DM", async () => {
    fetchChannelsSpy.mockResolvedValue([
      channel("d1", {
        kind: "dm",
        name: null,
        members: [
          { id: 1, username: "me", photo: null },
          { id: 2, username: "minji", photo: null },
        ],
      }),
    ]);
    renderAt("/w/team/chat/d1");

    await screen.findByTestId("conversation");
    expect(
      screen.queryByRole("button", { name: /^Members/ }),
    ).not.toBeInTheDocument();
  });
});
