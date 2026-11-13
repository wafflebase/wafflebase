import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocumentList } from "@/app/documents/document-list";
import type { Document } from "@/types/documents";

function doc(id: number, title: string): Document {
  return {
    id,
    title,
    type: "doc",
    workspaceId: "ws-1",
    canManage: true,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  } as unknown as Document;
}

function renderList(props: Parameters<typeof DocumentList>[0]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DocumentList {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DocumentList", () => {
  it("shows a title exactly as typed, not re-cased", () => {
    renderList({ data: [doc(1, "Meeting notes")] });
    const title = screen.getByText("Meeting notes");
    expect(title.className).not.toContain("capitalize");
    // The full title stays reachable when the cell truncates it.
    expect(title.getAttribute("title")).toBe("Meeting notes");
  });

  it("says the filter matched nothing rather than that nothing exists", () => {
    renderList({ data: [doc(1, "Budget")] });
    fireEvent.change(screen.getByLabelText("Search documents by title"), {
      target: { value: "zzzz" },
    });

    expect(screen.getByText("No documents match your filters")).toBeTruthy();
    expect(screen.queryByText("No documents yet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Budget")).toBeTruthy();
  });

  it("calls an empty folder empty, and an empty workspace new", () => {
    const { unmount } = renderList({ data: [], folderId: "f-1" });
    expect(screen.getByText("This folder is empty")).toBeTruthy();
    unmount();

    renderList({ data: [] });
    expect(screen.getByText("No documents yet")).toBeTruthy();
  });

  it("shows pagination only when there is a second page", () => {
    const { unmount } = renderList({ data: [doc(1, "Only one")] });
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    unmount();

    renderList({
      data: Array.from({ length: 11 }, (_, i) => doc(i + 1, `Doc ${i + 1}`)),
    });
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
  });
});
