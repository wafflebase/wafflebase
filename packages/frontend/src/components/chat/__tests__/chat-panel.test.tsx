import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChannelSummary } from "@/api/chat";

vi.mock("@/api/auth", () => ({ fetchMe: vi.fn(async () => ({ id: 1 })) }));
vi.mock("@/api/workspaces", () => ({
  fetchWorkspaces: vi.fn(async () => [{ id: "w1", slug: "acme", name: "Acme" }]),
}));
vi.mock("@/api/chat", () => ({ fetchChannels: vi.fn() }));
vi.mock("../conversation", () => ({
  Conversation: ({ channelId, placeholder }: { channelId: string; placeholder: string }) => (
    <div data-testid="conversation" data-channel={channelId}>
      {placeholder}
    </div>
  ),
}));
vi.mock("../thread-view", () => ({ ThreadView: () => null }));

import { fetchChannels } from "@/api/chat";
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
    ]);
  });

  it("shows the last opened channel with a link to it on the Chat page", async () => {
    writeLastChannel("w1", "planning");
    renderPanel();
    const conversation = await screen.findByTestId("conversation");
    expect(conversation.dataset.channel).toBe("planning");
    expect(conversation.textContent).toBe("Message #planning");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open in Chat" }).getAttribute("href")).toBe(
        "/w/acme/chat/planning",
      ),
    );
    expect(screen.getByRole("button", { name: /Channel: planning/ })).toBeTruthy();
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
    await waitFor(() => expect(draftStore.get("general")).toBe("See /s/doc-1"));
  });
});
