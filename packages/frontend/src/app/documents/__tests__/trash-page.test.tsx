/**
 * The Trash page: lists a workspace's trashed documents, restores them,
 * deletes them forever only after a confirm that names what is lost, and
 * leaves the actions disabled for a document the viewer cannot manage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/api/auth", () => ({ isAuthExpiredError: () => false }));
vi.mock("@/api/documents", () => ({
  fetchTrash: vi.fn(),
  restoreDocument: vi.fn(async () => ({})),
  deleteDocumentForever: vi.fn(async () => {}),
  deleteDocumentsForever: vi.fn(async () => ({ deleted: [] })),
}));

import {
  deleteDocumentForever,
  deleteDocumentsForever,
  fetchTrash,
  restoreDocument,
  type TrashedDocument,
} from "@/api/documents";
import TrashPage from "@/app/documents/trash-page";

function trashed(
  id: string,
  title: string,
  canManage = true,
): TrashedDocument {
  return {
    id,
    title,
    type: "doc",
    workspaceId: "ws-1",
    canManage,
    createdAt: "2026-11-01T00:00:00.000Z",
    deletedAt: "2026-11-13T00:00:00.000Z",
  } as unknown as TrashedDocument;
}

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <MemoryRouter initialEntries={["/w/team/trash"]}>
          <Routes>
            <Route path="/w/:workspaceId/trash" element={<TrashPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("TrashPage", () => {
  beforeEach(() => {
    vi.mocked(fetchTrash).mockReset();
    vi.mocked(restoreDocument).mockClear();
    vi.mocked(deleteDocumentForever).mockClear();
    vi.mocked(deleteDocumentsForever).mockClear();
  });

  it("says the Trash is empty, without promising a purge", async () => {
    vi.mocked(fetchTrash).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("Trash is empty")).toBeTruthy();
    expect(fetchTrash).toHaveBeenCalledWith("team");
    expect(document.body.textContent).not.toMatch(/\d+\s*days|automatically/i);
  });

  it("restores a document", async () => {
    vi.mocked(fetchTrash).mockResolvedValue([trashed("d1", "Roadmap")]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore Roadmap" }),
    );
    await waitFor(() => expect(restoreDocument).toHaveBeenCalledWith("d1"));
  });

  it("deletes forever only after a confirm that names what is lost", async () => {
    vi.mocked(fetchTrash).mockResolvedValue([trashed("d1", "Roadmap")]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Roadmap forever" }),
    );

    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete “Roadmap” forever?",
    });
    expect(dialog.textContent).toMatch(
      /can no longer be opened, restored or reached through its share links/,
    );
    expect(deleteDocumentForever).not.toHaveBeenCalled();
    // Cancel holds the initial focus, so a stray Enter does not destroy.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete forever" }));
    await waitFor(() =>
      expect(deleteDocumentForever).toHaveBeenCalledWith("d1"),
    );
  });

  it("empties only the documents the viewer can manage", async () => {
    vi.mocked(fetchTrash).mockResolvedValue([
      trashed("d1", "Mine"),
      trashed("d2", "Theirs", false),
      trashed("d3", "Also mine"),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Empty trash" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Empty trash?",
    });
    expect(dialog.textContent).toMatch(/stay in the Trash/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Empty trash" }));
    await waitFor(() =>
      expect(deleteDocumentsForever).toHaveBeenCalledWith(["d1", "d3"]),
    );
  });

  it("disables both actions for a document the viewer cannot manage", async () => {
    vi.mocked(fetchTrash).mockResolvedValue([trashed("d1", "Theirs", false)]);
    renderPage();
    const restore = await screen.findByRole("button", {
      name: "Restore Theirs",
    });
    expect((restore as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Delete Theirs forever",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    // Nothing to empty when nothing is manageable.
    expect(screen.queryByRole("button", { name: "Empty trash" })).toBeNull();
  });
});
