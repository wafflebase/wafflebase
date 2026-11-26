import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PublicRoute } from "../../src/PublicRoute";
import { fetchMe, isBackendUnreachableError } from "../../src/api/auth";

/**
 * A session check that gets no response at all used to read as "signed
 * out". With the offline app shell it is also what every launch with no
 * network looks like, so it has to say "offline" instead.
 */

function renderLogin() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route element={<PublicRoute />}>
            <Route path="/login" element={<p>sign-in form</p>} />
          </Route>
          <Route path="/" element={<p>workspace</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("session check without a network", () => {
  test("fetchMe reports an unreachable server, not a failed sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const error = await fetchMe().catch((e: unknown) => e);
    expect(isBackendUnreachableError(error)).toBe(true);
  });

  test("the sign-in route shows the offline screen and recovers on retry", async () => {
    let online = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!online) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ id: 1, username: "u" }), {
          status: 200,
        });
      }),
    );
    renderLogin();

    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.queryByText("sign-in form")).toBeNull();

    online = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("workspace")).toBeTruthy();
  });

  test("the browser's online event retries on its own", async () => {
    let online = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!online) throw new TypeError("Failed to fetch");
        return new Response(null, { status: 401 });
      }),
    );
    renderLogin();
    expect(await screen.findByText("You're offline")).toBeTruthy();

    online = true;
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByText("sign-in form")).toBeTruthy();
  });

  test("a server that answers 'signed out' still gets the sign-in form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    renderLogin();
    expect(await screen.findByText("sign-in form")).toBeTruthy();
  });
});
