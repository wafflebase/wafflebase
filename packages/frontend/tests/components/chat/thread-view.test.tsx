import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageDto } from "@/api/chat";
import { ThreadView } from "@/components/chat/thread-view";

const msg = (seq: number, authorId = 2): ChatMessageDto => ({
  id: `m${seq}`,
  channelId: "c1",
  seq,
  author: { id: authorId, username: `user${authorId}`, photo: null },
  body: `message ${seq}`,
  threadRootId: seq === 1 ? null : "m1",
  alsoInChannel: false,
  replyCount: seq === 1 ? 5 : 0,
  lastReplyAt: null,
  editedAt: null,
  deleted: false,
  createdAt: "2026-11-20T10:00:00.000Z",
});

let threadData: ChatMessageDto[] = [];
let threadState: {
  error: Error | null;
  hasOlder: boolean;
} = { error: null, hasOlder: false };
const retryThread = vi.fn(() => Promise.resolve());
const loadOlder = vi.fn(() => Promise.resolve());
const send = vi.fn(() => Promise.resolve());
const joinMutate = vi.fn();
let channel = {
  id: "c1",
  kind: "public",
  name: "q4-planning",
  isMember: true,
  archived: false,
};

vi.mock("@/api/auth", () => ({ fetchMe: async () => ({ id: 1 }) }));
vi.mock("@/api/chat", () => ({
  CHAT_BODY_MAX: 4000,
  fetchMessage: vi.fn(),
  fetchMessages: vi.fn(),
}));
vi.mock("@/components/comments/use-workspace-members", () => ({
  useWorkspaceMembers: () => [],
}));
vi.mock("@/components/chat/use-chat", () => ({
  useChannels: () => ({ data: [channel] }),
  useThreadMessages: () => ({
    data: threadData,
    isLoading: false,
    error: threadState.error,
    retry: retryThread,
    hasOlder: threadState.hasOlder,
    loadingOlder: false,
    loadOlder,
  }),
  usePendingMessages: () => [],
  useSendMessage: () => ({ send, retry: vi.fn(), discard: vi.fn() }),
  useJoinChannel: () => ({ mutate: joinMutate, isPending: false }),
  useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useEditMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));

// jsdom does no layout: give every scroller a tall content box and a
// writable scrollTop so the view's scroll decisions are observable.
const tops = new WeakMap<Element, number>();
const intoView: string[] = [];
const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  for (const k of ["scrollHeight", "clientHeight", "scrollTop"]) {
    saved[k] = Object.getOwnPropertyDescriptor(Element.prototype, k);
  }
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get: () => 2000,
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get: () => 500,
  });
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return tops.get(this) ?? 0;
    },
    set(this: Element, v: number) {
      tops.set(this, v);
    },
  });
  Element.prototype.scrollIntoView = function (this: Element) {
    intoView.push(this.id);
  };
});
afterAll(() => {
  for (const [k, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(Element.prototype, k, d);
  }
});

function renderThread(highlightMessageId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={client}>
      <ThreadView
        workspaceId="w1"
        channelId="c1"
        rootId="m1"
        highlightMessageId={highlightMessageId}
      />
    </QueryClientProvider>
  );
  const r = render(ui());
  return { ...r, rerenderThread: () => r.rerender(ui()) };
}

const log = () =>
  document.getElementById("chat-message-m1")!.closest<HTMLElement>(
    ".overflow-y-auto",
  )!;

describe("ThreadView scroll", () => {
  beforeEach(() => {
    threadData = [1, 2, 3, 4, 5, 6].map((s) => msg(s));
    intoView.length = 0;
    send.mockClear();
    joinMutate.mockReset();
    channel = { ...channel, isMember: true, archived: false };
    threadState = { error: null, hasOlder: false };
    retryThread.mockClear();
    loadOlder.mockClear();
  });

  it("opens with the root at the top", () => {
    renderThread();
    expect(document.getElementById("chat-message-m1")).toBeInTheDocument();
    expect(log().scrollTop).toBe(0);
  });

  it("a deep link scrolls the targeted reply into view", () => {
    renderThread("m4");
    expect(intoView).toContain("chat-message-m4");
    expect(log().scrollTop).toBe(0);
  });

  it("does not yank a reader at the top when someone else replies", () => {
    const { rerenderThread } = renderThread();
    threadData = [...threadData, msg(7, 3)];
    rerenderThread();
    expect(log().scrollTop).toBe(0);
  });

  it("follows the reader's own reply to the bottom", async () => {
    const { rerenderThread } = renderThread();
    const box = screen.getByRole("textbox", { name: "Reply…" });
    fireEvent.change(box, { target: { value: "on it" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        body: "on it",
        threadRootId: "m1",
        alsoInChannel: false,
      }),
    );
    threadData = [...threadData, msg(7, 1)];
    rerenderThread();
    expect(log().scrollTop).toBe(2000);
  });

  it("is a labelled region, not a live log", () => {
    renderThread();
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("tells a non-member of a public channel to join to reply", () => {
    channel = { ...channel, isMember: false };
    renderThread();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Join #q4-planning to reply.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join channel" }));
    expect(joinMutate).toHaveBeenCalledWith("c1", expect.anything());
  });

  it("offers no join on an archived channel, and says why it is read-only", () => {
    channel = { ...channel, isMember: false, archived: true };
    renderThread();
    expect(screen.queryByRole("button", { name: "Join channel" })).toBeNull();
    expect(
      screen.getByText("This channel is archived. You can read it, but not post."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Reply…" })).toBeDisabled();
  });

  it("adds no second Thread landmark inside the page's own", () => {
    renderThread();
    expect(screen.queryByRole("region", { name: "Thread" })).toBeNull();
  });

  it("offers Retry when the thread fails to load", () => {
    threadState = { error: new Error("boom"), hasOlder: false };
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryThread).toHaveBeenCalledTimes(1);
  });

  it("reads earlier replies on demand instead of dropping them", () => {
    threadState = { error: null, hasOlder: true };
    threadData = [msg(1), ...[60, 61, 62].map((s) => msg(s))].map((m) =>
      m.id === "m1" ? { ...m, replyCount: 700 } : m,
    );
    renderThread();
    // The root's count covers the replies not loaded yet.
    expect(screen.getByText("700 replies")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show earlier replies" }));
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it("is one tab stop that starts at the newest reply", () => {
    renderThread();
    const rows = document.querySelectorAll("[data-message-row]");
    const stops = [...rows].filter((r) => r.getAttribute("tabindex") === "0");
    expect(stops.map((r) => r.id)).toEqual(["chat-message-m6"]);
    fireEvent.keyDown(stops[0], { key: "Home" });
    expect(document.getElementById("chat-message-m1")).toHaveFocus();
  });
});
