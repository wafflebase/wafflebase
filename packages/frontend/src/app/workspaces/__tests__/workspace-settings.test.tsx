import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { toast } from "sonner";

import WorkspaceSettings from "@/app/workspaces/workspace-settings";
import { HttpError } from "@/api/http-error";
import { fetchMe } from "@/api/auth";
import {
  fetchWorkspace,
  fetchInvites,
  deleteWorkspace,
  removeMember,
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  fetchWorkspaceDataSources,
} from "@/api/workspaces";
import { deleteDataSource, testDataSourceConnection } from "@/api/datasources";
import { fetchMemberRemovalImpact, fetchWebhooks } from "@/api/webhooks";
import type { WebhookList } from "@/api/webhooks";
import type { DataSource } from "@/types/datasource";
import type {
  ApiKey,
  WorkspaceDetail,
  WorkspaceInvite,
} from "@/api/workspaces";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/api/auth", () => ({
  fetchMe: vi.fn(),
  isAuthExpiredError: () => false,
}));

vi.mock("@/api/workspaces", () => ({
  fetchWorkspace: vi.fn(),
  fetchWorkspaces: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  fetchInvites: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
  removeMember: vi.fn(),
  fetchApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  fetchWorkspaceDataSources: vi.fn(),
  createWorkspaceDataSource: vi.fn(),
  testWorkspaceDataSourceConfig: vi.fn(),
}));

vi.mock("@/api/webhooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/webhooks")>()),
  fetchWebhooks: vi.fn(),
  fetchMemberRemovalImpact: vi.fn(),
  createWebhook: vi.fn(),
}));

vi.mock("@/api/datasources", () => ({
  deleteDataSource: vi.fn(),
  testDataSourceConnection: vi.fn(),
  updateDataSource: vi.fn(),
}));

const OWNER = {
  id: "m-owner",
  role: "owner",
  joinedAt: "2026-01-01T00:00:00.000Z",
  user: { id: 1, username: "owner", email: "owner@example.com" },
};
const MEMBER = {
  id: "m-member",
  role: "member",
  joinedAt: "2026-01-02T00:00:00.000Z",
  user: { id: 2, username: "member", email: "member@example.com" },
};
const OTHER_MEMBER = {
  id: "m-other",
  role: "member",
  joinedAt: "2026-01-03T00:00:00.000Z",
  user: { id: 3, username: "other", email: "other@example.com" },
};

const WORKSPACE: WorkspaceDetail = {
  id: "ws-1",
  name: "Acme",
  slug: "acme",
  createdAt: "2026-01-01T00:00:00.000Z",
  members: [OWNER, MEMBER, OTHER_MEMBER],
};

const INVITE: WorkspaceInvite = {
  id: "inv-1",
  token: "tok",
  role: "member",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
};

/** An API key as the server returns it, minted by `createdBy`. */
function apiKey(id: string, name: string, createdBy: number): ApiKey {
  return {
    id,
    name,
    prefix: `wfb_${id}`,
    scopes: ["read", "write"],
    createdBy,
    createdAt: "2026-02-01T00:00:00.000Z",
    expiresAt: null,
    lastUsedAt: null,
  };
}

const OWNER_KEY = apiKey("k-owner", "Owner CI", OWNER.user.id);
const MEMBER_KEY = apiKey("k-member", "Member CLI", MEMBER.user.id);

/**
 * Renders the settings page as the user with the given id. `keys` is what the
 * server hands this caller back — a member only ever sees their own.
 */
