/**
 * The file viewers' header is slotted like every editor's, so the Chat toggle
 * `FileShell` adds sits in the `chat` slot — beside the other controls on a
 * wide viewport, and in the More menu on a phone. Rendered through the real
 * `SiteHeader`: the placement is its decision, and a viewer that put the
 * toggle anywhere else (a free-form header row) kept it in the row on a
 * phone, beside comments, download and share.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mobile = vi.hoisted(() => ({ current: false }));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.current }));
vi.mock("@/api/auth", () => ({
  isAuthExpiredError: () => false,
  fetchMe: vi.fn(async () => ({ id: 1 })),
}));
vi.mock("@/api/documents", () => ({
  fetchDocument: vi.fn(async () => ({
    id: "d1",
    title: "report.pdf",
    type: "pdf",
    workspaceId: "w1",
  })),
  renameDocument: vi.fn(async () => {}),
}));
vi.mock("@/api/workspaces", () => ({
  fetchWorkspaces: vi.fn(async () => []),
  fetchAnalyticsEnabled: vi.fn(async () => false),
}));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));

import { FileShell } from "@/app/files/file-shell";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderShell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/f/d1"]}>
          <Routes>
            <Route
              path="/f/:id"
              element={
                <FileShell
                  documentId="d1"
                  headerActions={{ share: <button>Share</button> }}
                >
                  <div>body</div>
                </FileShell>
              }
            />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("FileShell header", () => {
  beforeEach(() => {
    mobile.current = false;
  });

  it("puts the Chat toggle in the header row on a wide viewport", async () => {
    renderShell();
    const toggle = await screen.findByRole("button", { name: "Show chat" });
    expect(toggle.closest("header")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More document actions" })).toBeNull();
  });

  it("moves the Chat toggle into the More menu on a phone", async () => {
    mobile.current = true;
    renderShell();
    const more = await screen.findByRole("button", {
      name: "More document actions",
    });
    expect(screen.queryByRole("button", { name: "Show chat" })).toBeNull();
    // Share is not a menu slot: it stays in the row.
    expect(within(more.closest("header")!).getByText("Share")).toBeTruthy();

    fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
    const row = await screen.findByRole("menuitemcheckbox", { name: "Chat" });
    expect(row).toHaveAttribute("aria-checked", "false");
  });
});
