/**
 * Deleting from the documents list moves documents to the Trash without a
 * confirm, and the toast's Undo restores exactly what was moved. A folder in
 * the selection still confirms, because deleting a folder is not undoable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    warning: vi.fn(),
  }),
}));

vi.mock("@/api/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/documents")>()),
  deleteDocuments: vi.fn(async (ids: string[]) => ({ deleted: ids })),
  restoreDocuments: vi.fn(async () => []),
}));
vi.mock("@/api/folders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/folders")>()),
  deleteFolder: vi.fn(async () => {}),
}));

import { deleteDocuments, restoreDocuments } from "@/api/documents";
import { DocumentList } from "@/app/documents/document-list";
import type { Document } from "@/types/documents";

function doc(id: string, title: string): Document {
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
      <TooltipProvider>
        <MemoryRouter>
          <DocumentList {...props} />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** Radix menus open on pointerdown, not click. */
function openMenu(name: string) {
  const trigger = screen.getByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
}

describe("DocumentList delete → Trash", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
    vi.mocked(deleteDocuments).mockClear();
    vi.mocked(restoreDocuments).mockClear();
  });

  it("moves a document to the Trash without a confirm, and Undo restores it", async () => {
    renderList({ data: [doc("d1", "Roadmap"), doc("d2", "Budget")] });

    openMenu("Actions for Roadmap");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move to Trash" }));

    await waitFor(() => expect(deleteDocuments).toHaveBeenCalledWith(["d1"]));
    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [message, options] = toastSuccess.mock.calls[0];
    expect(message).toBe("Moved “Roadmap” to Trash");
    expect(options.action.label).toBe("Undo");

    options.action.onClick();
    await waitFor(() => expect(restoreDocuments).toHaveBeenCalledWith(["d1"]));
  });

  it("moves a bulk selection to the Trash and undoes all of it", async () => {
    renderList({ data: [doc("d1", "Roadmap"), doc("d2", "Budget")] });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Roadmap" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Budget" }));
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));

    await waitFor(() => expect(deleteDocuments).toHaveBeenCalled());
    const ids = vi.mocked(deleteDocuments).mock.calls[0][0];
    expect([...ids].sort()).toEqual(["d1", "d2"]);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [message, options] = toastSuccess.mock.calls[0];
    expect(message).toBe("Moved 2 documents to Trash");
    options.action.onClick();
    await waitFor(() => expect(restoreDocuments).toHaveBeenCalledWith(ids));
  });

  it("still confirms when a folder is involved", async () => {
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
      onNavigateFolder: () => {},
    });

    openMenu("Actions for Archive");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(
      await screen.findByRole("dialog", { name: "Delete “Archive”?" }),
    ).toBeTruthy();
    expect(deleteDocuments).not.toHaveBeenCalled();
  });
});
