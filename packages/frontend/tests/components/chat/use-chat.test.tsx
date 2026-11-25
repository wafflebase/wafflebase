import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessageDto } from "@/api/chat";
import { useThreadMessages } from "@/components/chat/use-chat";

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

/** A root and its replies: seq 1..n. */
const threadOf = (n: number) => Array.from({ length: n }, (_, i) => msg(i + 1));
let thread = threadOf(61);

/**
 * Pages exactly like `ChatMessageService.page`: with `after`, the oldest
 * `PAGE` above it ascending; without, the newest `PAGE` (below `before`).
 */
const fetchMessagesSpy = vi.fn(
  async (
    _w: string,
    _c: string,
    opts: { before?: number; after?: number; thread?: string },
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
    o: { before?: number; after?: number; thread?: string },
  ) => fetchMessagesSpy(w, c, o),
}));

vi.mock("@/components/chat/use-chat-stream", () => ({
  catchUpChannel: vi.fn(),
  takePendingCatchUp: vi.fn(),
}));

function renderThread() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(() => useThreadMessages("w1", "c1", "m1"), {
    wrapper,
  });
  return { ...hook, queryClient };
}

describe("useThreadMessages", () => {
  it("loads every reply of a thread longer than one page", async () => {
    thread = threadOf(61);
    const { result } = renderThread();

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.map((m) => m.seq)).toEqual(
      thread.map((m) => m.seq),
    );
    expect(result.current.hasOlder).toBe(false);
  });

  it("opens a very long thread at its newest replies and reads back on demand", async () => {
    // 600 replies: more than opening reads, which used to keep the oldest
    // 500 and silently drop the newest 100.
    thread = threadOf(601);
    const { result } = renderThread();

    await waitFor(() => expect(result.current.data).toBeDefined());
    const seqs = result.current.data!.map((m) => m.seq);
    expect(seqs.at(-1)).toBe(601);
    expect(seqs).toHaveLength(500);
    expect(result.current.hasOlder).toBe(true);

    // 101 older rows: two full pages and the one holding the root.
    for (let i = 0; i < 3; i++) await act(() => result.current.loadOlder());
    expect(result.current.data!.map((m) => m.seq)).toEqual(
      thread.map((m) => m.seq),
    );
    expect(result.current.hasOlder).toBe(false);
  });

  it("keeps the replies read back through when the thread is refetched", async () => {
    thread = threadOf(601);
    const { result, queryClient } = renderThread();
    await waitFor(() => expect(result.current.data).toBeDefined());
    await act(() => result.current.loadOlder());
    const before = result.current.data!.length;

    thread = threadOf(602);
    await act(() =>
      queryClient.invalidateQueries({ queryKey: ["chat", "thread", "m1"] }),
    );
    await waitFor(() =>
      expect(result.current.data!.at(-1)?.seq).toBe(602),
    );
    expect(result.current.data!.length).toBeGreaterThanOrEqual(before + 1);
  });

  it("keeps a thread read back to its root complete when it is refetched", async () => {
    thread = threadOf(601);
    const { result, queryClient } = renderThread();
    await waitFor(() => expect(result.current.data).toBeDefined());
    for (let i = 0; i < 3; i++) await act(() => result.current.loadOlder());
    expect(result.current.hasOlder).toBe(false);

    thread = threadOf(602);
    await act(() =>
      queryClient.invalidateQueries({ queryKey: ["chat", "thread", "m1"] }),
    );
    await waitFor(() =>
      expect(result.current.data!.at(-1)?.seq).toBe(602),
    );
    expect(result.current.data!.map((m) => m.seq)).toEqual(
      thread.map((m) => m.seq),
    );
    expect(result.current.hasOlder).toBe(false);
  });
});
