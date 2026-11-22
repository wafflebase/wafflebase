import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary, ChatMessageDto } from "@/api/chat";
import { chatKeys } from "@/components/chat/chat-cache";
import { getChatConnection } from "@/components/chat/chat-connection";
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

const fetchMessageSpy =
  vi.fn<
    (workspaceId: string, messageId: string) => Promise<ChatMessageDto | null>
  >();

vi.mock("@/api/chat", () => ({
  fetchMessage: (w: string, id: string) => fetchMessageSpy(w, id),
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
    isDefault: false,
    isMember: true,
    canManage: false,
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

describe("chat connection state", () => {
  it("is live after ready, reconnecting on a transient error, stopped when closed", () => {
    const { source, view } = harness();
    expect(getChatConnection()).toBe("connecting");

    act(() => source.emit("ready", {}));
    expect(getChatConnection()).toBe("live");

    // EventSource retries on its own while CONNECTING.
    source.readyState = 0;
    act(() => source.emit("error", {}));
    expect(getChatConnection()).toBe("reconnecting");

    act(() => source.emit("ready", {}));
    expect(getChatConnection()).toBe("live");

    // CLOSED means the browser gave up (e.g. a non-200 answer).
    source.readyState = FakeEventSource.CLOSED;
    act(() => source.emit("error", {}));
    expect(getChatConnection()).toBe("stopped");

    view.unmount();
    expect(getChatConnection()).toBe("connecting");
  });
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

  it("ready event refetches the open channel's loaded range and its tail", async () => {
    // Messages 4 and 5 were posted while the client was offline, and message
    // 2 was edited; nothing announced either, so only the reconnect can.
    fetchMessagesSpy.mockResolvedValue([
      msg(1),
      msg(2, { body: "edited", editedAt: "2026-11-20T10:05:00.000Z" }),
      msg(3),
      msg(4),
      msg(5),
    ]);
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
    expect(fetchMessagesSpy).toHaveBeenCalledWith("w1", "c1", { after: 0 });
    expect(
      queryClient.getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))?.[1]
        .body,
    ).toBe("edited");
  });

  it("ready event invalidates thread caches and closed channels' caches", async () => {
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(1)]);
    queryClient.setQueryData(chatKeys.messages("c2"), [msg(1)]);
    queryClient.setQueryData(chatKeys.thread("m1"), [msg(1)]);
    fetchMessagesSpy.mockResolvedValue([msg(1)]);
    setOpenChatChannel({ workspaceId: "w1", channelId: "c1" });

    act(() => source.emit("ready", {}));

    await waitFor(() =>
      expect(
        queryClient.getQueryState(chatKeys.thread("m1"))?.isInvalidated,
      ).toBe(true),
    );
    expect(
      queryClient.getQueryState(chatKeys.messages("c2"))?.isInvalidated,
    ).toBe(true);
    // The open channel keeps its loaded history; it is caught up in place.
    expect(
      queryClient.getQueryState(chatKeys.messages("c1"))?.isInvalidated,
    ).toBe(false);
  });

  it("fetches from the start when the open channel loaded empty", async () => {
    fetchMessagesSpy.mockResolvedValue([msg(1)]);
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.messages("c1"), []);
    setOpenChatChannel({ workspaceId: "w1", channelId: "c1" });

    act(() =>
      source.emit("message", {
        workspaceId: "w1",
        channelId: "c1",
        seq: 1,
        threadRootId: null,
        authorId: 2,
        alsoInChannel: false,
      }),
    );

    await waitFor(() =>
      expect(
        queryClient
          .getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))
          ?.map((m) => m.seq),
      ).toEqual([1]),
    );
    expect(fetchMessagesSpy).toHaveBeenCalledWith("w1", "c1", { after: 0 });
  });

  it("a rerun starts from the earliest hint, not a tail a local post moved", async () => {
    let release: (v: ChatMessageDto[]) => void = () => {};
    fetchMessagesSpy
      .mockImplementationOnce(
        () => new Promise<ChatMessageDto[]>((r) => (release = r)),
      )
      .mockResolvedValue([msg(12)]);
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(10)]);
    setOpenChatChannel({ workspaceId: "w1", channelId: "c1" });
    const event = (seq: number) => ({
      workspaceId: "w1",
      channelId: "c1",
      seq,
      threadRootId: null,
      authorId: 2,
      alsoInChannel: false,
    });

    act(() => source.emit("message", event(11)));
    act(() => source.emit("message", event(12)));
    // Our own post lands in the cache while the first request is out.
    queryClient.setQueryData<ChatMessageDto[]>(chatKeys.messages("c1"), (old) => [
      ...(old ?? []),
      msg(13),
    ]);
    release([msg(11)]);

    await waitFor(() => expect(fetchMessagesSpy).toHaveBeenCalledTimes(2));
    expect(fetchMessagesSpy).toHaveBeenLastCalledWith("w1", "c1", {
      after: 11,
    });
  });

  it("an older refresh finishing last does not undo a newer one", async () => {
    const resolvers: Array<(v: ChatMessageDto | null) => void> = [];
    fetchMessageSpy.mockImplementation(
      () => new Promise((r) => resolvers.push(r)),
    );
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(1)]);
    const update = {
      workspaceId: "w1",
      channelId: "c1",
      messageId: "m1",
      threadRootId: null,
    };

    act(() => source.emit("update", update)); // the edit
    act(() => source.emit("update", update)); // then the delete
    await waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1](msg(1, { body: "", deleted: true }));
    await waitFor(() =>
      expect(
        queryClient.getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))?.[0]
          .deleted,
      ).toBe(true),
    );
    resolvers[0](msg(1, { body: "edited" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(
      queryClient.getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))?.[0],
    ).toMatchObject({ body: "", deleted: true });
  });

  it("a stale refresh cannot reuse a finished one's generation", async () => {
    const resolvers: Array<(v: ChatMessageDto | null) => void> = [];
    fetchMessageSpy.mockImplementation(
      () => new Promise((r) => resolvers.push(r)),
    );
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(1)]);
    const update = {
      workspaceId: "w1",
      channelId: "c1",
      messageId: "m1",
      threadRootId: null,
    };
    const first = () =>
      queryClient.getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))?.[0];

    act(() => source.emit("update", update)); // #1 the edit, slow
    act(() => source.emit("update", update)); // #2 the delete
    await waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1](msg(1, { body: "", deleted: true }));
    await waitFor(() => expect(first()?.deleted).toBe(true));
    act(() => source.emit("update", update)); // #3 starts after #2 finished
    await waitFor(() => expect(resolvers).toHaveLength(3));
    resolvers[0](msg(1, { body: "edited" })); // #1 finally answers
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(first()).toMatchObject({ body: "", deleted: true });
    resolvers[2](msg(1, { body: "", deleted: true }));
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
        alsoInChannel: false,
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
        alsoInChannel: false,
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
        alsoInChannel: false,
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

  it("an update event replaces the cached message in channel and thread", async () => {
    fetchMessageSpy.mockResolvedValue(
      msg(2, {
        body: "edited",
        editedAt: "2026-11-20T10:05:00.000Z",
        threadRootId: "m1",
      }),
    );
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(1), msg(2)]);
    queryClient.setQueryData(chatKeys.thread("m1"), [
      msg(1),
      msg(2, { threadRootId: "m1" }),
    ]);

    act(() =>
      source.emit("update", {
        workspaceId: "w1",
        channelId: "c1",
        messageId: "m2",
        threadRootId: "m1",
      }),
    );

    await waitFor(() =>
      expect(
        queryClient
          .getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))
          ?.map((m) => m.body),
      ).toEqual(["message 1", "edited"]),
    );
    expect(
      queryClient
        .getQueryData<ChatMessageDto[]>(chatKeys.thread("m1"))
        ?.map((m) => m.body),
    ).toEqual(["message 1", "edited"]);
    expect(fetchMessageSpy).toHaveBeenCalledWith("w1", "m2");
  });

  it("an update for a root refreshes it inside its own thread", async () => {
    fetchMessageSpy.mockResolvedValue(msg(1, { body: "root, edited" }));
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.thread("m1"), [msg(1)]);

    act(() =>
      source.emit("update", {
        workspaceId: "w1",
        channelId: "c1",
        messageId: "m1",
        threadRootId: null,
      }),
    );

    await waitFor(() =>
      expect(
        queryClient.getQueryData<ChatMessageDto[]>(chatKeys.thread("m1"))?.[0]
          .body,
      ).toBe("root, edited"),
    );
  });

  it("an update the caller can no longer fetch marks the message deleted", async () => {
    fetchMessageSpy.mockResolvedValue(null);
    const { queryClient, source } = harness();
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(1)]);

    act(() =>
      source.emit("update", {
        workspaceId: "w1",
        channelId: "c1",
        messageId: "m1",
        threadRootId: null,
      }),
    );

    await waitFor(() =>
      expect(
        queryClient.getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))?.[0],
      ).toMatchObject({ body: "", deleted: true }),
    );
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
