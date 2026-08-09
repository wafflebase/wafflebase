import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import WorkspaceSettings from "@/app/workspaces/workspace-settings";
import { fetchMe } from "@/api/auth";
import { fetchWorkspace, fetchInvites, removeMember } from "@/api/workspaces";
import type { WorkspaceDetail, WorkspaceInvite } from "@/api/workspaces";

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

/**
 * Renders the settings page as the user with the given id.
 */
function renderAs(userId: number) {
  vi.mocked(fetchMe).mockResolvedValue({
    id: userId,
    username: "u",
    email: "u@example.com",
  } as Awaited<ReturnType<typeof fetchMe>>);
  vi.mocked(fetchWorkspace).mockResolvedValue(WORKSPACE);
  vi.mocked(fetchInvites).mockResolvedValue([INVITE]);

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

    expect(screen.getByText("Create Invite")).toBeTruthy();
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

    expect(screen.queryByText("Create Invite")).toBeNull();
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

    await waitFor(() =>
      expect(vi.mocked(removeMember)).toHaveBeenCalledWith(
        "acme",
        MEMBER.user.id,
      ),
    );
  });
});
