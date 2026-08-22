import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useDocumentsPath } from "@/app/files/use-documents-path";
import { fetchWorkspaces } from "@/api/workspaces";

vi.mock("@/api/workspaces", () => ({ fetchWorkspaces: vi.fn() }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const workspaces = [
  { id: "w1", name: "First", slug: "first", createdAt: "" },
  { id: "w2", name: "Second", slug: "second", createdAt: "" },
];

describe("useDocumentsPath", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the document's own workspace list", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue(workspaces);
    const { result } = renderHook(() => useDocumentsPath("w2"), { wrapper });
    await waitFor(() => expect(result.current).toBe("/w/second"));
  });

  it("falls back to the first workspace for an unknown workspace", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue(workspaces);
    const { result } = renderHook(() => useDocumentsPath(undefined), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe("/w/first"));
  });

  it("falls back to the workspace-less list when there are none", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue([]);
    const { result } = renderHook(() => useDocumentsPath("w1"), { wrapper });
    await waitFor(() => expect(result.current).toBe("/documents"));
  });
});