function renderAs(
  userId: number,
  keys: ApiKey[] = [],
  datasources: DataSource[] = [],
  webhooks: WebhookList = {
    enabled: true,
    canManage: userId === OWNER.user.id,
    webhooks: [],
  },
) {
  vi.mocked(fetchMe).mockResolvedValue({
    id: userId,
    username: "u",
    email: "u@example.com",
  } as Awaited<ReturnType<typeof fetchMe>>);
  vi.mocked(fetchWorkspace).mockResolvedValue(WORKSPACE);
  vi.mocked(fetchInvites).mockResolvedValue([INVITE]);
  vi.mocked(fetchApiKeys).mockResolvedValue(keys);
  vi.mocked(fetchWorkspaceDataSources).mockResolvedValue(datasources);
  vi.mocked(fetchWebhooks).mockResolvedValue(webhooks);
  vi.mocked(fetchMemberRemovalImpact).mockResolvedValue({
    privateChannelsDeleted: 0,
    webhooksDisabled: 0,
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/w/acme/settings"]}>
        <Routes>
          <Route
            path="/w/:workspaceId/settings"
            element={<WorkspaceSettings />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The `<tr>` holding the given member, located by their (unique) email cell so
 * the assertion is anchored to a specific row rather than a global count.
 */
function memberRow(email: string): HTMLElement {
  const row = screen.getByText(email).closest("tr");
  if (!row) throw new Error(`No member row for ${email}`);
  return row;
}

describe("WorkspaceSettings owner-only controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows member/invite management to an owner", async () => {
    renderAs(OWNER.user.id);

    // A trash icon in every non-owner row, none in the owner's own row.
    await waitFor(() =>
      expect(screen.getAllByLabelText("Remove member")).toHaveLength(2),
    );
    expect(
      within(memberRow(MEMBER.user.email)).getByLabelText("Remove member"),
    ).toBeTruthy();
    expect(
      within(memberRow(OTHER_MEMBER.user.email)).getByLabelText(
        "Remove member",
      ),
    ).toBeTruthy();
    expect(
      within(memberRow(OWNER.user.email)).queryByLabelText("Remove member"),
    ).toBeNull();

    expect(screen.getByText("Create invite link")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText("Revoke invite")).toBeTruthy(),
    );
  });

  it("hides them from a non-owner member", async () => {
    renderAs(MEMBER.user.id);

    // Wait on a control that depends on the auth query, so the negative
    // assertions below cannot pass merely because `me` has not resolved yet.
    await waitFor(() =>
      expect(
        within(memberRow(MEMBER.user.email)).getByLabelText("Remove member"),
      ).toBeTruthy(),
    );
    // Only the viewer's own row keeps a trash icon: self-removal is
    // permitted by the backend, unlike removing someone else.
    expect(screen.getAllByLabelText("Remove member")).toHaveLength(1);
    expect(
      within(memberRow(OTHER_MEMBER.user.email)).queryByLabelText(
        "Remove member",
      ),
    ).toBeNull();
    expect(
      within(memberRow(OWNER.user.email)).queryByLabelText("Remove member"),
    ).toBeNull();

    expect(screen.queryByText("Create invite link")).toBeNull();
    expect(screen.queryByText("Invites")).toBeNull();
    expect(screen.queryByLabelText("Revoke invite")).toBeNull();
    expect(vi.mocked(fetchInvites)).not.toHaveBeenCalled();
  });

  it("lets a non-owner member remove themselves", async () => {
    vi.mocked(removeMember).mockResolvedValue(undefined);
    renderAs(MEMBER.user.id);

    const selfButton = await waitFor(() =>
      within(memberRow(MEMBER.user.email)).getByLabelText("Remove member"),
    );
    await userEvent.click(selfButton);
    // The click opens a confirm dialog rather than removing on the spot.
    expect(vi.mocked(removeMember)).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      await within(dialog).findByRole("button", { name: "Leave" }),
    );

    await waitFor(() =>
      expect(vi.mocked(removeMember)).toHaveBeenCalledWith(
        "acme",
        MEMBER.user.id,
      ),
    );
  });

  it("names what removing a member deletes and turns off", async () => {
    vi.mocked(removeMember).mockResolvedValue(undefined);
    renderAs(OWNER.user.id);
    vi.mocked(fetchMemberRemovalImpact).mockResolvedValue({
      privateChannelsDeleted: 2,
      webhooksDisabled: 1,
    });

    await userEvent.click(
      await waitFor(() =>
        within(memberRow(MEMBER.user.email)).getByLabelText("Remove member"),
      ),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        "2 private channels only they belonged to will be deleted, messages included.",
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("1 webhook they created will be turned off."),
    ).toBeTruthy();
    // The impact is asked for by the workspace's real id.
    expect(vi.mocked(fetchMemberRemovalImpact)).toHaveBeenCalledWith(
      "ws-1",
      MEMBER.user.id,
    );

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(vi.mocked(removeMember)).not.toHaveBeenCalled();

    await userEvent.click(
      within(memberRow(MEMBER.user.email)).getByLabelText("Remove member"),
    );
    await userEvent.click(
      await within(await screen.findByRole("dialog")).findByRole("button", {
        name: "Remove",
      }),
    );
    await waitFor(() =>
      expect(vi.mocked(removeMember)).toHaveBeenCalledWith(
        "acme",
        MEMBER.user.id,
      ),
    );
  });
});

