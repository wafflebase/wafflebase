import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { createWebhook, WebhookUrlError } from "@/api/webhooks";
import type { WebhookDetail } from "@/api/webhooks";
import { fetchFolders } from "@/api/folders";
import { CreateWebhookDialog } from "../create-webhook-dialog";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/api/auth", () => ({ isAuthExpiredError: () => false }));

vi.mock("@/api/webhooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/webhooks")>()),
  createWebhook: vi.fn(),
}));

vi.mock("@/api/folders", () => ({ fetchFolders: vi.fn() }));

const DETAIL: WebhookDetail = {
  id: "wh-1",
  name: "Zapier",
  host: "hooks.zapier.com",
  url: "https://hooks.zapier.com/x",
  status: "active",
  disabledReason: null,
  events: [],
  lastDeliveryAt: null,
  lastDeliveryStatus: null,
  createdBy: { id: 1, username: "owner" },
  createdAt: "2026-11-01T00:00:00.000Z",
  documentTypes: [],
  folderIds: [],
  format: "standard",
  disabledAt: null,
  rotationExpiresAt: null,
  failingSince: null,
};

function renderDialog() {
  const onCreated = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CreateWebhookDialog
        workspaceId="ws-1"
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        onOpenDetail={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onCreated };
}

async function fillRequired() {
  await userEvent.type(screen.getByLabelText("Name"), "Zapier");
  await userEvent.type(
    screen.getByLabelText("URL"),
    "https://hooks.zapier.com/x",
  );
}

const save = () =>
  userEvent.click(screen.getByRole("button", { name: "Save and send test" }));

describe("CreateWebhookDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts on Everything with every event checked", () => {
    renderDialog();
    expect(
      screen.getByRole("radio", { name: /Everything/ }).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    for (const box of screen.getAllByRole("checkbox")) {
      // The folder toggle is the one box that starts off.
      if (box.id === "create-webhook-limit-folders") continue;
      expect(box.getAttribute("data-state")).toBe("checked");
    }
    expect(screen.getByPlaceholderText("e.g. Zapier → weekly report")).toBeTruthy();
  });

  it("sends Everything as the empty filter", async () => {
    vi.mocked(createWebhook).mockResolvedValue({
      webhook: DETAIL,
      test: {
        ok: true,
        status: 200,
        durationMs: 80,
        error: null,
        errorCode: null,
        responseExcerpt: "ok",
      },
    });
    renderDialog();
    await fillRequired();
    await save();
    await waitFor(() =>
      expect(vi.mocked(createWebhook)).toHaveBeenCalledWith("ws-1", {
        name: "Zapier",
        url: "https://hooks.zapier.com/x",
        events: [],
        documentTypes: [],
        folderIds: [],
      }),
    );
  });

  it("checks a preset's bundle, which stays editable", async () => {
    vi.mocked(createWebhook).mockResolvedValue({
      webhook: DETAIL,
      test: {
        ok: true,
        status: 204,
        durationMs: 10,
        error: null,
        errorCode: null,
        responseExcerpt: null,
      },
    });
    renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /Sync members/ }));
    expect(
      screen.getByLabelText("Joined").getAttribute("data-state"),
    ).toBe("checked");
    expect(
      screen.getByLabelText("Created", { selector: "#create-webhook-event-document\\.created" })
        .getAttribute("data-state"),
    ).toBe("unchecked");
    // Unchecking one leaves the preset: it is a custom mix now.
    await userEvent.click(screen.getByLabelText("Removed"));
    expect(
      screen.getByRole("radio", { name: /Sync members/ }).getAttribute(
        "aria-checked",
      ),
    ).toBe("false");

    await fillRequired();
    await save();
    await waitFor(() =>
      expect(vi.mocked(createWebhook).mock.calls[0][1].events).toEqual([
        "member.joined",
      ]),
    );
  });

  it("shows the test result in place, a failure as a warning", async () => {
    const { onCreated } = renderDialog();
    vi.mocked(createWebhook).mockResolvedValue({
      webhook: DETAIL,
      test: {
        ok: false,
        status: 500,
        durationMs: 230,
        error: null,
        errorCode: null,
        responseExcerpt: "upstream exploded",
      },
    });
    await fillRequired();
    await save();

    const status = await screen.findByRole("status");
    expect(within(status).getByText("Test event not delivered")).toBeTruthy();
    expect(
      within(status).getByText(
        "Your endpoint answered 500 in 230 ms. Only a 2xx response counts as delivered.",
      ),
    ).toBeTruthy();
    expect(within(status).getByText("upstream exploded")).toBeTruthy();
    expect(within(status).getByText(/saved and active/)).toBeTruthy();
    expect(onCreated).toHaveBeenCalled();
  });

  it("explains a private address and names the setting that allows it", async () => {
    vi.mocked(createWebhook).mockRejectedValue(
      new WebhookUrlError("private", "private_address", "10.0.4.12"),
    );
    renderDialog();
    await fillRequired();
    await save();
    expect(
      await screen.findByText(
        "This address resolves to a private network (10.0.4.12). Your server administrator can allow it by adding the range to WAFFLEBASE_WEBHOOK_ALLOWED_CIDRS.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("URL").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("filters by the folders picked, shown as paths", async () => {
    vi.mocked(fetchFolders).mockResolvedValue([
      { id: "f1", name: "Reports", parentId: null, authorID: 1, createdAt: "" },
      { id: "f2", name: "Weekly", parentId: "f1", authorID: 1, createdAt: "" },
    ]);
    vi.mocked(createWebhook).mockResolvedValue({
      webhook: DETAIL,
      test: {
        ok: true,
        status: 200,
        durationMs: 1,
        error: null,
        errorCode: null,
        responseExcerpt: null,
      },
    });
    renderDialog();
    await fillRequired();
    await userEvent.click(screen.getByLabelText("Only documents in some folders"));
    // Refused until a folder is picked.
    expect(
      (screen.getByRole("button", { name: "Save and send test" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await userEvent.click(await screen.findByLabelText("Reports / Weekly"));
    await save();
    await waitFor(() =>
      expect(vi.mocked(createWebhook).mock.calls[0][1].folderIds).toEqual([
        "f2",
      ]),
    );
  });
});
