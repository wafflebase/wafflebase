import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { ImageViewer } from "@/app/files/image-viewer";

vi.mock("@/api/auth", () => ({
  fetchWithAuth: vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob(["x"], { type: "image/png" }),
  })),
}));
vi.mock("@/api/documents", () => ({
  fetchDocument: vi.fn(async () => ({
    id: "d1",
    title: "cat.png",
    type: "image",
    workspaceId: "w1",
  })),
  fetchDocuments: vi.fn(async () => []),
}));
vi.mock("@/api/files", () => ({ fileUrl: () => "/documents/d1/file" }));

// jsdom has no object-URL implementation; the viewer only needs a string.
URL.createObjectURL = vi.fn(() => "blob:image");
URL.revokeObjectURL = vi.fn();

function renderViewer(props: { onClose?: () => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/f/d1"]}>
        <ImageViewer documentId="d1" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ImageViewer Esc handling (issue #840)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves the viewer on Esc", async () => {
    const onClose = vi.fn();
    renderViewer({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("ignores Esc while typing — the header rename field uses it to cancel", () => {
    const onClose = vi.fn();
    renderViewer({ onClose });
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    input.remove();
  });

  it("does nothing on Esc for a share-link viewer, which has no list", () => {
    renderViewer();
    expect(() =>
      fireEvent.keyDown(window, { key: "Escape" }),
    ).not.toThrow();
  });
});