describe("WorkspaceSettings webhooks section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const HOOK = {
    id: "wh-1",
    name: "Zapier weekly",
    host: "hooks.zapier.com",
    status: "disabled" as const,
    disabledReason: "failing" as const,
    events: [],
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    createdBy: { id: 1, username: "owner" },
    createdAt: "2026-11-01T00:00:00.000Z",
  };

  it("lists webhooks with status and links an owner to the detail page", async () => {
    renderAs(OWNER.user.id, [], [], {
      enabled: true,
      canManage: true,
      webhooks: [HOOK],
    });
    const link = await screen.findByRole("link", { name: /Zapier weekly/ });
    expect(link.getAttribute("href")).toBe("/w/acme/settings/webhooks/wh-1");
    expect(within(link).getByText("Off · failing")).toBeTruthy();
    expect(within(link).getByText(/hooks\.zapier\.com/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add webhook" })).toBeTruthy();
    // Asked for by the workspace's real id, not the slug in the URL.
    expect(vi.mocked(fetchWebhooks)).toHaveBeenCalledWith("ws-1");
  });

  it("shows a member the hosts read-only", async () => {
    renderAs(MEMBER.user.id, [], [], {
      enabled: true,
      canManage: false,
      webhooks: [HOOK],
    });
    expect(await screen.findByText("Zapier weekly")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Zapier weekly/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add webhook" })).toBeNull();
  });

  it("tells an owner which setting turns the feature on", async () => {
    renderAs(OWNER.user.id, [], [], {
      enabled: false,
      canManage: true,
      webhooks: [],
    });
    expect(
      await screen.findByText("WAFFLEBASE_WEBHOOKS_ENABLED=true"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add webhook" })).toBeNull();
  });
});

/**
 * The `<tr>` holding the given API key, located by its (unique) name cell —
 * creator names repeat in the Members table above, so a global text lookup
 * would be ambiguous.
 */
function keyRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`No API key row for ${name}`);
  return row;
}

describe("WorkspaceSettings API keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows every key with a Created by column to an owner", async () => {
    renderAs(OWNER.user.id, [OWNER_KEY, MEMBER_KEY]);

    await waitFor(() => expect(keyRow(MEMBER_KEY.name)).toBeTruthy());
    expect(vi.mocked(fetchApiKeys)).toHaveBeenCalledWith("acme");

    // The owner-only column resolves each key's minter to their username.
    expect(
      screen.getByRole("columnheader", { name: "Created by" }),
    ).toBeTruthy();
    expect(
      within(keyRow(MEMBER_KEY.name)).getByText(MEMBER.user.username),
    ).toBeTruthy();
    expect(
      within(keyRow(OWNER_KEY.name)).getByText(OWNER.user.username),
    ).toBeTruthy();

    // An owner may revoke any of them.
    expect(screen.getAllByLabelText(/^Revoke API key /)).toHaveLength(2);
  });

  it("shows the section to a non-owner member, without Created by", async () => {
    renderAs(MEMBER.user.id, [MEMBER_KEY]);

    // The section is no longer gated on ownership, and the query runs for a
    // member too — the server is what narrows the list to their own keys.
    await waitFor(() => expect(keyRow(MEMBER_KEY.name)).toBeTruthy());
    expect(vi.mocked(fetchApiKeys)).toHaveBeenCalledWith("acme");
    expect(screen.getByRole("heading", { name: "API keys" })).toBeTruthy();
    expect(screen.getByText("Create API key")).toBeTruthy();

    expect(
      screen.queryByRole("columnheader", { name: "Created by" }),
    ).toBeNull();
    expect(screen.getAllByLabelText(/^Revoke API key /)).toHaveLength(1);
  });

  it("lets a non-owner member mint a key and reveals it once", async () => {
    vi.mocked(createApiKey).mockResolvedValue({
      id: "k-new",
      name: "Laptop",
      prefix: "wfb_k-new",
      key: "wfb_k-new_secret",
    });
    renderAs(MEMBER.user.id);

    await waitFor(() => expect(screen.getByText("Create API key")).toBeTruthy());
    await userEvent.click(screen.getByText("Create API key"));
    await userEvent.type(screen.getByLabelText("API key name"), "Laptop");
    await userEvent.click(screen.getByText("Create"));

    await waitFor(() =>
      expect(vi.mocked(createApiKey)).toHaveBeenCalledWith("acme", {
        name: "Laptop",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("wfb_k-new_secret")).toBeTruthy(),
    );
  });

  it("hands over the CLI setup lines with a new key, and keeps it on Escape", async () => {
    vi.mocked(createApiKey).mockResolvedValue({
      id: "k-new",
      name: "Laptop",
      prefix: "wfb_k-new",
      key: "wfb_k-new_secret",
    });
    renderAs(MEMBER.user.id);

    await waitFor(() => expect(screen.getByText("Create API key")).toBeTruthy());
    await userEvent.click(screen.getByText("Create API key"));
    await userEvent.type(screen.getByLabelText("API key name"), "Laptop");
    await userEvent.click(screen.getByText("Create"));

    const dialog = await screen.findByRole("dialog", { name: "API key created" });
    // The workspace id, not the slug: renaming the URL must not break a
    // script that was set up from this dialog.
    const setup = within(dialog).getByLabelText("CLI setup");
    expect(setup.textContent).toContain(
      "export WAFFLEBASE_API_KEY=wfb_k-new_secret",
    );
    expect(setup.textContent).toContain(
      `export WAFFLEBASE_WORKSPACE=${WORKSPACE.id}`,
    );
    // An export lives only as long as its shell, and Claude Code reads the
    // environment when it starts: say both.
    expect(
      within(dialog).getByText(/Start Claude Code from that same shell/),
    ).toBeTruthy();

    // Escape (or a stray click outside) must not throw the key away.
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "API key created" })).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "API key created" })).toBeNull(),
    );
  });

  it("links each long section from an index at the top", async () => {
    renderAs(MEMBER.user.id, [MEMBER_KEY]);

    const nav = await screen.findByRole("navigation", { name: "Settings sections" });
    for (const [label, id] of [
      ["Members", "members"],
      ["API keys", "api-keys"],
      ["Data sources", "datasources"],
      ["Webhooks", "webhooks"],
    ]) {
      const link = within(nav).getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(`#${id}`);
      expect(document.getElementById(id)).toBeTruthy();
    }
  });

  it("lets a non-owner member revoke their own key, after confirming", async () => {
    vi.mocked(revokeApiKey).mockResolvedValue(undefined);
    renderAs(MEMBER.user.id, [MEMBER_KEY]);

    const button = await waitFor(() =>
      within(keyRow(MEMBER_KEY.name)).getByLabelText(
        `Revoke API key ${MEMBER_KEY.name}`,
      ),
    );
    await userEvent.click(button);

    // The trash can only opens the confirmation; nothing is revoked yet.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(`Revoke ${MEMBER_KEY.name}`)).toBeTruthy();
    expect(vi.mocked(revokeApiKey)).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(vi.mocked(revokeApiKey)).toHaveBeenCalledWith(
        "acme",
        MEMBER_KEY.id,
      ),
    );
  });
});

