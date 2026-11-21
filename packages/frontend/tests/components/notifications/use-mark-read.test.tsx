import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "@/api/notifications";
import {
  NOTIFICATIONS_KEY,
  type NotificationPages,
  UNREAD_COUNT_KEY,
  useMarkRead,
  useUnreadCount,
} from "@/components/notifications/use-notifications";

const markSpy = vi.fn<() => Promise<void>>();
const countSpy = vi.fn<() => Promise<number>>();

vi.mock("@/api/notifications", () => ({
  markNotificationsRead: () => markSpy(),
  fetchUnreadCount: () => countSpy(),
  fetchNotifications: () => Promise.resolve([]),
  NOTIFICATIONS_PAGE_SIZE: 20,
}));

function row(id: string): Notification {
  return {
    id,
    type: "comment_mention",
    actor: null,
    document: null,
    workspace: null,
    threadId: null,
    commentId: null,
    preview: null,
    readAt: null,
    createdAt: "2026-11-14T00:00:00.000Z",
  };
}

/**
 * Mirrors the real tree: the bell always mounts `useUnreadCount`, so the badge
 * query is *active* and an invalidation refetches it. Rendering the mutation
 * alone would leave it inactive, where invalidation only marks it stale.
 *
 * Mocks must be primed before this runs — the query fetches on mount.
 */
function harness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // `staleTime: Infinity` so no incidental refetch (a re-render while the
      // mutation settles) can supply the authoritative value. Invalidation
      // still refetches, which leaves it as the only thing that can — without
      // this the tests pass whether or not the fix is present.
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(
    () => ({ count: useUnreadCount(true), markRead: useMarkRead() }),
    { wrapper },
  );
  return { queryClient, result };
}

const badge = (queryClient: QueryClient) =>
  queryClient.getQueryData(UNREAD_COUNT_KEY);

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMarkRead", () => {
  it("settles on an authoritative count instead of the one it guessed", async () => {
    // Marking everything read guesses 0. But a notification arrived between
    // the server processing the read and its response resolving, so the truth
    // is 1 — and without a refetch the badge would sit at 0 until the next
    // poll.
    markSpy.mockResolvedValue(undefined);
    countSpy.mockResolvedValueOnce(3).mockResolvedValue(1);
    const { queryClient, result } = harness();
    await waitFor(() => expect(badge(queryClient)).toBe(3));

    result.current.markRead.mutate(undefined);

    await waitFor(() => expect(badge(queryClient)).toBe(1));
  });

  it("does not lose a summary that arrives while the read is in flight", async () => {
    // The exact ordering the race needs: the read is still pending when the
    // stream delivers a newer count, and only then does the mutation resolve
    // and run its optimistic write.
    let completeRead: () => void = () => {};
    markSpy.mockReturnValue(
      new Promise<void>((resolve) => (completeRead = () => resolve())),
    );
    countSpy.mockResolvedValueOnce(3).mockResolvedValue(1);
    const { queryClient, result } = harness();
    await waitFor(() => expect(badge(queryClient)).toBe(3));

    result.current.markRead.mutate(undefined);
    // The stream lands first, carrying the notification that arrived after
    // the server processed the read.
    queryClient.setQueryData(UNREAD_COUNT_KEY, 1);
    completeRead();

    // Wait for the mutation to settle *first*: its optimistic write is what
    // clobbers the stream's value, so asserting before it runs would pass on
    // the value the stream just wrote and prove nothing.
    await waitFor(() =>
      expect(result.current.markRead.isSuccess).toBe(true),
    );
    await waitFor(() => expect(badge(queryClient)).toBe(1));
  });

  it("shows the guessed count immediately, before the refetch lands", async () => {
    markSpy.mockResolvedValue(undefined);
    let release: (n: number) => void = () => {};
    countSpy
      .mockResolvedValueOnce(3)
      .mockReturnValue(new Promise<number>((resolve) => (release = resolve)));
    const { queryClient, result } = harness();
    await waitFor(() => expect(badge(queryClient)).toBe(3));

    result.current.markRead.mutate(undefined);

    // 0 while the authoritative read is still in flight.
    await waitFor(() => expect(badge(queryClient)).toBe(0));
    release(0);
  });

  it("stamps a row read on a later page, not just the first", async () => {
    markSpy.mockResolvedValue(undefined);
    countSpy.mockResolvedValueOnce(2).mockResolvedValue(1);
    const { queryClient, result } = harness();
    await waitFor(() => expect(badge(queryClient)).toBe(2));
    queryClient.setQueryData<NotificationPages>(NOTIFICATIONS_KEY, {
      pages: [[row("p1")], [row("p2")]],
      pageParams: [undefined, { before: "x", beforeId: "p1" }],
    });

    result.current.markRead.mutate(["p2"]);

    await waitFor(() => expect(result.current.markRead.isSuccess).toBe(true));
    const pages =
      queryClient.getQueryData<NotificationPages>(NOTIFICATIONS_KEY)!.pages;
    expect(pages[0][0].readAt).toBeNull();
    expect(pages[1][0].readAt).not.toBeNull();
  });
});
