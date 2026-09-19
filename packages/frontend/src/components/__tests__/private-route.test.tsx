import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `PrivateRoute` is where the offline feature's housekeeping is mounted, and
 * nothing else mounts it.
 *
 * Every promise `OfflineRuntime` keeps happens when no editor is on screen —
 * logout's identity, the erase-on-disable watcher, the thirty-day sweep, the
 * reconcile against what the server still lists, the offer of work that could
 * not be saved — so a `PrivateRoute` that stops rendering it does not fail any
 * test that exists for those: it silently stops running them. Hence a test
 * about the mounting itself, and about the identity it is given.
 */

const offlineMounts: Array<{ userId: string }> = [];
vi.mock("@/components/offline-runtime", () => ({
  OfflineRuntime: ({ userId }: { userId: string }) => {
    offlineMounts.push({ userId });
    return <span data-testid="offline-runtime">{userId}</span>;
  },
}));

vi.mock("@yorkie-js/react", () => ({
  YorkieProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="yorkie-provider">{children}</div>
  ),
}));

const fetchMe = vi.fn();
vi.mock("../../api/auth", () => ({
  fetchMe: () => fetchMe(),
  fetchYorkieToken: vi.fn(),
}));

import { PrivateRoute } from "../../PrivateRoute";
import * as capabilities from "../../lib/yorkie-capabilities";
import { setOfflinePersistenceEnabled } from "../../lib/offline-persistence-preference";

function renderAt() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/documents"]}>
        <Routes>
          <Route element={<PrivateRoute />}>
            <Route path="/documents" element={<div>documents</div>} />
          </Route>
          <Route path="/login" element={<div>login</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  offlineMounts.length = 0;
  localStorage.clear();
  vi.clearAllMocks();
  // The build-time gate below. Every case but the two about the gate itself is
  // asking what happens once the feature is in play.
  vi.spyOn(capabilities, "supportsClientKey").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the authenticated shell", () => {
  it("mounts the offline housekeeping under the signed-in identity", async () => {
    fetchMe.mockResolvedValue({ id: 42, username: "ada" });

    renderAt();

    await waitFor(() =>
      expect(screen.getByTestId("offline-runtime")).toBeTruthy(),
    );
    // A string, because every store scope and lock name is built from it.
    expect(offlineMounts[0]).toEqual({ userId: "42" });
  });

  it("mounts it inside the Yorkie provider, alongside the route", async () => {
    fetchMe.mockResolvedValue({ id: 7, username: "ada" });

    renderAt();

    await waitFor(() => expect(screen.getByText("documents")).toBeTruthy());
    const provider = screen.getByTestId("yorkie-provider");
    expect(provider.contains(screen.getByTestId("offline-runtime"))).toBe(true);
  });

  it("mounts nothing for a visitor who is not signed in", async () => {
    // No identity means no scope to store or erase under, and this route sends
    // them to the login page instead.
    fetchMe.mockRejectedValue(new Error("401"));

    renderAt();

    await waitFor(() => expect(screen.getByText("login")).toBeTruthy());
    expect(offlineMounts).toEqual([]);
  });

  it("mounts nothing on a build where nobody can have the feature", async () => {
    // The design promises that declining the opt-in costs nothing, and this is
    // where that is kept or broken: the runtime's effect opens the IndexedDB
    // database and issues an unfiltered `GET /documents` of its own on every
    // signed-in session. Below `MinClientKeyVersion` no durable client can
    // mount, so there is nothing stored to sweep, reconcile or erase — and the
    // toggle that would have changed that is behind the same predicate.
    vi.spyOn(capabilities, "supportsClientKey").mockReturnValue(false);
    fetchMe.mockResolvedValue({ id: 42, username: "ada" });

    renderAt();

    await waitFor(() => expect(screen.getByText("documents")).toBeTruthy());
    expect(offlineMounts).toEqual([]);
  });

  it("still mounts it for a device that stored something under a capable build", async () => {
    // The one case the build-time gate alone would strand: a pin rolled back
    // after somebody opted in. The preference outlives the downgrade in
    // `localStorage`, so it is read beside the capability — otherwise the
    // erase, the sweep and the reconcile all stop running over content that is
    // still on the disk.
    vi.spyOn(capabilities, "supportsClientKey").mockReturnValue(false);
    setOfflinePersistenceEnabled("42", true);
    fetchMe.mockResolvedValue({ id: 42, username: "ada" });

    renderAt();

    await waitFor(() =>
      expect(screen.getByTestId("offline-runtime")).toBeTruthy(),
    );
  });
});