describe("WorkspaceSettings action hierarchy and errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Primary = the syrup fill; outline buttons carry `border` instead. */
  const isPrimary = (el: HTMLElement) =>
    el.closest("button")?.className.split(/\s+/).includes("bg-primary");

  it("gives an owner one primary create action, not two", async () => {
    renderAs(OWNER.user.id);
    const invite = await screen.findByText("Create invite link");
    const apiKeyButton = screen.getByText("Create API key");
    expect(isPrimary(invite)).toBe(true);
    expect(isPrimary(apiKeyButton)).toBe(false);
  });

  it("keeps Create API key primary for a member, where it stands alone", async () => {
    renderAs(MEMBER.user.id);
    const apiKeyButton = await screen.findByText("Create API key");
    expect(isPrimary(apiKeyButton)).toBe(true);
  });

  async function failDelete(error: Error) {
    vi.mocked(deleteWorkspace).mockRejectedValue(error);
    renderAs(OWNER.user.id);
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete this workspace" }),
    );
    await userEvent.type(screen.getByLabelText(/to confirm/), WORKSPACE.name);
    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /delete/i }),
    );
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    return vi.mocked(toast.error).mock.calls[0][0];
  }

  it("never toasts developer text when deleting fails", async () => {
    const message = await failDelete(new TypeError("Failed to fetch"));
    expect(message).toBe(
      "Couldn't delete the workspace. Try again in a moment.",
    );
  });

  it("shows the server's own refusal when it is written for a reader", async () => {
    const message = await failDelete(
      new HttpError("Only the workspace owner can delete it.", 403),
    );
    expect(message).toBe("Only the workspace owner can delete it.");
  });
});

