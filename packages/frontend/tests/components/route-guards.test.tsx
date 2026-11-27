import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../src/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/auth")>()),
  fetchMe: vi.fn(),
  fetchMeOptional: vi.fn(),
  fetchYorkieToken: vi.fn(),
}));
vi.mock("@yorkie-js/react", () => ({
  YorkieProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../src/components/chat/chat-stream-host", () => ({
  ChatStreamHost: () => null,
}));

import {
  BackendUnreachableError,
  fetchMe,
  fetchMeOptional,
  type User,
} from "../../src/api/auth";
import { PrivateRoute } from "../../src/PrivateRoute";
import { PublicRoute } from "../../src/PublicRoute";

/**
 * The route guards around `/login` (public) and the app (private): where a
 * signed-in visitor of `/login` goes, and when a failed session check may
 * replace the page with the offline screen.
 */

const USER = { id: 1, username: "u", email: "u@example.com", photo: "" } as User;

function renderAt(url: string, client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route element={<PublicRoute />}>
            <Route path="/login" element={<p>sign-in form</p>} />
          </Route>
          <Route element={<PrivateRoute />}>
            <Route path="/w/:id" element={<p>open document</p>} />
          </Route>
          <Route path="/" element={<p>app home</p>} />
          <Route path="/t/:id" element={<p>template page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(fetchMe).mockReset();
  vi.mocked(fetchMeOptional).mockReset();
});

describe("PublicRoute on /login", () => {
  test("shows the sign-in form to a signed-out visitor", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue(null);
    renderAt("/login");
    expect(await screen.findByText("sign-in form")).toBeTruthy();
  });

  test("sends a signed-in visitor to the app", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue(USER);
    renderAt("/login");
    expect(await screen.findByText("app home")).toBeTruthy();
  });

  // `/login?returnTo=` is how a template link survives sign-in; a visitor
  // who is already signed in should land there too, not on `/`.
  test("honours a same-site returnTo for a signed-in visitor", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue(USER);
    renderAt("/login?returnTo=%2Ft%2Fabc");
    expect(await screen.findByText("template page")).toBeTruthy();
  });

  test("ignores a returnTo that would leave the site", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue(USER);
    renderAt("/login?returnTo=%2F%2Fevil.example%2Fx");
    expect(await screen.findByText("app home")).toBeTruthy();
  });
});

describe("PrivateRoute when a later session check fails", () => {
  // A refetch on window focus during an outage keeps the user React Query
  // already has; the open document must stay mounted, not be swapped for the
  // offline screen (the editor reports its own connection state).
  test("keeps the open document when it already knows the user", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(fetchMe).mockResolvedValueOnce(USER);
    renderAt("/w/1", client);
    expect(await screen.findByText("open document")).toBeTruthy();

    vi.mocked(fetchMe).mockRejectedValueOnce(new BackendUnreachableError());
    await client.refetchQueries({ queryKey: ["me"] }).catch(() => {});
    await waitFor(() =>
      expect(client.getQueryState(["me"])?.status).toBe("error"),
    );
    // One more render after the state change, so a guard that reacts to it
    // has had the chance.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("open document")).toBeTruthy();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  test("shows the offline screen when it never knew the user", async () => {
    vi.mocked(fetchMe).mockRejectedValue(new BackendUnreachableError());
    renderAt("/w/1");
    expect(await screen.findByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.queryByText("open document")).toBeNull();
  });
});
