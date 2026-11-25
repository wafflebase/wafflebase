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
  isDefault: false,
  isMember: true,
  canManage: false,
  members: [],
  // The log below runs 1..5, all read.
  lastSeq: 5,
  lastReadSeq: 5,
  unreadCount: 0,
  mentionCount: 0,
  lastMessageAt: null,
  ...over,
});
/** A channel whose newest `n` messages were unread at open. */
const unread = (n: number) => channel({ lastReadSeq: 5 - n, unreadCount: n });

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
const send = vi.fn(() => Promise.resolve());
const retrySend = vi.fn(() => Promise.resolve());
const discardSend = vi.fn();
const retryLoad = vi.fn();
const openThread = vi.fn();
let pending: ChatMessageDto[] = [];
let loadError: Error | null = null;

vi.mock("@/api/auth", () => ({ fetchMe: async () => ({ id: 1 }) }));
vi.mock("@/api/chat", () => ({
  CHAT_BODY_MAX: 4000,
  fetchMessage: vi.fn(),
  fetchMessages: vi.fn(),
}));
vi.mock("@/components/comments/use-workspace-members", () => ({
  useWorkspaceMembers: () => [],
}));
vi.mock("@/components/chat/use-mentionable-members", () => ({
  useMentionableMembers: () => [],
}));
vi.mock("@/components/chat/use-chat-stream", () => ({
  setOpenChatChannel: vi.fn(),
}));
vi.mock("@/components/chat/use-chat", () => ({
  useChannels: () => ({ data: channels }),
  useChannelMessages: () => {
    const s = useSyncExternalStore(subscribe, () => state);
    return { ...s, isLoading: false, error: loadError, loadOlder, retry: retryLoad };
  },
  usePendingMessages: () => pending,
  useSendMessage: () => ({ send, retry: retrySend, discard: discardSend }),
  useJoinChannel: () => ({ mutate: joinMutate, isPending: false }),
  useMarkRead: () => markRead,
  useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useEditMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));

// jsdom does no layout: give the scroller a content height the test controls
// and a writable scrollTop, so the view's scroll decisions are observable.
let contentHeight = 2000;
let dividerTop = 0;
const tops = new WeakMap<Element, number>();
const intoView: string[] = [];
const saved: Record<string, PropertyDescriptor | undefined> = {};
const savedRect = Element.prototype.getBoundingClientRect;
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
  // The divider's place relative to the scroller's top, which the test sets.
  // jsdom puts every rect at 0, so the log itself sits at 0.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const r = savedRect.call(this);
    if (!this.hasAttribute("data-unread-divider")) return r;
    return { ...r, top: dividerTop } as DOMRect;
  };
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = savedRect;
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
        onOpenThread={openThread}
        highlightMessageId={highlightMessageId}
      />
    </QueryClientProvider>,
  );
}

const log = () => screen.getByRole("region", { name: "Messages in #general" });

/** Put the reader at `top` and let the view see the scroll. */
function scrollTo(top: number) {
  log().scrollTop = top;
  fireEvent.scroll(log());
}

