import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import {
  enableWebhook,
  fetchWebhook,
  fetchWebhookDeliveries,
  fetchWebhookDelivery,
  redeliverWebhookDelivery,
  revealWebhookSecret,
  updateWebhook,
} from "@/api/webhooks";
import type { DeliverySummary, WebhookDetail } from "@/api/webhooks";
import { fetchWorkspace } from "@/api/workspaces";
import WebhookDetailPage from "../webhook-detail-page";
import { recoverSinceFor } from "../webhook-form-values";
import { webhookDetailPath } from "../webhook-paths";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/api/auth", () => ({ isAuthExpiredError: () => false }));

vi.mock("@/api/workspaces", () => ({ fetchWorkspace: vi.fn() }));
vi.mock("@/api/folders", () => ({ fetchFolders: vi.fn() }));

vi.mock("@/api/webhooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/webhooks")>()),
  fetchWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  testWebhook: vi.fn(),
  revealWebhookSecret: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  enableWebhook: vi.fn(),
  disableWebhook: vi.fn(),
  fetchWebhookDeliveries: vi.fn(),
  fetchWebhookDelivery: vi.fn(),
  redeliverWebhookDelivery: vi.fn(),
}));

const HOOK: WebhookDetail = {
  id: "wh-1",
  name: "Zapier weekly",
  host: "hooks.zapier.com",
  url: "https://hooks.zapier.com/x",
  status: "active",
  disabledReason: null,
  events: [],
  lastDeliveryAt: null,
  lastDeliveryStatus: null,
  createdBy: { id: 1, username: "owner" },
  createdAt: "2026-11-01T00:00:00.000Z",
  documentTypes: ["sheet"],
  folderIds: [],
  format: "standard",
  disabledAt: null,
  rotationExpiresAt: null,
  failingSince: null,
};

function delivery(id: string, over: Partial<DeliverySummary> = {}) {
  return {
    id,
    eventType: "document.created",
    status: "failed",
    attempts: 8,
    lastStatus: 502,
    lastError: "Bad gateway",
    lastDurationMs: 120,
    nextAttemptAt: "2026-11-20T00:00:00.000Z",
    deliveredAt: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    ...over,
  } as DeliverySummary;
}

