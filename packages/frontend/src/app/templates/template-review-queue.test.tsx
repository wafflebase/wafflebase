import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import TemplateReviewQueue from "./template-review-queue";
import { toast } from "sonner";
import { listTemplatesForReview, reviewTemplate } from "@/api/templates";
import { HttpError } from "@/api/http-error";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/api/templates", () => ({
  listTemplatesForReview: vi.fn(),
  reviewTemplate: vi.fn(),
}));

// The preview mounts the real read-only viewer, which needs Yorkie and a
// document. The queue's own behavior is what these tests are about.
vi.mock("@/app/shared/shared-document", () => ({
  SharedDocumentByToken: ({ token }: { token: string }) => (
    <div>previewing {token}</div>
  ),
}));

const SUBMISSION = {
  id: "tpl-1",
  documentId: "doc-1",
  documentType: "sheet",
  title: "Weekly Report",
  description: "A weekly status sheet",
  category: "Business",
  tags: [],
  thumbnailId: null,
  visibility: "workspace" as const,
  status: "pending",
  useCount: 0,
  publishedAt: null,
  author: { id: 7, username: "author", photo: null },
  previewToken: "tok-1",
  canManage: false,
  review: { submittedAt: null, reviewedAt: null, note: null, contentAt: null },
};

function renderQueue() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/templates"]}>
        <TemplateReviewQueue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TemplateReviewQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains the allowlist when the backend refuses", async () => {
    // The authority is `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` in the backend, so a
    // non-reviewer reaching this route gets a 403 rather than a hidden link.
    // Telling them why beats a generic failure.
    vi.mocked(listTemplatesForReview).mockRejectedValue(
      new HttpError("Not a template reviewer", 403),
    );
    renderQueue();
    await waitFor(() =>
      expect(screen.getByText(/not a template reviewer/i)).toBeTruthy(),
    );
  });

  it("says so when nothing is waiting", async () => {
    vi.mocked(listTemplatesForReview).mockResolvedValue([]);
    renderQueue();
    await waitFor(() =>
      expect(screen.getByText(/nothing is waiting for review/i)).toBeTruthy(),
    );
  });

  it("sends the reviewer's note with the decision", async () => {
    // The note is the only place a publisher is told why they were rejected —
    // a submission that disappears silently is the failure this pipeline
    // exists to prevent.
    vi.mocked(listTemplatesForReview).mockResolvedValue([SUBMISSION]);
    vi.mocked(reviewTemplate).mockResolvedValue(SUBMISSION);
    renderQueue();
    await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());

    await userEvent.type(screen.getByPlaceholderText(/reason/i), "too thin");
    await userEvent.click(screen.getByRole("button", { name: /^reject$/i }));

    await waitFor(() =>
      expect(reviewTemplate).toHaveBeenCalledWith(
        "tpl-1",
        "reject",
        "too thin",
        undefined,
      ),
    );
  });

  it.each([
    ["reject", /template rejected/i],
    ["takedown", /template taken down/i],
    ["approve", /template approved/i],
  ] as const)("says %s in words, not by suffixing the verb", async (
    decision,
    expected,
  ) => {
    // `Template ${decision}d` produced "Template rejectd" and "Template
    // takedownd", and only read correctly for "approve" by accident.
    vi.mocked(listTemplatesForReview).mockResolvedValue([SUBMISSION]);
    vi.mocked(reviewTemplate).mockResolvedValue(SUBMISSION);
    renderQueue();
    await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());

    await userEvent.type(screen.getByPlaceholderText(/reason/i), "note");
    await userEvent.click(
      screen.getByRole("button", {
        name:
          decision === "takedown"
            ? /take down/i
            : new RegExp(`^${decision}$`, "i"),
      }),
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(expected),
      ),
    );
  });

  it("previews on the submission's own token", async () => {
    // A reviewer belongs to neither the publisher's workspace nor the
    // document, so this token is the only thing that lets them see what they
    // are deciding.
    vi.mocked(listTemplatesForReview).mockResolvedValue([SUBMISSION]);
    renderQueue();
    await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /preview/i }));
    await waitFor(() =>
      expect(screen.getByText(/previewing tok-1/)).toBeTruthy(),
    );
  });

  it("offers no preview when the link was revoked", async () => {
    vi.mocked(listTemplatesForReview).mockResolvedValue([
      { ...SUBMISSION, previewToken: null },
    ]);
    renderQueue();
    await waitFor(() => expect(screen.getByText("Weekly Report")).toBeTruthy());
    expect(
      screen.getByRole("button", { name: /no preview/i }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
