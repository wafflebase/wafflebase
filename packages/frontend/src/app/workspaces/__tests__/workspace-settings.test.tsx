import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import WorkspaceSettings from "@/app/workspaces/workspace-settings";
import { fetchMe } from "@/api/auth";
import { fetchWorkspace, fetchInvites } from "@/api/workspaces";
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

describe("WorkspaceSettings owner-only controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows member/invite management to an owner", async () => {
    renderAs(OWNER.user.id);

    // One trash icon per non-owner member.
    await waitFor(() =>
      expect(screen.getAllByLabelText("Remove member")).toHaveLength(2),
    );
    expect(screen.getByText("Create Invite")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText("Revoke invite")).toBeTruthy(),
    );
  });

  it("hides them from a non-owner member", async () => {
    renderAs(MEMBER.user.id);

    await waitFor(() => expect(screen.getByText("Members")).toBeTruthy());
    // Only the viewer's own row keeps a trash icon: self-removal is
    // permitted by the backend, unlike removing someone else.
    expect(screen.getAllByLabelText("Remove member")).toHaveLength(1);
    expect(screen.queryByText("Create Invite")).toBeNull();
    expect(screen.queryByText("Invites")).toBeNull();
    expect(screen.queryByLabelText("Revoke invite")).toBeNull();
    expect(vi.mocked(fetchInvites)).not.toHaveBeenCalled();
  });
});