function renderPage(webhook: WebhookDetail = HOOK) {
  vi.mocked(fetchWorkspace).mockResolvedValue({
    id: "ws-1",
    name: "Acme",
    slug: "acme",
    createdAt: "",
    members: [],
  });
  vi.mocked(fetchWebhook).mockResolvedValue(webhook);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[webhookDetailPath("acme", webhook.id)]}>
        <Routes>
          <Route
            path="/w/:workspaceId/settings/webhooks/:webhookId"
            element={<WebhookDetailPage />}
          />
          <Route path="/w/:workspaceId/settings" element={<p>settings</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WebhookDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchWebhookDeliveries).mockResolvedValue({
      deliveries: [],
      nextCursor: null,
    });
  });

  it("routes by slug and loads the webhook by the workspace's real id", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Zapier weekly" }),
    ).toBeTruthy();
    expect(vi.mocked(fetchWorkspace)).toHaveBeenCalledWith("acme");
    expect(vi.mocked(fetchWebhook)).toHaveBeenCalledWith("ws-1", "wh-1");
    expect(
      screen.getByRole("link", { name: "Webhooks" }).getAttribute("href"),
    ).toBe("/w/acme/settings#webhooks");
  });

  it("saves only what changed and keeps documentTypes", async () => {
    vi.mocked(updateWebhook).mockResolvedValue({
      webhook: { ...HOOK, name: "Renamed" },
      test: null,
    });
    renderPage();
    const name = await screen.findByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(vi.mocked(updateWebhook)).toHaveBeenCalledWith("ws-1", "wh-1", {
        name: "Renamed",
      }),
    );
  });

  it("masks the secret until revealed", async () => {
    vi.mocked(revealWebhookSecret).mockResolvedValue({
      secret: "whsec_abc",
      previousSecret: null,
      previousExpiresAt: null,
    });
    renderPage();
    expect(await screen.findByLabelText("Signing secret, hidden")).toBeTruthy();
    expect(screen.queryByText("whsec_abc")).toBeNull();
    await userEvent.click(screen.getByLabelText("Reveal secret"));
    expect(await screen.findByText("whsec_abc")).toBeTruthy();
  });

  it("disables Rotate during an overlap and says when it ends", async () => {
    renderPage({
      ...HOOK,
      rotationExpiresAt: new Date(Date.now() + 23 * 3600_000 - 60_000).toISOString(),
    });
    expect(
      await screen.findByText("Previous secret stops working in 23 h."),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Rotate secret" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("explains a disable and re-enables from when it was turned off", async () => {
    const disabled: WebhookDetail = {
      ...HOOK,
      status: "disabled",
      disabledReason: "failing",
      lastDeliveryStatus: 502,
      disabledAt: "2026-11-21T00:00:00.000Z",
      failingSince: "2026-11-18T00:00:00.000Z",
    };
    vi.mocked(enableWebhook).mockResolvedValue({ ...HOOK });
    renderPage(disabled);
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "Turned off automatically after 3 days of failed deliveries. Last response: 502.",
      ),
    ).toBeTruthy();
    await userEvent.click(within(alert).getByRole("button", { name: "Re-enable" }));
    await waitFor(() =>
      expect(vi.mocked(enableWebhook)).toHaveBeenCalledWith(
        "ws-1",
        "wh-1",
        "2026-11-21T00:00:00.000Z",
      ),
    );
  });

  it("maps each recover choice to recoverSince", () => {
    const w = { disabledAt: "D", failingSince: "F" };
    expect(recoverSinceFor("disabled", w)).toBe("D");
    expect(recoverSinceFor("failing", w)).toBe("F");
    expect(recoverSinceFor("none", w)).toBeNull();
  });

  it("filters, expands, redelivers and pages the delivery log", async () => {
    vi.mocked(fetchWebhookDeliveries).mockImplementation(
      async (_w, _h, opts) => {
        if (opts?.cursor) {
          return { deliveries: [delivery("d2")], nextCursor: null };
        }
        return {
          deliveries: [delivery("d1")],
          nextCursor: { before: "2026-11-20T00:00:00.000Z", beforeId: "d1" },
        };
      },
    );
    vi.mocked(fetchWebhookDelivery).mockResolvedValue({
      ...delivery("d1"),
      payload: { type: "document.created", data: { id: "doc-1" } },
      responseExcerpt: "<html>502</html>",
    });
    vi.mocked(redeliverWebhookDelivery).mockResolvedValue(
      delivery("d1", { status: "pending" }),
    );
    renderPage();

    const row = await screen.findByRole("button", { name: /document\.created/ });
    await userEvent.click(row);
    expect(await screen.findByText(/"doc-1"/)).toBeTruthy();
    expect(screen.getByText("<html>502</html>")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Redeliver" }));
    await waitFor(() =>
      expect(vi.mocked(redeliverWebhookDelivery)).toHaveBeenCalledWith(
        "ws-1",
        "wh-1",
        "d1",
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(vi.mocked(fetchWebhookDeliveries)).toHaveBeenCalledWith(
        "ws-1",
        "wh-1",
        expect.objectContaining({
          cursor: { before: "2026-11-20T00:00:00.000Z", beforeId: "d1" },
        }),
      ),
    );

    await userEvent.click(screen.getByLabelText("Failed only"));
    await waitFor(() =>
      expect(vi.mocked(fetchWebhookDeliveries)).toHaveBeenCalledWith(
        "ws-1",
        "wh-1",
        expect.objectContaining({ status: "failed" }),
      ),
    );
  });
});
