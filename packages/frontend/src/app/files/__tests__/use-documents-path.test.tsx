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

  // A folder is a query parameter on the workspace list route, not a path
  // segment (`workspace-documents.tsx` reads `?folder`), so a destination
  // without it always lands at the workspace root — which is what made a
  // file opened from a folder come back to the wrong list.
  it("returns to the folder the document lives in", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue(workspaces);
    const { result } = renderHook(() => useDocumentsPath("w2", "f1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe("/w/second?folder=f1"));
  });

  it("treats a null folder as the workspace root", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue(workspaces);
    const { result } = renderHook(() => useDocumentsPath("w2", null), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe("/w/second"));
  });

  // Folder ids are scoped to one workspace's tree, so carrying one into the
  // fallback workspace would open a list filtered by a folder that does not
  // exist there.
  it("drops the folder when it falls back to another workspace", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue(workspaces);
    const { result } = renderHook(() => useDocumentsPath("gone", "f1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe("/w/first"));
  });

  it("escapes a folder id that would otherwise alter the query", async () => {
    vi.mocked(fetchWorkspaces).mockResolvedValue(workspaces);
    const { result } = renderHook(() => useDocumentsPath("w2", "a&b=c"), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current).toBe("/w/second?folder=a%26b%3Dc"),
    );
  });
});
