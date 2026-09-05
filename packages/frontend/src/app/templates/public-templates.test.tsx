import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import App from "@/App";
import PublicTemplates from "./public-templates";
import { browseTemplates } from "@/api/templates";
import { fetchMe, fetchMeOptional } from "@/api/auth";
import { fetchWorkspaces } from "@/api/workspaces";

vi.mock("@/api/templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/templates")>()),
  browseTemplates: vi.fn(),
}));

vi.mock("@/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/auth")>()),
  fetchMeOptional: vi.fn(),
  fetchMe: vi.fn(),
}));

// The page now wears the landing page's chrome, whose nav resolves the
// visitor's first workspace to decide its CTA.
vi.mock("@/api/workspaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/workspaces")>()),
  fetchWorkspaces: vi.fn(),
}));

const CARD = {
  id: "tpl-1",
  documentType: "sheet",
  title: "Weekly Report",
  description: null,
  category: null,
  tags: [],
  thumbnailId: null,
  visibility: "public" as const,
  status: "listed",
  useCount: 4,
  publishedAt: null,
  author: { id: 7, username: "author", photo: null },
  canManage: false,
  review: null,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/templates"]}>
        <Routes>
          <Route path="/templates" element={<PublicTemplates />} />
          <Route path="/t/:id" element={<div>landing</div>} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PublicTemplates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `ThemeProvider` reads it at first render, and jsdom has no
    // implementation. Only the full-`App` test mounts that provider.
    if (!window.matchMedia) {
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
    vi.mocked(browseTemplates).mockResolvedValue({
      items: [CARD],
      nextCursor: null,
    });
    vi.mocked(fetchWorkspaces).mockResolvedValue([]);
  });

  it("renders at /templates without a session, outside PrivateRoute", async () => {
    // The property this whole page exists for, and the one every other test
    // here would keep passing without: mounting the component directly proves
    // nothing about where the route lives. Moving `/templates` inside
    // `PrivateRoute` has to fail *something*.
    vi.mocked(fetchMeOptional).mockResolvedValue(null);
    vi.mocked(fetchMe).mockRejectedValue(new Error("401"));
    window.history.pushState({}, "", "/templates");

    render(<App />);

    await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());
    expect(screen.queryByText(/sign in with github/i)).toBeNull();
  });

  it("browses the public scope, not a workspace one", async () => {
    // The whole point of the route: it must not need a workspace, because the
    // visitor may not belong to one.
    vi.mocked(fetchMeOptional).mockResolvedValue(null);
    renderPage();
    await waitFor(() => expect(browseTemplates).toHaveBeenCalled());
    expect(vi.mocked(browseTemplates).mock.calls[0][0]).toMatchObject({
      scope: "public",
    });
    expect(
      vi.mocked(browseTemplates).mock.calls[0][0].workspaceId,
    ).toBeUndefined();
  });

  it("renders for a signed-out visitor and offers sign in, carrying returnTo", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue(null);
    renderPage();
    await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());
    // A link, not a button: it navigates, so middle-click and open-in-new-tab
    // have to work. `returnTo` is the property worth pinning — signing in from
    // the gallery has to come back to the gallery, not drop the visitor at a
    // workspace root. The CTA moved into the shared nav; that must not lose it.
    const signIn = screen.getAllByRole("link", { name: /get started/i })[0];
    expect(signIn.getAttribute("href")).toBe("/login?returnTo=%2Ftemplates");
  });

  it("offers the workspace instead once signed in", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue({
      id: 7,
      username: "author",
    } as never);
    vi.mocked(fetchWorkspaces).mockResolvedValue([
      { id: "ws-1", slug: "acme", name: "Acme" },
    ] as never);
    renderPage();
    await waitFor(() =>
      expect(
        screen.getAllByRole("link", { name: /go to workspace/i })[0],
      ).toBeTruthy(),
    );
  });

  it("still renders the gallery when the session probe fails", async () => {
    // The probe only decides which header button to show, so it must not be
    // able to take the gallery down with it.
    vi.mocked(fetchMeOptional).mockRejectedValue(new Error("offline"));
    renderPage();
    await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());
  });
});
