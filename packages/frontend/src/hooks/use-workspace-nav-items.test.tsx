/**
 * The workspace sidebar navigation list.
 *
 * Templates and Analytics were once built inline in `app/Layout.tsx` and
 * copied into every editor shell, so adding an entry to one left the others
 * behind. These tests pin the list's shape; `nav-items-single-source.test.ts`
 * pins that this hook is the only place it is built.
 *
 * Every test settles the analytics query before asserting. Reading the list
 * straight after `renderHook` would read the `= false` default instead of the
 * mocked answer, so a test written that way passes no matter which value the
 * mock resolves — it would not be testing the gate at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/api/workspaces", () => ({ fetchAnalyticsEnabled: vi.fn() }));

import { fetchAnalyticsEnabled } from "@/api/workspaces";
import { useWorkspaceNavItems } from "./use-workspace-nav-items";

const ANALYTICS_KEY = ["analytics", "enabled"];

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  /** Resolves once the hook has seen the mocked answer, not the default. */
  const settled = (expected: boolean) =>
    waitFor(() =>
      expect(client.getQueryData(ANALYTICS_KEY)).toBe(expected),
    );
  return { wrapper, settled };
}

const titles = (items: { main: Array<{ title: string }> }) =>
  items.main.map((i) => i.title);

describe("useWorkspaceNavItems", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes every entry to the workspace and includes Templates", async () => {
    vi.mocked(fetchAnalyticsEnabled).mockResolvedValue(false);
    const { wrapper, settled } = makeWrapper();

    const { result } = renderHook(() => useWorkspaceNavItems("acme"), {
      wrapper,
    });
    await settled(false);

    expect(titles(result.current)).toEqual([
      "Documents",
      "Templates",
      "Data Sources",
      "Settings",
    ]);
    expect(result.current.main.map((i) => i.url)).toEqual([
      "/w/acme",
      "/w/acme/templates",
      "/w/acme/datasources",
      "/w/acme/settings",
    ]);
  });

  it("adds Analytics once the deployment reports a warehouse", async () => {
    vi.mocked(fetchAnalyticsEnabled).mockResolvedValue(true);
    const { wrapper, settled } = makeWrapper();

    const { result } = renderHook(() => useWorkspaceNavItems("acme"), {
      wrapper,
    });
    // Absent until the answer arrives — the hook defaults to hiding it.
    expect(titles(result.current)).not.toContain("Analytics");
    await settled(true);

    expect(titles(result.current)).toEqual([
      "Documents",
      "Templates",
      "Data Sources",
      "Analytics",
      "Settings",
    ]);
    expect(result.current.main.find((i) => i.title === "Analytics")?.url).toBe(
      "/w/acme/analytics",
    );
  });

  it("falls back to the workspace-less routes before a slug resolves", async () => {
    // Enabled on purpose: the fallback must stay three entries even when the
    // warehouse exists, because `/templates` and `/analytics` are routed only
    // under `/w/:workspaceId`.
    vi.mocked(fetchAnalyticsEnabled).mockResolvedValue(true);
    const { wrapper, settled } = makeWrapper();

    const { result } = renderHook(() => useWorkspaceNavItems(undefined), {
      wrapper,
    });
    await settled(true);

    expect(result.current.main.map((i) => i.url)).toEqual([
      "/documents",
      "/datasources",
      "/settings",
    ]);
  });
});
