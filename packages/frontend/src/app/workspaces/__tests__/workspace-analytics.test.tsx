import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import WorkspaceAnalytics from "@/app/workspaces/workspace-analytics";
import { getWorkspaceAnalytics } from "@/api/workspaces";
import type { WorkspaceAnalytics as WorkspaceAnalyticsData } from "@/api/workspaces";

vi.mock("@/api/workspaces", () => ({
  getWorkspaceAnalytics: vi.fn(),
}));

const DATA: WorkspaceAnalyticsData = {
  enabled: true,
  totalViews: 9,
  uniqueVisitors: 4,
  viewsByDay: [],
  byDocument: [
    {
      documentId: "d1",
      title: "Mine",
      views: 7,
      uniqueVisitors: 3,
      canManage: true,
    },
    {
      documentId: "d2",
      title: "Theirs",
      views: 2,
      uniqueVisitors: 1,
      canManage: false,
    },
  ],
};

function renderPage() {
  vi.mocked(getWorkspaceAnalytics).mockResolvedValue(DATA);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/w/acme/analytics"]}>
        <Routes>
          <Route
            path="/w/:workspaceId/analytics"
            element={<WorkspaceAnalytics />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The `<tr>` holding the given document, anchored by its title cell. */
function documentRow(title: string): HTMLElement {
  const row = screen.getByText(title).closest("tr");
  if (!row) throw new Error(`No row for ${title}`);
  return row;
}

// The detail dashboard is manager-gated while this ranking is member-gated, so
// linking a row the caller cannot manage sends them into a 403 (issue #732).
describe("WorkspaceAnalytics document ranking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links only the rows the caller can manage", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Mine")).toBeTruthy());

    const mine = within(documentRow("Mine")).getByRole("link", {
      name: "Details",
    });
    expect(mine.getAttribute("href")).toBe("/w/acme/analytics/d1");
    expect(
      within(documentRow("Theirs")).queryByRole("link", { name: "Details" }),
    ).toBeNull();
  });
});
