import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { ImageViewer } from "@/app/files/image-viewer";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigate };
});

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
  // Two siblings so ←/→ have somewhere to go. With an empty list `prevId`
  // and `nextId` are undefined and `navigate` is unreachable, which made
  // every arrow-key assertion pass for the wrong reason.
  fetchDocuments: vi.fn(async () => [
    { id: "d1", title: "cat.png", type: "image", workspaceId: "w1" },
    { id: "d2", title: "dog.png", type: "image", workspaceId: "w1" },
  ]),
}));
vi.mock("@/api/files", () => ({ fileUrl: () => "/documents/d1/file" }));

// jsdom has no object-URL implementation; the viewer only needs a string.
URL.createObjectURL = vi.fn(() => "blob:image");
URL.revokeObjectURL = vi.fn();

function renderViewer(
  props: { onClose?: () => void; token?: string } = {},
  overlay: boolean | "tooltip" = false,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/f/d1"]}>
        <ImageViewer documentId="d1" {...props} />
        {/* A real Radix Dialog, so the viewer's open-overlay detection is
            asserted against the library's actual markup rather than a
            hand-written stand-in. Controlled + always open: Esc asks it to
            close but it stays mounted, which is exactly the instant the
            viewer must not act on. */}
        {overlay === true && (
          <Dialog open>
            <DialogContent>
              <DialogTitle>Share</DialogTitle>
            </DialogContent>
          </Dialog>
        )}
        {/* A real sidebar-style nav tooltip: portaled into a Radix popper
            wrapper, and `hidden` because that is how SidebarMenuButton renders
            it on an expanded desktop sidebar. Nothing is on screen, so the
            viewer's keys must keep working. */}
        {overlay === "tooltip" && (
          <TooltipProvider>
            <Tooltip open>
              <TooltipTrigger>Documents</TooltipTrigger>
              <TooltipContent hidden>Documents</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
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

  // The ShareDialog sits in the same header as the viewer, and on mobile so
  // does the sidebar Sheet. Both dismiss on Esc from a document-level
  // listener without stopping propagation, so an unguarded window listener
  // would close the overlay *and* navigate away behind it.
  it("ignores Esc that dismisses an overlay layered over it", () => {
    const onClose = vi.fn();
    const { unmount } = renderViewer({ onClose }, true);
    const dialog = document.querySelector('[role="dialog"]')!;
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    // Arrow keys belong to the overlay too while it is open.
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(navigate).not.toHaveBeenCalled();
    unmount();

    // With no overlay mounted the very same keystroke does leave the viewer,
    // so the guard above is not just suppressing Esc outright.
    renderViewer({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // A hovered or focused sidebar nav item opens a Radix tooltip whose content
  // is `hidden` on an expanded sidebar. It mounts a popper wrapper all the
  // same, so treating every wrapper as an open overlay left Esc and the arrow
  // keys dead with nothing visible to explain it.
  it("still handles keys while an invisible nav tooltip is mounted", () => {
    const onClose = vi.fn();
    renderViewer({ onClose }, "tooltip");
    expect(
      document.querySelector("[data-radix-popper-content-wrapper]"),
    ).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The arrows are the other half of what a hovered nav item used to kill,
  // and they fail differently: Esc has `onClose` to observe, while prev/next
  // needs a populated neighbour list before `navigate` is reachable at all.
  it("still navigates with the arrows while that tooltip is mounted", async () => {
    renderViewer({ onClose: vi.fn() }, "tooltip");
    await waitFor(() =>
      expect(
        document.querySelector("[data-radix-popper-content-wrapper]"),
      ).not.toBeNull(),
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/f/d2"));
  });

  // The share mount passes a token and no `onClose`: an anonymous viewer has
  // no documents list, so Esc must stay inert rather than navigate anywhere.
  it("does nothing on Esc for a share-link viewer, which has no list", () => {
    // jsdom reports an exception thrown inside a listener as a window
    // `error` event rather than rethrowing out of dispatchEvent, so the
    // missing-`onClose` guard has to be asserted through that channel — an
    // `expect(...).not.toThrow()` around the dispatch would pass either way.
    const onError = vi.fn();
    window.addEventListener("error", onError);
    renderViewer({ token: "share-token" });
    fireEvent.keyDown(window, { key: "Escape" });
    window.removeEventListener("error", onError);
    expect(onError).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
