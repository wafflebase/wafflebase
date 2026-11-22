import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessageDto } from "@/api/chat";
import {
  useChannelMessages,
  useThreadMessages,
} from "@/components/chat/use-chat";
import { catchUpChannel } from "@/components/chat/use-chat-stream";
import { chatKeys } from "@/components/chat/chat-cache";

const PAGE = 50;

const msg = (seq: number): ChatMessageDto => ({
  id: `m${seq}`,
  channelId: "c1",
  seq,
  author: { id: 2, username: "minji", photo: null },
  body: `message ${seq}`,
  threadRootId: seq === 1 ? null : "m1",
  alsoInChannel: false,
  replyCount: 0,
  lastReplyAt: null,
  editedAt: null,
  deleted: false,
  createdAt: "2026-11-20T10:00:00.000Z",
});

/** A root and 60 replies: seq 1..61. */
const thread = Array.from({ length: 61 }, (_, i) => msg(i + 1));

/**
 * Pages exactly like `ChatMessageService.page`: with `after`, the oldest
 * `PAGE` above it ascending; without, the newest `PAGE` (below `before`).
 */
const fetchMessagesSpy = vi.fn(
  async (
    _w: string,
    _c: string,
    opts: { before?: number; after?: number; thread?: string } = {},
  ): Promise<ChatMessageDto[]> => {
    const rows = thread.filter(
      (m) =>
        (opts.after === undefined || m.seq > opts.after) &&
        (opts.before === undefined || m.seq < opts.before),
    );
    return opts.after !== undefined ? rows.slice(0, PAGE) : rows.slice(-PAGE);
  },
);

vi.mock("@/api/chat", () => ({
  CHAT_PAGE_SIZE: 50,
  fetchMessages: (
    w: string,
    c: string,
    o?: { before?: number; after?: number; thread?: string },
  ) => fetchMessagesSpy(w, c, o),
}));

vi.mock("@/components/chat/use-chat-stream", () => ({
  catchUpChannel: vi.fn(),
  takePendingCatchUp: vi.fn(),
}));

describe("useThreadMessages", () => {
  it("loads every reply of a thread longer than one page", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(
      () => useThreadMessages("w1", "c1", "m1"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((m) => m.seq)).toEqual(
      thread.map((m) => m.seq),
    );
  });
});

describe("useChannelMessages settled", () => {
  const setup = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    return { queryClient, wrapper };
  };

  it("settles once the first page lands", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useChannelMessages("w1", "c-fresh"), {
      wrapper,
    });
    expect(result.current.settled).toBe(false);
    await waitFor(() => expect(result.current.settled).toBe(true));
  });

  it("waits for a surviving cache to catch up", async () => {
    let finish: () => void = () => {};
    vi.mocked(catchUpChannel).mockImplementationOnce(
      () => new Promise<void>((r) => (finish = r)),
    );
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(chatKeys.messages("c-cached"), [msg(1)]);

    const { result } = renderHook(
      () => useChannelMessages("w1", "c-cached"),
      { wrapper },
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.settled).toBe(false);

    await act(async () => finish());
    expect(result.current.settled).toBe(true);
  });
});
