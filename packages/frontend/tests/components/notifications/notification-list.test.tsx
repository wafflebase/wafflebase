import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Notification } from "@/api/notifications";

const notifications = vi.hoisted(() => ({ current: [] as Notification[] }));
const markSpy = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@/api/notifications", () => ({
  fetchNotifications: () => Promise.resolve(notifications.current),
  fetchUnreadCount: () =>
    Promise.resolve(notifications.current.filter((n) => !n.readAt).length),
  markNotificationsRead: (ids?: string[]) => markSpy(ids),
}));

import { NotificationList } from "@/components/notifications/notification-list";

function notification(id: string, readAt: string | null): Notification {
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
    createdAt: "2026-11-14T00:00:00.000Z",
  } as Notification;
}

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
