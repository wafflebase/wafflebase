import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { TemplateShareSection } from "./template-share-section";
import {
  getDocumentTemplate,
  updateTemplate,
  type TemplateListing,
} from "@/api/templates";

vi.mock("@/api/templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/templates")>()),
  getDocumentTemplate: vi.fn(),
  updateTemplate: vi.fn(),
}));

// No editor is mounted here, so there is nothing to take a picture of.
vi.mock("@/lib/thumbnail-capture", () => ({
  captureThumbnail: vi.fn(async () => null),
  hasThumbnailSource: () => false,
}));

// jsdom lacks the pointer-capture and scroll APIs Radix Select calls when it
// opens its listbox.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<
    string,
    unknown
  >;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

const LISTING: TemplateListing = {
  id: "tpl-1",
  documentId: "doc-1",
  documentType: "sheet",
  title: "Weekly Report",
  description: null,
  category: null,
  tags: ["weekly"],
  thumbnailId: null,
  visibility: "workspace",
  status: "listed",
  useCount: 0,
  publishedAt: null,
  author: null,
  previewToken: null,
  canManage: true,
  review: null,
};

async function renderWith(listing: TemplateListing) {
  vi.mocked(getDocumentTemplate).mockResolvedValue(listing);
  vi.mocked(updateTemplate).mockImplementation(async (_id, patch) => ({
    ...listing,
    ...patch,
  }) as TemplateListing);
  render(<TemplateShareSection documentId="doc-1" canManage ready />);
  await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());
}

function patchSent(): Record<string, unknown> {
  expect(updateTemplate).toHaveBeenCalledTimes(1);
  return vi.mocked(updateTemplate).mock.calls[0][1] as Record<string, unknown>;
}

describe("TemplateShareSection listing editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not echo a stored v1 category back when another field is saved", async () => {
    // A row the label → slug migration has not reached yet. The DTO now only
    // accepts slugs, so re-sending "Business" would 400 the whole save.
    await renderWith({ ...LISTING, category: "Business" });

    // The picker shows the slug the label maps to, not a blank trigger.
    expect(screen.getByLabelText("Category").textContent).toBe("Work");

    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "weekly, team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateTemplate).toHaveBeenCalled());
    expect(patchSent()).toEqual({ tags: ["weekly", "team"] });
  });

  it("writes a top/leaf slug when a leaf is picked", async () => {
    await renderWith(LISTING);

    fireEvent.keyDown(screen.getByLabelText("Category"), { key: "Enter" });
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "Meeting & 1:1",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateTemplate).toHaveBeenCalled());
    expect(patchSent()).toEqual({ category: "work/meeting" });
  });

  it("clears the category with an explicit null", async () => {
    await renderWith({ ...LISTING, category: "finance/budget" });
    expect(screen.getByLabelText("Category").textContent).toBe("Budget");

    fireEvent.keyDown(screen.getByLabelText("Category"), { key: "Enter" });
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", { name: "None" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateTemplate).toHaveBeenCalled());
    expect(patchSent()).toEqual({ category: null });
  });

  it("offers no Save until something changed", async () => {
    await renderWith({ ...LISTING, category: "Business" });
    // Resolving the legacy label for display is not a change of its own.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
