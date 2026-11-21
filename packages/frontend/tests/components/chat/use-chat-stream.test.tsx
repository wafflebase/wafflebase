import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary, ChatMessageDto } from "@/api/chat";
import { chatKeys } from "@/components/chat/chat-cache";
import {
  setOpenChatChannel,
  useChatStream,
} from "@/components/chat/use-chat-stream";

const fetchMessagesSpy = vi.fn<
  (
    workspaceId: string,
    channelId: string,
    opts: { before?: number; after?: number; thread?: string },
  ) => Promise<ChatMessageDto[]>
>();

vi.mock("@/api/chat", () => ({
  CHAT_PAGE_SIZE: 50,
  chatStreamUrl: () => "http://api.test/chat/stream",
  fetchMessages: (
    w: string,
    c: string,
    o: { before?: number; after?: number; thread?: string },
  ) => fetchMessagesSpy(w, c, o),
  fetchChannels: () => Promise.resolve([]),
}));

/** A stand-in `EventSource` the test can push named events through. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  readyState = 1;
  closed = false;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  constructor(
    public url: string,
    public init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: unknown) {
    const e = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

const msg = (seq: number, over: Partial<ChatMessageDto> = {}) =>
  ({
    id: `m${seq}`,
    channelId: "c1",
    seq,
    author: { id: 2, username: "minji", photo: null },
    body: `message ${seq}`,
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deleted: false,
    createdAt: "2026-11-20T10:00:00.000Z",
    ...over,
  }) satisfies ChatMessageDto;

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

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["me"], { id: 1, username: "me" });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const view = renderHook(() => useChatStream(true), { wrapper });
  const source = FakeEventSource.instances.at(-1)!;
  return { queryClient, source, view };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  setOpenChatChannel(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useChatStream", () => {
  it("opens one stream with credentials and closes it on unmount", () => {
    const { source, view } = harness();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.url).toBe("http://api.test/chat/stream");
    expect(source.init).toEqual({ withCredentials: true });
    view.unmount();
    expect(source.closed).toBe(true);
  });

  it("ready event refetches the open channel after its last seq", async () => {
    // Messages 4 and 5 were posted while the client was offline; nothing
    // announced them, so only the reconnect can.
    fetchMessagesSpy.mockResolvedValue([msg(4), msg(5)]);
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(1), msg(2), msg(3)]);
    setOpenChatChannel({ workspaceId: "w1", channelId: "c1" });

    act(() => source.emit("ready", {}));

    await waitFor(() =>
      expect(
        queryClient
          .getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))
          ?.map((m) => m.seq),
      ).toEqual([1, 2, 3, 4, 5]),
    );
    expect(fetchMessagesSpy).toHaveBeenCalledWith("w1", "c1", { after: 3 });
  });

  it("keeps paging a catch-up until a short page", async () => {
    const full = Array.from({ length: 50 }, (_, i) => msg(i + 4));
    fetchMessagesSpy
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([msg(54)]);
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(3)]);
    setOpenChatChannel({ workspaceId: "w1", channelId: "c1" });

    act(() => source.emit("ready", {}));

    await waitFor(() => expect(fetchMessagesSpy).toHaveBeenCalledTimes(2));
    expect(fetchMessagesSpy).toHaveBeenLastCalledWith("w1", "c1", {
      after: 53,
    });
  });

  it("ready event invalidates every workspace's channel list", async () => {
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.channels("w1"), [channel("c1")]);

    act(() => source.emit("ready", {}));

    await waitFor(() =>
      expect(
        queryClient.getQueryState(chatKeys.channels("w1"))?.isInvalidated,
      ).toBe(true),
    );
  });

  it("counts a message in a closed channel as unread", async () => {
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.channels("w1"), [channel("c2")]);

    act(() =>
      source.emit("message", {
        workspaceId: "w1",
        channelId: "c2",
        seq: 9,
        threadRootId: null,
        authorId: 2,
      }),
    );

    await waitFor(() =>
      expect(
        queryClient.getQueryData<ChannelSummary[]>(chatKeys.channels("w1"))?.[0]
          .unreadCount,
      ).toBe(1),
    );
    expect(fetchMessagesSpy).not.toHaveBeenCalled();
  });

  it("fetches the open channel from its own last seq on a message", async () => {
    fetchMessagesSpy.mockResolvedValue([msg(4)]);
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(3)]);
    setOpenChatChannel({ workspaceId: "w1", channelId: "c1" });

    act(() =>
      source.emit("message", {
        workspaceId: "w1",
        channelId: "c1",
        seq: 4,
        threadRootId: null,
        authorId: 2,
      }),
    );

    await waitFor(() =>
      expect(fetchMessagesSpy).toHaveBeenCalledWith("w1", "c1", { after: 3 }),
    );
  });

  it("debounces the channel-list refresh per workspace", () => {
    vi.useFakeTimers();
    try {
      const { queryClient, source } = harness();
      queryClient.setQueryData(chatKeys.channels("w1"), [channel("c1")]);
      queryClient.setQueryData(chatKeys.channels("w2"), [channel("c2")]);
      const event = (workspaceId: string, channelId: string) => ({
        workspaceId,
        channelId,
        seq: 1,
        threadRootId: null,
        authorId: 2,
      });

      // A message in w2 must not cancel w1's pending refresh.
      act(() => source.emit("message", event("w1", "c1")));
      act(() => source.emit("message", event("w2", "c2")));
      act(() => vi.advanceTimersByTime(5_000));

      for (const w of ["w1", "w2"]) {
        expect(
          queryClient.getQueryState(chatKeys.channels(w))?.isInvalidated,
        ).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a malformed frame", () => {
    const { source } = harness();
    expect(() => source.emit("message", { channelId: 4 })).not.toThrow();
    expect(fetchMessagesSpy).not.toHaveBeenCalled();
  });
});

describe("catch-up during the first load", () => {
  it("remembers an event that arrived while the first page loaded", async () => {
    const { catchUpChannel, takePendingCatchUp } = await import(
      "@/components/chat/use-chat-stream"
    );
    const queryClient = new QueryClient();
    let release: (v: ChatMessageDto[]) => void = () => {};
    void queryClient.fetchQuery({
      queryKey: chatKeys.messages("c9"),
      queryFn: () => new Promise<ChatMessageDto[]>((r) => (release = r)),
    });

    await catchUpChannel(queryClient, "w1", "c9");

    expect(fetchMessagesSpy).not.toHaveBeenCalled();
    expect(takePendingCatchUp("c9")).toBe(true);
    expect(takePendingCatchUp("c9")).toBe(false);
    release([]);
  });
});
