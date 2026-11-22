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
    if (this.getAttribute("aria-label") !== "New messages") return r;
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
      screen.queryByRole("separator", { name: "New messages" });
    const findDivider = () => screen.findByRole("separator", { name: "New messages" });

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
      expect(document.querySelector("[aria-live=polite]")).toHaveTextContent(
        "2 new messages",
      );
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
});
