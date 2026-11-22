import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelSummary, ChatMessageDto } from "@/api/chat";
import { chatKeys, type PendingSend } from "@/components/chat/chat-cache";
import {
  useChannelMessages,
  useMarkRead,
  usePendingMessages,
  useSendMessage,
} from "@/components/chat/use-chat";

const api = vi.hoisted(() => ({
  markRead: vi.fn<(w: string, c: string, seq: number) => Promise<void>>(),
  postMessage:
    vi.fn<
      (
        w: string,
        c: string,
        input: { body: string; threadRootId?: string; alsoInChannel?: boolean },
      ) => Promise<unknown>
    >(),
  fetchMessages:
    vi.fn<
      (
        w: string,
        c: string,
        opts?: { before?: number; after?: number; thread?: string },
      ) => Promise<unknown[]>
    >(),
}));

vi.mock("@/api/chat", () => ({
  CHAT_PAGE_SIZE: 50,
  markRead: api.markRead,
  postMessage: api.postMessage,
  fetchMessages: api.fetchMessages,
  fetchChannels: () => Promise.resolve([]),
}));

vi.mock("@/components/chat/use-chat-stream", () => ({
  catchUpChannel: vi.fn(),
  takePendingCatchUp: vi.fn(() => false),
}));

const msg = (seq: number, over: Partial<ChatMessageDto> = {}): ChatMessageDto => ({
  id: `m${seq}`,
  channelId: "c1",
  seq,
  author: { id: 1, username: "me", photo: null },
  body: `message ${seq}`,
  threadRootId: null,
  alsoInChannel: false,
  replyCount: 0,
  lastReplyAt: null,
  editedAt: null,
  deleted: false,
  createdAt: "2026-11-20T10:00:00.000Z",
  ...over,
});

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
    lastSeq: 6,
    lastReadSeq: 3,
    unreadCount: 3,
    mentionCount: 1,
    lastMessageAt: null,
    ...over,
  }) satisfies ChannelSummary;

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

beforeEach(() => {
  window.sessionStorage.clear();
  api.markRead.mockReset().mockResolvedValue(undefined);
  api.postMessage.mockReset();
  api.fetchMessages.mockReset().mockResolvedValue([]);
});

describe("useMarkRead", () => {
  it("sends each new high-water mark once and clears the counts at once", () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(chatKeys.channels("w1"), [
      channel("c1"),
      channel("c2"),
    ]);
    const { result } = renderHook(() => useMarkRead("w1", "c1"), { wrapper });

    act(() => result.current(5));
    act(() => result.current(5));
    act(() => result.current(3));
    act(() => result.current(6));

    expect(api.markRead.mock.calls).toEqual([
      ["w1", "c1", 5],
      ["w1", "c1", 6],
    ]);
    const list = queryClient.getQueryData<ChannelSummary[]>(
      chatKeys.channels("w1"),
    );
    expect(list?.find((c) => c.id === "c1")).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
      lastReadSeq: 6,
    });
    // Other channels keep their counts.
    expect(list?.find((c) => c.id === "c2")?.unreadCount).toBe(3);
  });

  it("lets the same seq try again after a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.markRead.mockRejectedValueOnce(new Error("offline"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMarkRead("w1", "c1"), { wrapper });

    act(() => result.current(5));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    act(() => result.current(5));

    expect(api.markRead).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("starts over in another channel", () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ channelId }) => useMarkRead("w1", channelId),
      { wrapper, initialProps: { channelId: "c1" } },
    );

    act(() => result.current(9));
    rerender({ channelId: "c2" });
    act(() => result.current(2));

    expect(api.markRead.mock.calls).toEqual([
      ["w1", "c1", 9],
      ["w1", "c2", 2],
    ]);
  });
});

