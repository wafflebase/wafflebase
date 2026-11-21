import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "@/api/notifications";

const notifications = vi.hoisted(() => ({ current: [] as Notification[] }));
// The badge's total. Null derives it from `notifications.current`, which is
// the whole inbox only when everything fits on the first page.
const unread = vi.hoisted(() => ({ current: null as number | null }));
const markSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const fetchSpy = vi.hoisted(() =>
  vi.fn(
    (cursor?: { before: string; beforeId: string }): Promise<Notification[]> =>
      Promise.resolve(cursor ? [] : notifications.current),
  ),
);

vi.mock("@/api/notifications", () => ({
  NOTIFICATIONS_PAGE_SIZE: 20,
  fetchNotifications: (cursor?: { before: string; beforeId: string }) =>
    fetchSpy(cursor),
  fetchUnreadCount: () =>
    Promise.resolve(
      unread.current ?? notifications.current.filter((n) => !n.readAt).length,
    ),
  markNotificationsRead: (ids?: string[]) => markSpy(ids),
}));

import { NotificationList } from "@/components/notifications/notification-list";

function notification(
  id: string,
  readAt: string | null,
  createdAt = "2026-11-14T00:00:00.000Z",
): Notification {
  return {
    id,
    type: "comment_mention",
    actor: { id: 2, username: "alice", photo: null },
    document: { id: "d1", title: "Budget", type: "sheet" },
    workspace: { id: "w1", name: "Team" },
    threadId: "t1",
    commentId: `c-${id}`,
    preview: "Look at this",
    readAt,
    createdAt,
  } as Notification;
}

beforeEach(() => {
  unread.current = null;
  // `mockReset` drops a test's own implementation; restore the default.
  fetchSpy.mockReset();
  fetchSpy.mockImplementation((cursor) =>
    Promise.resolve(cursor ? [] : notifications.current),
  );
  markSpy.mockClear();
});

function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationList onNavigate={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * "Mark all read" used to stay on screen, greyed out, in an inbox with
 * nothing unread — an action that cannot act reads as a broken one.
 */
describe("NotificationList mark all read", () => {
  it("is absent when nothing is unread", async () => {
    notifications.current = [notification("n1", "2026-11-14T01:00:00.000Z")];
    renderList();

    await screen.findByText("Look at this");
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });

  it("is absent in an empty inbox", async () => {
    notifications.current = [];
    renderList();

    await screen.findByText("You are all caught up.");
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });

  it("is offered while something is unread, and marks everything", async () => {
    notifications.current = [
      notification("n1", null),
      notification("n2", "2026-11-14T01:00:00.000Z"),
    ];
    markSpy.mockClear();
    renderList();

    const button = await screen.findByRole("button", { name: "Mark all read" });
    await userEvent.click(button);

    expect(markSpy).toHaveBeenCalledWith(undefined);
  });
});

/**
 * The bug that shipped: 20 newer read rows filled the only page, the 18 unread
 * ones sat behind it, and "Mark all read" — gated on the visible rows — never
 * appeared. Nothing in the UI could reach or clear the badge.
 */
describe("NotificationList with unread rows past the first page", () => {
  const READ = "2026-11-14T01:00:00.000Z";
  const fullReadPage = () =>
    Array.from({ length: 20 }, (_, i) =>
      notification(
        `r${i}`,
        READ,
        `2026-11-14T00:00:${String(59 - i).padStart(2, "0")}.000Z`,
      ),
    );

  it("offers 'Mark all read' from the badge count, not the loaded rows", async () => {
    notifications.current = fullReadPage();
    unread.current = 18;
    renderList();

    const button = await screen.findByRole("button", { name: "Mark all read" });
    await userEvent.click(button);
    expect(markSpy).toHaveBeenCalledWith(undefined);
  });

  it("loads the next page from the last row's (createdAt, id)", async () => {
    const page = fullReadPage();
    notifications.current = page;
    fetchSpy.mockImplementation((cursor) =>
      Promise.resolve(
        cursor ? [notification("old", null, "2026-11-13T00:00:00.000Z")] : page,
      ),
    );
    renderList();

    await userEvent.click(
      await screen.findByRole("button", { name: "Load more" }),
    );

    expect(fetchSpy).toHaveBeenLastCalledWith({
      before: page[19].createdAt,
      beforeId: "r19",
    });
    await waitFor(() =>
      expect(screen.getAllByLabelText("Unread")).toHaveLength(1),
    );
    // A short page is the last one.
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("offers no 'Load more' when the first page is short", async () => {
    notifications.current = [notification("n1", null)];
    renderList();

    await screen.findByText("Look at this");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
