import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import DocumentAnalyticsPage from "./document-analytics";
import { getDocumentAnalytics } from "@/api/analytics";
import { HttpError } from "@/api/http-error";

vi.mock("@/api/analytics", () => ({
  getDocumentAnalytics: vi.fn(),
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/w/acme/analytics/d1"]}>
        <Routes>
          <Route
            path="/w/:workspaceId/analytics/:id"
            element={<DocumentAnalyticsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// This dashboard is manager-gated, so a member who lands here from a shared URL
// or a stale tab gets a 403 and should be told why rather than shown the
// generic failure text (issue #732).
describe("DocumentAnalyticsPage error states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains the manager gate on a 403", async () => {
    vi.mocked(getDocumentAnalytics).mockRejectedValue(
      new HttpError("Forbidden", 403),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/don't have permission/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/failed to load analytics/i)).toBeNull();
  });

  it("falls back to the generic message on a non-403 failure", async () => {
    vi.mocked(getDocumentAnalytics).mockRejectedValue(
      new HttpError("Boom", 500),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/failed to load analytics/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/don't have permission/i)).toBeNull();
  });

  it("falls back to the generic message on a non-HTTP failure", async () => {
    vi.mocked(getDocumentAnalytics).mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/failed to load analytics/i)).toBeTruthy(),
    );
  });
});