describe("Conversation", () => {
  beforeEach(() => {
    contentHeight = 2000;
    dividerTop = 0;
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
    send.mockClear();
    retryLoad.mockReset();
    retrySend.mockClear();
    discardSend.mockClear();
    pending = [];
    loadError = null;
    openThread.mockReset();
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

  it("says an archived channel is read-only", () => {
    channels = [channel({ archived: true })];
    renderConversation();
    expect(screen.getByRole("status")).toHaveTextContent(
      "This channel is archived",
    );
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("offers no Join on an archived public channel the reader is not in", () => {
    // The server refuses to join an archived channel, so the page must not
    // offer it: the reader gets the archived read-only state instead.
    channels = [channel({ isMember: false, archived: true })];
    renderConversation();
    expect(screen.queryByRole("button", { name: "Join channel" })).toBeNull();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("shows no archive banner on a live channel", () => {
    renderConversation();
    expect(screen.queryByText(/This channel is archived\. Its history/)).toBeNull();
  });

  it("shows the composer to a member", () => {
    renderConversation();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join channel" })).toBeNull();
  });
  describe("unread orientation", () => {
    const divider = () =>
      screen.queryByRole("heading", { name: "New messages" })?.closest("li") ?? null;
    const findDivider = async () =>
      (await screen.findByRole("heading", { name: "New messages" })).closest("li")!;

    it("draws no divider when nothing was unread", async () => {
      renderConversation();
      await act(async () => {});
      expect(divider()).toBeNull();
    });

    it("draws the divider above the first unread message", async () => {
      channels = [unread(2)];
      renderConversation();
      const sep = await findDivider();
      // Directly before m4's group.
      expect(sep.nextElementSibling?.querySelector("#chat-message-m4")).not.toBeNull();
    });

    it("opens at the divider when it is out of view, without reading", async () => {
      channels = [unread(3)];
      dividerTop = -700;
      renderConversation();
      await findDivider();
      // From the bottom (2000), up by the 700 above the viewport, plus margin.
      expect(log().scrollTop).toBe(2000 - 700 - 8);
      expect(markRead).not.toHaveBeenCalled();
      // Everything below the divider is new.
      expect(
        screen.getByRole("button", { name: /3 new messages/ }),
      ).toBeInTheDocument();
    });

    it("stays at the bottom and reads when the divider is in view", async () => {
      channels = [unread(1)];
      renderConversation();
      await findDivider();
      expect(log().scrollTop).toBe(2000);
      expect(markRead).toHaveBeenCalledWith(5);
    });

    it("keeps the divider in place as the read position advances", async () => {
      channels = [unread(2)];
      renderConversation();
      await findDivider();
      // Reading moves the cached read position; new messages arrive.
      channels = [channel({ lastSeq: 7, lastReadSeq: 7 })];
      act(() => setState({ messages: [...state.messages, msg(6), msg(7)] }));
      const sep = divider();
      expect(sep?.nextElementSibling?.querySelector("#chat-message-m4")).not.toBeNull();
    });

    it("draws no divider for a message that arrives while reading", async () => {
      renderConversation();
      act(() => setState({ messages: [...state.messages, msg(6)] }));
      await act(async () => {});
      expect(divider()).toBeNull();
    });

    it("places the divider once a stale cache catches up", async () => {
      channels = [unread(2)];
      setState({ messages: [1, 2, 3].map((s) => msg(s)) });
      renderConversation();
      await act(async () => {});
      expect(divider()).toBeNull();

      // The catch-up brings in the two unread messages.
      act(() => setState({ messages: [1, 2, 3, 4, 5].map((s) => msg(s)) }));
      const sep = await findDivider();
      expect(sep.nextElementSibling?.querySelector("#chat-message-m4")).not.toBeNull();
    });
  });

  describe("jump to latest", () => {
    it("is hidden at the bottom", () => {
      renderConversation();
      expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
    });

    it("appears when scrolled away and counts what arrives", async () => {
      renderConversation();
      await act(async () => {});
      scrollTo(300);
      expect(
        screen.getByRole("button", { name: "Jump to latest" }),
      ).toBeInTheDocument();

      act(() =>
        setState({
          messages: [...state.messages, msg(6), msg(7, 1), msg(8)],
        }),
      );
      // m7 is mine: not counted.
      expect(
        screen.getByRole("button", { name: "2 new messages" }),
      ).toBeInTheDocument();
      const regions = document.querySelectorAll("[aria-live=polite]");
      // Arrivals and the waiting count are separate regions, so a change in
      // the count does not re-read the last arrival.
      expect(regions[1]).toHaveTextContent("2 new messages below.");
      expect(regions[0]).not.toHaveTextContent("new messages below");
    });

    it("scrolls to the bottom when clicked, smoothly unless motion is reduced", async () => {
      const scrollToSpy = vi.fn();
      Element.prototype.scrollTo = scrollToSpy as unknown as Element["scrollTo"];
      const reduce = vi.fn(() => ({ matches: true }) as MediaQueryList);
      vi.stubGlobal("matchMedia", reduce);
      try {
        renderConversation();
        scrollTo(300);
        fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
        expect(scrollToSpy).toHaveBeenCalledWith({ top: 2000, behavior: "auto" });

        reduce.mockReturnValue({ matches: false } as MediaQueryList);
        fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
        expect(scrollToSpy).toHaveBeenLastCalledWith({
          top: 2000,
          behavior: "smooth",
        });
      } finally {
        vi.unstubAllGlobals();
        // @ts-expect-error -- jsdom has no Element.scrollTo of its own.
        delete Element.prototype.scrollTo;
      }
    });

    it("moves focus to the composer only for a keyboard activation", () => {
      renderConversation();
      scrollTo(300);
      const pill = screen.getByRole("button", { name: "Jump to latest" });
      // Chrome focuses a button on mousedown, so focus alone cannot tell a
      // tap from Enter; a pointer click carries detail >= 1.
      pill.focus();
      fireEvent.click(pill, { detail: 1 });
      expect(screen.getByRole("textbox")).not.toHaveFocus();

      scrollTo(300);
      const again = screen.getByRole("button", { name: "Jump to latest" });
      again.focus();
      fireEvent.click(again, { detail: 0 });
      expect(screen.getByRole("textbox")).toHaveFocus();
    });

    it("hides again once the reader is back at the bottom", () => {
      renderConversation();
      scrollTo(300);
      scrollTo(1500);
      expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
    });
  });

  describe("screen reader", () => {
    const live = () => document.querySelector("[aria-live=polite]");

    it("is a labelled region, not a live log", () => {
      renderConversation();
      expect(screen.queryByRole("log")).toBeNull();
      expect(log()).toBeInTheDocument();
    });

    it("announces only others' messages arriving at the end", async () => {
      renderConversation();
      await act(async () => {});
      expect(live()).toHaveTextContent("");

      act(() => setState({ messages: [...state.messages, msg(6, 1)] }));
      // Mine: nothing to announce.
      expect(live()?.textContent).toBe("");

      act(() => setState({ messages: [...state.messages, msg(7, 3)] }));
      expect(live()).toHaveTextContent("user3: message 7");
    });

    it("re-announces the same words arriving twice", async () => {
      renderConversation();
      await act(async () => {});
      const same = { body: "ok" };
      act(() =>
        setState({ messages: [...state.messages, { ...msg(6, 3), ...same }] }),
      );
      const first = live()?.textContent;
      act(() =>
        setState({ messages: [...state.messages, { ...msg(7, 3), ...same }] }),
      );
      expect(live()).toHaveTextContent("user3: ok");
      expect(live()?.textContent).not.toBe(first);
    });

    it("says nothing when older messages are prepended", async () => {
      renderConversation();
      await act(async () => {});
      act(() => setState({ messages: [msg(-1), msg(0), ...state.messages] }));
      expect(live()?.textContent).toBe("");
    });

    it("reads a continuation line's author and time", () => {
      renderConversation();
      const line = document.getElementById("chat-message-m2")!;
      expect(line.querySelector(".sr-only")).toHaveTextContent(/^user2, .+:/);
    });

    it("marks days with headings", () => {
      renderConversation();
      expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
    });
  });

  describe("keyboard", () => {
    const row = (id: string) => document.getElementById(`chat-message-${id}`)!;

    it("is one tab stop, resting on the newest message", () => {
      renderConversation();
      expect(row("m5")).toHaveAttribute("tabindex", "0");
      expect(row("m4")).toHaveAttribute("tabindex", "-1");
      // The hidden toolbars of other messages are out of the tab order.
      const replies = screen.getAllByRole("button", { name: "Reply in thread" });
      const tabbable = replies.filter((b) => b.tabIndex >= 0);
      expect(tabbable).toHaveLength(1);
      expect(row("m5")).toContainElement(tabbable[0]);
    });

    it("moves with the arrows and Home/End, and Enter opens the thread", () => {
      renderConversation();
      row("m5").focus();
      fireEvent.keyDown(row("m5"), { key: "ArrowUp" });
      expect(row("m4")).toHaveFocus();
      expect(row("m4")).toHaveAttribute("tabindex", "0");
      expect(row("m5")).toHaveAttribute("tabindex", "-1");

      fireEvent.keyDown(row("m4"), { key: "Home" });
      expect(row("m1")).toHaveFocus();
      fireEvent.keyDown(row("m1"), { key: "End" });
      expect(row("m5")).toHaveFocus();

      fireEvent.keyDown(row("m5"), { key: "Enter" });
      expect(openThread).toHaveBeenCalledWith("m5");
    });

    it("Escape on a message returns to the composer", () => {
      renderConversation();
      row("m5").focus();
      fireEvent.keyDown(row("m5"), { key: "Escape" });
      expect(screen.getByRole("textbox")).toHaveFocus();
    });

    it("↑ in the empty composer edits my last message, and Esc comes back", async () => {
      state = { ...state, messages: [msg(1), msg(2, 1), msg(3)] };
      renderConversation();
      // Who "me" is arrives with the auth query.
      await act(() => new Promise((r) => setTimeout(r, 0)));
      const composer = screen.getByRole("textbox");
      composer.focus();
      fireEvent.keyDown(composer, { key: "ArrowUp" });
      const edit = screen.getByRole("textbox", { name: "Edit message" });
      expect(row("m2")).toContainElement(edit);
      expect(edit).toHaveFocus();

      fireEvent.keyDown(edit, { key: "Escape" });
      expect(screen.queryByRole("textbox", { name: "Edit message" })).toBeNull();
      expect(screen.getByRole("textbox")).toHaveFocus();
    });
  });

  describe("sending", () => {
    it("clears the box at once and sends optimistically", () => {
      renderConversation();
      const box = screen.getByRole("textbox");
      fireEvent.change(box, { target: { value: "hello" } });
      fireEvent.keyDown(box, { key: "Enter" });
      expect(send).toHaveBeenCalledWith({ body: "hello" });
      expect(box).toHaveValue("");
    });

    it("draws a first send in an empty channel, not the empty state", () => {
      state = { ...state, messages: [] };
      pending = [
        {
          ...msg(0, 1),
          id: "local-a",
          body: "first!",
          localState: "failed",
          clientId: "a",
        } as ChatMessageDto,
      ];
      renderConversation();
      expect(screen.queryByText("No messages yet")).toBeNull();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    it("draws a pending send dimmed and a failed one with Retry", () => {
      pending = [
        {
          ...msg(5, 1),
          id: "local-a",
          body: "on its way",
          localState: "pending",
          clientId: "a",
        } as ChatMessageDto,
        {
          ...msg(5, 1),
          id: "local-b",
          body: "lost",
          localState: "failed",
          clientId: "b",
        } as ChatMessageDto,
      ];
      renderConversation();
      expect(document.getElementById("chat-message-local-a")).toHaveTextContent(
        "Sending…",
      );
      const failed = screen.getByRole("group", { name: "Message not sent" });
      expect(failed).toHaveTextContent("Not sent");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(retrySend).toHaveBeenCalledWith("b");
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(discardSend).toHaveBeenCalledWith("b");
    });
  });

  it("offers Retry when the messages fail to load", () => {
    loadError = new Error("offline");
    renderConversation();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryLoad).toHaveBeenCalled();
  });
});
