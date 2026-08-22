/**
 * Back-button wiring for the image viewer — issue #840.
 *
 * `image-viewer.test.tsx` covers the Esc key against an injected callback.
 * These tests cover the other half: that the real `/f/:id` image layout
 * renders the header back button through `FileShell`'s `headerLeading` slot
 * and `SiteHeader`'s `leading` slot, and that both it and the viewer's Esc
 * callback land on the document's own workspace list. Without them the
 * feature could be silently unwired (slot dropped, `onClose` not passed,
 * wrong path) with a green suite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

// jsdom ships no matchMedia; `SidebarProvider` reads it via `useIsMobile()`.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

vi.mock("@/api/auth", () => ({
  fetchMe: vi.fn(async () => ({
    id: 1,
    username: "u",
    email: "u@e.com",
    photo: null,
  })),
  isAuthExpiredError: () => false,
}));
vi.mock("@/api/documents", () => ({
  fetchDocument: vi.fn(async () => ({
    id: "d1",
    title: "cat.png",
    type: "image",
    fileId: "abc.png",
    workspaceId: "w2",
  })),
  renameDocument: vi.fn(async () => {}),
}));
vi.mock("@/api/workspaces", () => ({
  fetchWorkspaces: vi.fn(async () => [
    { id: "w1", name: "First", slug: "first", createdAt: "" },
    { id: "w2", name: "Second", slug: "second", createdAt: "" },
  ]),
}));
vi.mock("@/api/download-file", () => ({
  downloadDocumentFile: vi.fn(async () => {}),
}));

// Chrome the layout mounts but this test is not about: the sidebar, the
// notification bell (SSE), the share dialog, and the PDF collab stack (only
// imported, never rendered for an image).
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("@/components/share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("@/app/files/pdf-collab", () => ({
  PdfCollabProvider: ({ children }: { children: React.ReactNode }) => children,
  PdfHeaderActions: () => null,
  PdfCollabBody: () => null,
}));

// The viewer itself is exercised in image-viewer.test.tsx; here it is a
// stand-in whose only job is to expose the `onClose` it was handed, which is
// what the Esc key calls.
vi.mock("@/app/files/image-viewer", () => ({
  ImageViewer: ({ onClose }: { onClose?: () => void }) => (
    <button onClick={() => onClose?.()}>viewer-esc</button>
  ),
}));

import { FileDetail } from "@/app/files/file-detail";

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/f/d1"]}>
        <Routes>
          <Route path="/f/:id" element={<FileDetail />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("FileDetail image layout back navigation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the header back button and returns to the workspace list", async () => {
    renderDetail();
    const back = await screen.findByRole("button", {
      name: "Back to documents",
    });
    // Rendered through the header's leading slot, left of the title.
    expect(back.closest("header")).toBeTruthy();
    expect(
      back.compareDocumentPosition(screen.getByText("cat.png")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.click(back);
    // w2 is the document's own workspace, not merely the first one.
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/w/second"),
    );
  });

  it("hands the viewer the same destination for Esc", async () => {
    renderDetail();
    await userEvent.click(await screen.findByText("viewer-esc"));
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/w/second"),
    );
  });
});
