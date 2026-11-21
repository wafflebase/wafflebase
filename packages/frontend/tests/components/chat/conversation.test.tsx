import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ChannelSummary, ChatMessageDto } from "@/api/chat";
import { Conversation } from "@/components/chat/conversation";

const msg = (seq: number, authorId = 2): ChatMessageDto => ({
  id: `m${seq}`,
  channelId: "c1",
  seq,
  author: { id: authorId, username: `user${authorId}`, photo: null },
  body: `message ${seq}`,
  threadRootId: null,
  alsoInChannel: false,
  replyCount: 0,
  lastReplyAt: null,
  editedAt: null,
  deleted: false,
  createdAt: "2026-11-20T10:00:00.000Z",
});

const channel = (over: Partial<ChannelSummary> = {}): ChannelSummary => ({
  id: "c1",
  kind: "public",
  name: "general",
  topic: null,
  archived: false,
  isMember: true,
  members: [],
  unreadCount: 0,
  mentionCount: 0,
  lastMessageAt: null,
  ...over,
});

/**
 * What `useChannelMessages` returns, held in a tiny store so a test can
 * change it the way the cache would and the view re-renders on its own.
 */
interface MessagesState {
  messages: ChatMessageDto[];
  hasOlder: boolean;
  loadingOlder: boolean;
}
let state: MessagesState;
const listeners = new Set<() => void>();
function setState(patch: Partial<MessagesState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let channels: ChannelSummary[] = [];
const loadOlder = vi.fn<() => Promise<boolean>>();
const markRead = vi.fn();
const joinMutate = vi.fn();
const postMutateAsync = vi.fn(async () => undefined);

vi.mock("@/api/auth", () => ({ fetchMe: async () => ({ id: 1 }) }));
vi.mock("@/api/chat", () => ({
  CHAT_BODY_MAX: 4000,
  fetchMessage: vi.fn(),
  fetchMessages: vi.fn(),
}));
vi.mock("@/components/comments/use-workspace-members", () => ({
  useWorkspaceMembers: () => [],
}));
vi.mock("@/components/chat/use-chat-stream", () => ({
  setOpenChatChannel: vi.fn(),
}));
vi.mock("@/components/chat/use-chat", () => ({
  useChannels: () => ({ data: channels }),
  useChannelMessages: () => {
    const s = useSyncExternalStore(subscribe, () => state);
    return { ...s, isLoading: false, error: null, loadOlder };
  },
  usePostMessage: () => ({ mutateAsync: postMutateAsync }),
  useJoinChannel: () => ({ mutate: joinMutate, isPending: false }),
  useMarkRead: () => markRead,
  useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useEditMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));

// jsdom does no layout: give the scroller a content height the test controls
// and a writable scrollTop, so the view's scroll decisions are observable.
let contentHeight = 2000;
const tops = new WeakMap<Element, number>();
const intoView: string[] = [];
const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  for (const k of ["scrollHeight", "clientHeight", "scrollTop"]) {
    saved[k] = Object.getOwnPropertyDescriptor(Element.prototype, k);
  }
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get: () => contentHeight,
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

function renderConversation(highlightMessageId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Conversation
        workspaceId="w1"
        channelId="c1"
        onOpenThread={() => {}}
        highlightMessageId={highlightMessageId}
      />
    </QueryClientProvider>,
  );
}

const log = () => screen.getByRole("log", { name: "Messages" });

/** Put the reader at `top` and let the view see the scroll. */
function scrollTo(top: number) {
  log().scrollTop = top;
  fireEvent.scroll(log());
}

describe("Conversation", () => {
  beforeEach(() => {
    contentHeight = 2000;
    state = {
      messages: [1, 2, 3, 4, 5].map((s) => msg(s)),
      hasOlder: true,
      loadingOlder: false,
    };
    channels = [channel()];
    intoView.length = 0;
    loadOlder.mockReset();
    markRead.mockReset();
    joinMutate.mockReset();
  });

  it("opens at the newest message", () => {
    renderConversation();
    expect(log().scrollTop).toBe(2000);
  });

  it("follows a new message only while the reader is at the bottom", () => {
    renderConversation();

    contentHeight = 2100;
    act(() => setState({ messages: [...state.messages, msg(6)] }));
    expect(log().scrollTop).toBe(2100);

    scrollTo(300);
    contentHeight = 2200;
    act(() => setState({ messages: [...state.messages, msg(7)] }));
    // Reading history: not yanked to the end.
    expect(log().scrollTop).toBe(300);
  });

  it("keeps the reader's place when older messages are prepended", async () => {
    let resolve: (v: boolean) => void = () => {};
    loadOlder.mockImplementation(
      () => new Promise<boolean>((r) => (resolve = r)),
    );
    renderConversation();
    scrollTo(0);

    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    contentHeight = 2600;
    await act(async () => {
      setState({ messages: [msg(-1), msg(0), ...state.messages] });
      resolve(true);
    });

    // The 600px that appeared above shift the view by exactly that much.
    expect(log().scrollTop).toBe(600);
  });

  it("an empty older page does not hold the next message off the bottom", async () => {
    loadOlder.mockResolvedValue(false);
    renderConversation();
    // At the bottom, as a real scroller clamps it: height minus viewport.
    scrollTo(1500);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Load older messages" }),
      );
    });
    expect(log().scrollTop).toBe(1500);

    contentHeight = 2100;
    act(() => setState({ messages: [...state.messages, msg(6)] }));
    expect(log().scrollTop).toBe(2100);
  });

  it("scrolls a deep-linked message into view and highlights it", () => {
    renderConversation("m3");

    expect(intoView).toContain("chat-message-m3");
    expect(document.getElementById("chat-message-m3")?.className).toMatch(
      /bg-selected/,
    );
    expect(document.getElementById("chat-message-m4")?.className).not.toMatch(
      /bg-selected/,
    );
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it("pages back for a deep link that is not loaded yet", () => {
    loadOlder.mockResolvedValue(true);
    renderConversation("m-older");
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it("marks the newest message read while at the bottom", () => {
    renderConversation();
    expect(markRead).toHaveBeenCalledWith(5);
  });

  it("offers Join instead of the composer to a public non-member", () => {
    channels = [channel({ isMember: false })];
    renderConversation();

    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Join channel" }));
    expect(joinMutate).toHaveBeenCalledWith("c1", expect.anything());
    // Previewing is reading, not joining: no read position to move.
    expect(markRead).not.toHaveBeenCalled();
  });

  it("shows the composer to a member", () => {
    renderConversation();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join channel" })).toBeNull();
  });
});
