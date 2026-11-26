import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChannelSummary } from "@/api/chat";

vi.mock("@/api/auth", () => ({ fetchMe: vi.fn(async () => ({ id: 1 })) }));
vi.mock("@/api/workspaces", () => ({
  fetchWorkspaces: vi.fn(async () => [{ id: "w1", slug: "acme", name: "Acme" }]),
}));
vi.mock("@/api/chat", () => ({
  fetchChannels: vi.fn(),
  fetchDocumentSharedIn: vi.fn(),
}));
let conversationMounts = 0;
vi.mock("../conversation", async () => {
  const { useState } = await import("react");
  return { Conversation: MockConversation };
  function MockConversation({
    channelId,
    placeholder,
    onOpenThread,
    draftSeed,
  }: {
    channelId: string;
    placeholder: string;
    onOpenThread: (rootId: string) => void;
    draftSeed?: number;
  }) {
    const [mount] = useState(() => ++conversationMounts);
    return (
    <div
      data-testid="conversation"
      data-channel={channelId}
      data-mount={mount}
      data-draft-seed={draftSeed}
    >
      <span data-testid="placeholder">{placeholder}</span>
      <button type="button" onClick={() => onOpenThread("root-1")}>
        Open thread
      </button>
    </div>
    );
  }
});
vi.mock("../thread-view", () => ({
  ThreadView: ({ rootId }: { rootId: string }) => (
    <div data-testid="thread" data-root={rootId} />
  ),
}));

import { fetchChannels, fetchDocumentSharedIn } from "@/api/chat";
import { useChatPanel } from "../chat-panel-context";
import { ChatPanel } from "../chat-panel";
import { ChatPanelProvider } from "../chat-panel-provider";
import { draftStore } from "../draft-store";
import { writeLastChannel } from "../last-channel";

function channel(id: string, over: Partial<ChannelSummary> = {}): ChannelSummary {
  return {
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
  } as ChannelSummary;
}

let api: ReturnType<typeof useChatPanel>;
function Grab() {
  api = useChatPanel();
  return null;
}

function renderPanel(url = "/s/doc-1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <ChatPanelProvider open onOpenChange={() => {}}>
          <Grab />
          <ChatPanel workspaceId="w1" documentId="doc-1" />
        </ChatPanelProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ChatPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.mocked(fetchChannels).mockResolvedValue([
      channel("general", { isDefault: true }),
      channel("planning"),
      channel("design"),
    ]);
    vi.mocked(fetchDocumentSharedIn).mockResolvedValue([]);
  });

  it("shows the last opened channel with a link to it on the Chat page", async () => {
    writeLastChannel("w1", "planning");
    renderPanel();
    const conversation = await screen.findByTestId("conversation");
    expect(conversation.dataset.channel).toBe("planning");
    expect(screen.getByTestId("placeholder").textContent).toBe("Message #planning");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open in Chat" }).getAttribute("href")).toBe(
        "/w/acme/chat/planning",
      ),
    );
    expect(screen.getByRole("button", { name: /Channel: planning/ })).toBeTruthy();
  });

  it("hands a new draft to the shown conversation without remounting it", async () => {
    renderPanel();
    const conversation = await screen.findByTestId("conversation");
    const mount = conversation.dataset.mount;
    act(() => api.open({ draft: "See /s/doc-1" }));
    await waitFor(() =>
      expect(screen.getByTestId("conversation").dataset.draftSeed).toBe("1"),
    );
    act(() => api.open({ draft: "See /s/doc-1 again" }));
    await waitFor(() =>
      expect(screen.getByTestId("conversation").dataset.draftSeed).toBe("2"),
    );
    expect(screen.getByTestId("conversation").dataset.mount).toBe(mount);
  });

  it("follows ?chat= over the last opened channel", async () => {
    writeLastChannel("w1", "planning");
    renderPanel("/s/doc-1?chat=general");
    expect((await screen.findByTestId("conversation")).dataset.channel).toBe("general");
  });

  it("puts a draft asked for without a channel into the one it shows", async () => {
    renderPanel();
    await screen.findByTestId("conversation");
    act(() => api.open({ draft: "See /s/doc-1" }));
    await waitFor(() => expect(draftStore.get(1, "general")).toBe("See /s/doc-1"));
  });

  it("opens on the channel the document was last shared in over the last opened", async () => {
    writeLastChannel("w1", "planning");
    vi.mocked(fetchDocumentSharedIn).mockResolvedValue([
      { channelId: "design", sharedAt: "2026-11-25T00:00:00Z" },
      { channelId: "general", sharedAt: "2026-11-24T00:00:00Z" },
    ]);
    renderPanel();
    expect((await screen.findByTestId("conversation")).dataset.channel).toBe("design");
    expect(fetchDocumentSharedIn).toHaveBeenCalledWith("w1", "doc-1");
  });

  it("waits for where the document was shared before placing a draft", async () => {
    let answer!: (v: { channelId: string; sharedAt: string }[]) => void;
    vi.mocked(fetchDocumentSharedIn).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderPanel();
    act(() => api.open({ draft: "See /s/doc-1" }));
    await waitFor(() => expect(fetchChannels).toHaveBeenCalled());
    expect(screen.queryByTestId("conversation")).toBeNull();
    await act(async () => answer([{ channelId: "design", sharedAt: "2026-11-25T00:00:00Z" }]));
    expect((await screen.findByTestId("conversation")).dataset.channel).toBe("design");
    expect(draftStore.get(1, "design")).toBe("See /s/doc-1");
    expect(draftStore.get(1, "general")).toBe("");
  });

  it("falls back when asking where the document was shared fails", async () => {
    vi.mocked(fetchDocumentSharedIn).mockRejectedValue(new Error("nope"));
    renderPanel();
    expect((await screen.findByTestId("conversation")).dataset.channel).toBe("general");
  });

  it("closes an open thread when the channel changes, for good", async () => {
    renderPanel();
    await screen.findByTestId("conversation");
    act(() => screen.getByRole("button", { name: "Open thread" }).click());
    expect((await screen.findByTestId("thread")).dataset.root).toBe("root-1");

    act(() => api.open({ channelId: "planning" }));
    expect((await screen.findByTestId("conversation")).dataset.channel).toBe("planning");
    act(() => api.open({ channelId: "general" }));
    expect((await screen.findByTestId("conversation")).dataset.channel).toBe("general");
    expect(screen.queryByTestId("thread")).toBeNull();
  });
});
