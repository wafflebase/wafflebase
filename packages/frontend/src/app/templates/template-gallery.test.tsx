import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TemplateGallery } from "./template-gallery";
import { browseTemplates } from "@/api/templates";

vi.mock("@/api/templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/templates")>()),
  browseTemplates: vi.fn(),
}));

const CARD = {
  id: "tpl-1",
  documentType: "sheet",
  title: "Weekly Report",
  description: null,
  category: null,
  tags: [],
  thumbnailId: null,
  visibility: "public" as const,
  status: "listed",
  useCount: 0,
  publishedAt: null,
  author: null,
  canManage: false,
  review: null,
};

function renderGallery(skin?: "app" | "marketing") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TemplateGallery
        scope="workspace"
        workspaceId="ws-1"
        selectLabel="Use"
        onSelect={() => {}}
        {...(skin ? { skin } : {})}
      />
    </QueryClientProvider>,
  );
}

describe("TemplateGallery skins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browseTemplates).mockResolvedValue({
      items: [CARD],
      nextCursor: null,
    });
  });

  // The default is the property that matters: `TemplateGallery` is shared with
  // the workspace Templates tab and the New-from-template dialog, both of which
  // live *inside* the app. Only the public gallery at `/templates` opts into
  // the landing page's skin, and it has to opt in explicitly — flipping this
  // default would put marketing chrome inside the product.
  it("defaults to the app skin, where the card's control is a separate button", async () => {
    renderGallery();
    await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());

    const control = screen.getByRole("button", { name: "Use Weekly Report" });
    // A small control beside the card, not the card: its own text is just the
    // label, and the title reaches assistive tech through `aria-label` only.
    expect(control.textContent).toBe("Use");
  });

  it("makes the whole card the control under the marketing skin", async () => {
    renderGallery("marketing");
    await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());

    const control = screen.getByRole("button", { name: "Use Weekly Report" });
    // The card itself is the button, so the title is inside it — which is the
    // point: a gallery whose pictures are not clickable reads as a list.
    expect(control.textContent).toContain("Weekly Report");
  });
});