describe("useSendMessage writes the server row", () => {
  const root = msg(1, { replyCount: 1 });

  it("appends a top-level message to the channel cache only", async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(chatKeys.messages("c1"), [root]);
    api.postMessage.mockResolvedValue(msg(2));
    const { result } = renderHook(() => useSendMessage("w1", "c1"), {
      wrapper,
    });

    await act(() => result.current.send({ body: "hi" }));

    expect(
      queryClient
        .getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))
        ?.map((m) => m.id),
    ).toEqual(["m1", "m2"]);
    expect(api.fetchMessages).not.toHaveBeenCalled();
  });

  it("puts a reply in its thread, not the channel, and re-reads the root", async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(0), root]);
    queryClient.setQueryData(chatKeys.thread("m1"), [root]);
    const reply = msg(2, { threadRootId: "m1" });
    api.postMessage.mockResolvedValue(reply);
    api.fetchMessages.mockResolvedValue([msg(1, { replyCount: 2 })]);
    const { result } = renderHook(() => useSendMessage("w1", "c1"), {
      wrapper,
    });

    await act(() =>
      result.current.send({ body: "re", threadRootId: "m1" }),
    );

    expect(
      queryClient
        .getQueryData<ChatMessageDto[]>(chatKeys.thread("m1"))
        ?.map((m) => m.id),
    ).toEqual(["m1", "m2"]);
    // Read from just before the root, so the refreshed root is the first row.
    expect(api.fetchMessages).toHaveBeenCalledWith("w1", "c1", { after: 0 });
    await waitFor(() =>
      expect(
        queryClient
          .getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))
          ?.find((m) => m.id === "m1")?.replyCount,
      ).toBe(2),
    );
    expect(
      queryClient
        .getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))
        ?.map((m) => m.id),
    ).toEqual(["m0", "m1"]);
  });

  it("puts a reply also sent to the channel in both", async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(chatKeys.messages("c1"), [root]);
    queryClient.setQueryData(chatKeys.thread("m1"), [root]);
    const reply = msg(2, { threadRootId: "m1", alsoInChannel: true });
    api.postMessage.mockResolvedValue(reply);
    const { result } = renderHook(() => useSendMessage("w1", "c1"), {
      wrapper,
    });

    await act(() =>
      result.current.send({
        body: "re",
        threadRootId: "m1",
        alsoInChannel: true,
      }),
    );

    expect(
      queryClient
        .getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))
        ?.map((m) => m.id),
    ).toEqual(["m1", "m2"]);
    expect(
      queryClient
        .getQueryData<ChatMessageDto[]>(chatKeys.thread("m1"))
        ?.map((m) => m.id),
    ).toEqual(["m1", "m2"]);
  });

  it("does not seed a channel cache that was never loaded", async () => {
    const { queryClient, wrapper } = setup();
    api.postMessage.mockResolvedValue(msg(2));
    const { result } = renderHook(() => useSendMessage("w1", "c1"), {
      wrapper,
    });

    await act(() => result.current.send({ body: "hi" }));

    expect(queryClient.getQueryData(chatKeys.messages("c1"))).toBeUndefined();
  });
});

