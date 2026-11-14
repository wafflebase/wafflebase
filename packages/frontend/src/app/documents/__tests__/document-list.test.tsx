import { describe, it, expect, vi } from "vitest";
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

  it("names each row by a real link to the document, not a button row", () => {
    renderList({ data: [doc(1, "Q3 plan")] });
    const link = screen.getByRole("link", { name: "Q3 plan" });
    expect(link.getAttribute("href")).toBe("/d/1");
    // The row stays a row: it is not itself a button wrapping other controls.
    expect(link.closest("tr")?.getAttribute("role")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    // The row menu is named by what it acts on.
    expect(
      screen.getByRole("button", { name: "Actions for Q3 plan" }),
    ).toBeTruthy();
  });

  it("opens a folder from a keyboard-reachable button", () => {
    const onNavigateFolder = vi.fn();
    renderList({
      data: [],
      workspaceId: "ws-1",
      folders: [
        {
          id: "f-1",
          name: "Archive",
          parentId: null,
          authorID: null,
          createdAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      onNavigateFolder,
    });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onNavigateFolder).toHaveBeenCalledWith("f-1");
  });

  it("keeps the column layout when a filter empties the body", () => {
    renderList({ data: [doc(1, "Budget")] });
    const headerClasses = () =>
      screen.getAllByRole("columnheader").map((th) => th.className);
    const before = headerClasses();
    fireEvent.change(screen.getByLabelText("Search documents by title"), {
      target: { value: "zzzz" },
    });
    expect(headerClasses()).toEqual(before);
  });

  it("hides Owner and Created below md, keeping the row menu column", () => {
    renderList({ data: [doc(1, "Budget")] });
    const cells = screen.getByRole("link", { name: "Budget" }).closest("tr")!
      .children;
    const classes = Array.from(cells).map((td) => td.className);
    // select, title, owner, modified, created, actions
    expect(classes[2]).toContain("hidden");
    expect(classes[2]).toContain("md:table-cell");
    expect(classes[4]).toContain("md:table-cell");
    expect(classes[5]).not.toContain("hidden");
  });
});