const REPLICA: DataSource = {
  id: "ds-1",
  name: "Production replica",
  host: "db.internal.acme.io",
  port: 5432,
  database: "analytics",
  username: "readonly",
  password: "",
  sslEnabled: true,
  authorID: OWNER.user.id,
  workspaceId: WORKSPACE.id,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

describe("WorkspaceSettings data sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the workspace's connections to a non-owner member", async () => {
    renderAs(MEMBER.user.id, [], [REPLICA]);

    expect(await screen.findByText("Production replica")).toBeTruthy();
    expect(
      screen.getByText("readonly@db.internal.acme.io:5432/analytics"),
    ).toBeTruthy();
    expect(screen.getByText("New data source")).toBeTruthy();
    expect(vi.mocked(fetchWorkspaceDataSources)).toHaveBeenCalledWith("acme");
  });

  it("says so when there are none", async () => {
    renderAs(OWNER.user.id);
    expect(await screen.findByText("No data sources.")).toBeTruthy();
  });

  it("shows the outcome of Test connection on the row", async () => {
    vi.mocked(testDataSourceConnection).mockResolvedValue({
      success: false,
      error: "timeout",
    });
    renderAs(OWNER.user.id, [], [REPLICA]);

    const user = userEvent.setup();
    await user.click(
      await screen.findByLabelText("Actions for Production replica"),
    );
    await user.click(await screen.findByText("Test connection"));

    expect(await screen.findByLabelText("Couldn't connect")).toBeTruthy();
    expect(vi.mocked(testDataSourceConnection)).toHaveBeenCalledWith("ds-1");
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Couldn't connect: timeout",
    );
  });

  it("deletes from the row menu and refetches", async () => {
    vi.mocked(deleteDataSource).mockResolvedValue(undefined);
    renderAs(OWNER.user.id, [], [REPLICA]);

    const user = userEvent.setup();
    await user.click(
      await screen.findByLabelText("Actions for Production replica"),
    );
    await user.click(await screen.findByText("Delete"));

    await waitFor(() =>
      expect(vi.mocked(deleteDataSource)).toHaveBeenCalledWith("ds-1"),
    );
    await waitFor(() =>
      expect(vi.mocked(fetchWorkspaceDataSources)).toHaveBeenCalledTimes(2),
    );
  });
});