describe("useChannelMessages loadOlder", () => {
  it("reports an empty older page as nothing prepended", async () => {
    const page = Array.from({ length: 50 }, (_, i) => msg(i + 51));
    api.fetchMessages.mockResolvedValueOnce(page).mockResolvedValueOnce([]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useChannelMessages("w1", "c-exact"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(50));
    expect(result.current.hasOlder).toBe(true);

    let prepended: boolean | undefined;
    await act(async () => {
      prepended = await result.current.loadOlder();
    });

    expect(prepended).toBe(false);
    expect(result.current.hasOlder).toBe(false);
  });

  it("reports a prepended page", async () => {
    const page = Array.from({ length: 50 }, (_, i) => msg(i + 51));
    api.fetchMessages
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([msg(49), msg(50)]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useChannelMessages("w1", "c-more"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(50));

    let prepended: boolean | undefined;
    await act(async () => {
      prepended = await result.current.loadOlder();
    });

    expect(prepended).toBe(true);
    expect(result.current.messages[0].id).toBe("m49");
  });
});

describe("useSendMessage", () => {
  const ids = (queryClient: QueryClient) =>
    queryClient
      .getQueryData<ChatMessageDto[]>(chatKeys.messages("c1"))
      ?.map((m) => m.id);
  const pendingOf = (queryClient: QueryClient) =>
    queryClient.getQueryData<PendingSend[]>(chatKeys.pending("c1")) ?? [];

  function renderSend() {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(["me"], { id: 1, username: "me", photo: "" });
    queryClient.setQueryData(chatKeys.messages("c1"), [msg(1)]);
    const { result } = renderHook(
      () => ({
        sender: useSendMessage("w1", "c1"),
        channel: usePendingMessages("c1", null),
        thread: usePendingMessages("c1", "m1"),
      }),
      { wrapper },
    );
    return { queryClient, result };
  }

  it("draws the message at once, then swaps in the server's row", async () => {
    let resolve: (m: ChatMessageDto) => void = () => {};
    api.postMessage.mockReturnValue(new Promise((r) => (resolve = r)));
    const { queryClient, result } = renderSend();

    let sent: Promise<unknown> = Promise.resolve();
    act(() => {
      sent = result.current.sender.send({ body: "hi" });
    });
    // Cache notifications are batched onto a timer.
    await waitFor(() => expect(result.current.channel).toHaveLength(1));
    expect(result.current.channel[0]).toMatchObject({
      body: "hi",
      localState: "pending",
      author: { id: 1 },
      // A floor for the server's seq, from the newest one known.
      seq: 1,
    });

    await act(async () => {
      resolve(msg(2, { body: "hi" }));
      await sent;
    });
    expect(ids(queryClient)).toEqual(["m1", "m2"]);
    expect(pendingOf(queryClient)).toEqual([]);
    await waitFor(() => expect(result.current.channel).toEqual([]));
  });

  it("marks a failed send and retries it in place", async () => {
    api.postMessage.mockRejectedValueOnce(new Error("offline"));
    const { queryClient, result } = renderSend();

    await act(async () => {
      await result.current.sender.send({ body: "hi" }).catch(() => {});
    });
    await waitFor(() =>
      expect(result.current.channel[0]?.localState).toBe("failed"),
    );
    expect(ids(queryClient)).toEqual(["m1"]);

    api.postMessage.mockResolvedValueOnce(msg(2, { body: "hi" }));
    const clientId = result.current.channel[0].clientId!;
    await act(async () => {
      await result.current.sender.retry(clientId);
    });
    expect(api.postMessage).toHaveBeenLastCalledWith("w1", "c1", { body: "hi" });
    expect(ids(queryClient)).toEqual(["m1", "m2"]);
    await waitFor(() => expect(result.current.channel).toEqual([]));
  });

  it("discards a failed send", async () => {
    api.postMessage.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderSend();
    await act(async () => {
      await result.current.sender.send({ body: "hi" }).catch(() => {});
    });
    await waitFor(() => expect(result.current.channel).toHaveLength(1));
    act(() => result.current.sender.discard(result.current.channel[0].clientId!));
    await waitFor(() => expect(result.current.channel).toEqual([]));
  });

  it("posts quick sends one at a time, in the order they were sent", async () => {
    const resolvers: Array<(m: ChatMessageDto) => void> = [];
    api.postMessage.mockImplementation(
      () => new Promise((r) => resolvers.push(r)),
    );
    const { result } = renderSend();
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.sender.send({ body: "one" });
      second = result.current.sender.send({ body: "two" });
    });
    await waitFor(() => expect(result.current.channel).toHaveLength(2));
    // The second post waits for the first to be answered.
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledTimes(1));
    expect(api.postMessage).toHaveBeenLastCalledWith("w1", "c1", { body: "one" });
    await act(async () => {
      resolvers[0](msg(2, { body: "one" }));
      await first;
    });
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledTimes(2));
    expect(api.postMessage).toHaveBeenLastCalledWith("w1", "c1", { body: "two" });
    await act(async () => {
      resolvers[1](msg(3, { body: "two" }));
      await second;
    });
  });

  it("keeps a failed send across a reload, and an interrupted one as failed", async () => {
    api.postMessage.mockRejectedValueOnce(new Error("offline"));
    const first = renderSend();
    await act(async () => {
      await first.result.current.sender.send({ body: "kept" }).catch(() => {});
    });
    api.postMessage.mockReturnValueOnce(new Promise(() => {}));
    act(() => {
      void first.result.current.sender.send({ body: "cut off" });
    });
    await waitFor(() =>
      expect(first.result.current.channel.map((m) => m.body)).toEqual([
        "kept",
        "cut off",
      ]),
    );

    // A reload: a fresh client reads what storage kept.
    const second = renderSend();
    expect(
      second.result.current.channel.map((m) => [m.body, m.localState]),
    ).toEqual([
      ["kept", "failed"],
      ["cut off", "failed"],
    ]);
  });

  it("shows a thread reply in its thread, and in the channel only when also sent there", async () => {
    api.postMessage.mockReturnValue(new Promise(() => {}));
    const { result } = renderSend();
    act(() => {
      void result.current.sender.send({ body: "a", threadRootId: "m1" });
      void result.current.sender.send({
        body: "b",
        threadRootId: "m1",
        alsoInChannel: true,
      });
    });
    await waitFor(() =>
      expect(result.current.thread.map((m) => m.body)).toEqual(["a", "b"]),
    );
    expect(result.current.channel.map((m) => m.body)).toEqual(["b"]);
  });
});
