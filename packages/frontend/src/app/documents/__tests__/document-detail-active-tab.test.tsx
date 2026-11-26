/**
 * Which tab a multi-tab spreadsheet opens on, asserted through the real route.
 *
 * Issue #1196 reported the rightmost tab being selected on first load. Nothing
 * asserted the opposite: `DocumentLayout` has nine writers of `activeTabId` and
 * only the `resolveActiveTabId` effect runs on load, but that was a property of
 * the code rather than of the test suite, so it was free to regress the next
 * time a jump, an import or a presence restore gained an effect.
 *
 * The document is a fake Yorkie root rather than a live one: the question is
 * which of three tabs the route selects and hands to the grid, and that is
 * decided before any CRDT traffic. Everything the route mounts beside the tab
 * bar — the sidebar, the header, the grid, the panels — is stubbed, because a
 * failure here has to mean "the wrong tab opened" and nothing else.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const TAB_IDS = ["t1", "t2", "t3"];

function worksheet() {
  return {
    rowOrder: [],
    colOrder: [],
    cells: {},
    comments: {},
    merges: {},
    charts: {},
    images: {},
  };
}

const fakeRoot = {
  tabs: {
    t1: { id: "t1", name: "Sheet1", type: "sheet" },
    t2: { id: "t2", name: "Sheet2", type: "sheet" },
    t3: { id: "t3", name: "Sheet3", type: "sheet" },
  } as Record<string, { id: string; name: string; type: string }>,
  tabOrder: TAB_IDS,
  sheets: { t1: worksheet(), t2: worksheet(), t3: worksheet() },
};

const fakeDoc = {
  getRoot: () => fakeRoot,
  update: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  getOthersPresences: vi.fn(() => []),
  clearHistory: vi.fn(),
};

vi.mock("@yorkie-js/react", () => ({
  useDocument: () => ({
    doc: fakeDoc,
    root: fakeRoot,
    loading: false,
    error: undefined,
  }),
  // `use-document-rename` builds a selector hook at module scope.
  createDocumentSelector: () => () => undefined,
}));
// Mocking the SDK's provider out from under it leaves nothing to render, and
// this route's question is answered inside the provider anyway.
vi.mock("@/components/collab-document-provider", () => ({
  CollabDocumentProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/hooks/use-presence-updater", () => ({
  usePresenceUpdater: () => {},
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-workspace-nav-items", () => ({
  useWorkspaceNavItems: () => [],
}));
vi.mock("@/api/auth", () => ({
  fetchMe: async () => ({
    id: 1,
    username: "tester",
    email: "tester@example.com",
    photo: "",
  }),
}));
vi.mock("@/api/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/documents")>()),
  fetchDocument: async () => ({
    id: "doc-1",
    title: "Workbook",
    type: "sheet",
    workspaceId: "ws-1",
  }),
}));
vi.mock("@/api/workspaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/workspaces")>()),
  fetchWorkspaces: async () => [{ id: "ws-1", slug: "ws", name: "WS" }],
}));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/site-header", () => ({
  SiteHeader: () => null,
  HeaderPanelToggle: () => null,
}));
vi.mock("@/components/share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("@/components/user-presence", () => ({ UserPresence: () => null }));
vi.mock("@/components/history/history-panel-lazy", () => ({
  LazyHistoryPanel: () => null,
}));
vi.mock("@/components/history/preview-surface", () => ({
  PreviewSurface: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  EditingChrome: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/comments/components/CommentSidePanel", () => ({
  CommentSidePanel: () => null,
}));
// The grid is the second half of the answer: the tab bar's highlight and the
// tab actually mounted have to name the same sheet.
vi.mock("@/app/spreadsheet/sheet-view", () => ({
  default: ({ tabId }: { tabId: string }) => (
    <div data-testid="grid" data-tab-id={tabId} />
  ),
}));

import DocumentDetail from "@/app/documents/document-detail";

function renderRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/d/doc-1"]}>
        <Routes>
          <Route path="/d/:id" element={<DocumentDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("opening a multi-tab spreadsheet", () => {
  it("selects the leftmost tab, not the last one", async () => {
    renderRoute();

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Sheet1",
      "Sheet2",
      "Sheet3",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(tabs[2]).toHaveAttribute("aria-selected", "false");
  });

  it("mounts the grid on that same first tab", async () => {
    renderRoute();

    await waitFor(() =>
      expect(screen.getByTestId("grid")).toHaveAttribute("data-tab-id", "t1"),
    );
  });
});
