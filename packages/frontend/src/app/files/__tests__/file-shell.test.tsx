/**
 * `FileShell`'s not-found redirect and its `headerLeading` slot — issue #840.
 *
 * The redirect used to compute its own workspace slug inline; it now shares
 * `useDocumentsPath` with the image viewer's back button, so it needs a test
 * of its own that the destination is still a real workspace list (and the
 * workspace-less fallback when the user has none).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));
vi.mock("@/api/auth", () => ({ isAuthExpiredError: () => false }));
vi.mock("@/api/documents", () => ({
  fetchDocument: vi.fn(),
  renameDocument: vi.fn(async () => {}),
}));
vi.mock("@/api/workspaces", () => ({
  fetchWorkspaces: vi.fn(),
  // The shell's sidebar nav gates its Analytics entry on this.
  fetchAnalyticsEnabled: vi.fn(async () => false),
}));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));

import { fetchDocument } from "@/api/documents";
import { fetchWorkspaces } from "@/api/workspaces";
import { FileShell } from "@/app/files/file-shell";

const workspaces = [
  { id: "w1", name: "First", slug: "first", createdAt: "" },
  { id: "w2", name: "Second", slug: "second", createdAt: "" },
];

// The folder rides in the query string, so the probe has to show it — a
// pathname-only probe reads `/w/second` whether the folder survived or not.
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

function renderShell(headerLeading?: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    // Returned so a test can force the refetch that reaches the shell's own
    // error branch.
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/f/d1"]}>
          <Routes>
            <Route
              path="/f/:id"
              element={
                <FileShell
                  documentId="d1"
                  headerActions={null}
                  headerLeading={headerLeading}
                >
                  <div>body</div>
                </FileShell>
              }
            />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe("FileShell", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders headerLeading inside the header", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue(workspaces);
    vi.mocked(fetchDocument).mockResolvedValue({
      id: "d1",
      title: "cat.png",
      type: "image",
      workspaceId: "w2",
    } as Awaited<ReturnType<typeof fetchDocument>>);

    renderShell(<button>back-slot</button>);
    const slot = await screen.findByText("back-slot");
    expect(slot.closest("header")).toBeTruthy();
  });

  it("redirects a missing document to a workspace list", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue(workspaces);
    vi.mocked(fetchDocument).mockRejectedValue(new Error("404"));

    renderShell();
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/w/first"),
    );
    expect(toastError).toHaveBeenCalledWith("Document not found");
  });

  it("redirects to the workspace-less list when the user has no workspaces", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue([]);
    vi.mocked(fetchDocument).mockRejectedValue(new Error("404"));

    renderShell();
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/documents"),
    );
  });

  // A *first-load* error never reaches this branch — `FileDetail` redirects
  // before the shell mounts. What does is a refetch failure after a success
  // (a collaborator deletes the document while the viewer is open), where
  // react-query keeps the last data, so the folder is still known and the
  // redirect can land where the user was rather than at the root.
  it("carries the document's folder into the redirect", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue(workspaces);
    vi.mocked(fetchDocument)
      .mockResolvedValueOnce({
        id: "d1",
        title: "cat.png",
        type: "image",
        workspaceId: "w2",
        folderId: "f1",
      } as Awaited<ReturnType<typeof fetchDocument>>)
      .mockRejectedValue(new Error("404"));

    const { client } = renderShell();
    // The first load has to succeed, or there is no folder to carry.
    await screen.findByText("cat.png");

    await client.refetchQueries({ queryKey: ["document", "d1"] });
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/w/second?folder=f1",
      ),
    );
  });
});
