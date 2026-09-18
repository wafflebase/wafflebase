import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The cleanup rule this feature states is that content must not outlive the
 * authority to read it — and these two calls are where that authority ends for
 * a whole workspace at a time. Both of them run on the device of whoever made
 * the request, which is what makes the cross-account guard load-bearing: an
 * owner removing *somebody else* must purge nothing here, because the store is
 * scoped to whoever is signed in on this machine.
 */

vi.mock("./auth", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("./documents", () => ({ fetchDocuments: vi.fn() }));
vi.mock("@/lib/offline-erase", () => ({
  isOfflineUser: vi.fn(),
  purgeOfflineDocuments: vi.fn(),
}));

import { fetchWithAuth } from "./auth";
import { fetchDocuments } from "./documents";
import { isOfflineUser, purgeOfflineDocuments } from "@/lib/offline-erase";
import { deleteWorkspace, removeMember } from "./workspaces";

const mockFetch = vi.mocked(fetchWithAuth);
const mockDocuments = vi.mocked(fetchDocuments);
const mockIsOfflineUser = vi.mocked(isOfflineUser);
const mockPurge = vi.mocked(purgeOfflineDocuments);

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const WORKSPACE = {
  id: "ws-uuid",
  name: "Team",
  slug: "team",
  createdAt: "",
  members: [],
};

beforeEach(() => {
  mockFetch.mockReset();
  mockDocuments.mockReset();
  mockIsOfflineUser.mockReset();
  mockPurge.mockReset();
  mockPurge.mockResolvedValue(undefined);
});

describe("deleteWorkspace", () => {
  it("purges the documents it listed before the workspace was deleted", async () => {
    // Listed first, because afterwards the server has nothing to list.
    mockFetch.mockImplementation(async (input: RequestInfo) =>
      String(input).endsWith("/workspaces/team")
        ? okJson(WORKSPACE)
        : okJson({}),
    );
    mockDocuments.mockResolvedValue([
      { id: "d1", workspaceId: "ws-uuid" },
      { id: "d2", workspaceId: "other" },
    ] as never);

    await deleteWorkspace("team");

    // The route param is the *slug*, and `document.workspaceId` is always the
    // id — comparing them directly matched nothing and made this a silent
    // no-op that read as a purge.
    expect(mockPurge).toHaveBeenCalledWith(["d1"], { dropArchives: true });
  });

  it("accepts an id as readily as a slug", async () => {
    mockFetch.mockResolvedValue(okJson(WORKSPACE));
    mockDocuments.mockResolvedValue([
      { id: "d1", workspaceId: "ws-uuid" },
    ] as never);

    await deleteWorkspace("ws-uuid");

    expect(mockPurge).toHaveBeenCalledWith(["d1"], { dropArchives: true });
  });

  it("still deletes when the listing fails", async () => {
    // Local cleanup must never be able to fail the operation itself.
    mockFetch.mockResolvedValue(okJson({}));
    mockDocuments.mockRejectedValue(new Error("offline"));

    await expect(deleteWorkspace("team")).resolves.toBeUndefined();
    expect(mockPurge).toHaveBeenCalledWith([], { dropArchives: true });
  });

  it("purges nothing when the server refuses the delete", async () => {
    mockFetch.mockImplementation(async (_input: RequestInfo, init) =>
      init?.method === "DELETE"
        ? ({
            ok: false,
            status: 403,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ message: "nope" }),
          } as Response)
        : okJson(WORKSPACE),
    );
    mockDocuments.mockResolvedValue([
      { id: "d1", workspaceId: "ws-uuid" },
    ] as never);

    await expect(deleteWorkspace("team")).rejects.toThrow();
    expect(mockPurge).not.toHaveBeenCalled();
  });
});

describe("removeMember", () => {
  it("purges this device's copies when the member leaving is the one signed in", async () => {
    mockIsOfflineUser.mockReturnValue(true);
    mockFetch.mockImplementation(async (input: RequestInfo) =>
      String(input).endsWith("/workspaces/team")
        ? okJson(WORKSPACE)
        : okJson({}),
    );
    mockDocuments.mockResolvedValue([
      { id: "d1", workspaceId: "ws-uuid" },
    ] as never);

    await removeMember("team", 7);

    expect(mockIsOfflineUser).toHaveBeenCalledWith("7");
    // Archives too: recovery would otherwise hand back a whole document from a
    // workspace the user has just been removed from.
    expect(mockPurge).toHaveBeenCalledWith(["d1"], { dropArchives: true });
  });

  it("purges nothing when an owner removes somebody else", async () => {
    // The store is scoped to whoever is signed in on this machine, so purging
    // here would delete *this* user's copies of documents they still have every
    // right to read.
    mockIsOfflineUser.mockReturnValue(false);
    mockFetch.mockResolvedValue(okJson({}));
    mockDocuments.mockResolvedValue([
      { id: "d1", workspaceId: "ws-uuid" },
    ] as never);

    await removeMember("team", 9);

    expect(mockDocuments).not.toHaveBeenCalled();
    expect(mockPurge).toHaveBeenCalledWith([], { dropArchives: true });
  });
});
