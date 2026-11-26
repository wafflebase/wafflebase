/**
 * The login page sends a visitor who is already signed in on to the app.
 * The desktop shell opens `/login` at launch, so without this a signed-in
 * user would face a sign-in form every time the app starts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/api/auth", () => ({
  fetchMeOptional: vi.fn(),
  fetchAuthProviders: vi.fn(async () => ({ github: true, google: false })),
}));
vi.mock("@/lib/brand-fonts", () => ({ useBrandFonts: () => {} }));

import { fetchMeOptional } from "@/api/auth";
import LoginPage from "@/app/login/page";

function renderAt(url: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>app home</p>} />
          <Route path="/t/:id" element={<p>template page</p>} />
          <Route path="*" element={<p>unmatched route</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const USER = { id: 1, username: "u", email: "u@example.com", photo: "" };

describe("LoginPage", () => {
  beforeEach(() => vi.mocked(fetchMeOptional).mockReset());

  it("shows the sign-in form to a signed-out visitor", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue(null);
    renderAt("/login");
    expect((await screen.findAllByText(/GitHub/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText("app home")).toBeNull();
  });

  it("sends a signed-in visitor to the app", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue(USER as never);
    renderAt("/login");
    expect(await screen.findByText("app home")).toBeTruthy();
  });

  it("honours a same-site returnTo for a signed-in visitor", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue(USER as never);
    renderAt("/login?returnTo=%2Ft%2Fabc");
    expect(await screen.findByText("template page")).toBeTruthy();
  });

  it("ignores a returnTo that would leave the site", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue(USER as never);
    renderAt("/login?returnTo=%2F%2Fevil.example%2Fx");
    expect(await screen.findByText("app home")).toBeTruthy();
  });

  // The docs are a separate site (VitePress under /docs), not a route of this
  // app. A client-side <Link> rendered nothing at /docs — a blank page on the
  // web, and one the desktop shell never saw, so it could not send it to the
  // system browser. It has to be a real page navigation.
  it("links Docs as a page navigation, not an app route", async () => {
    vi.mocked(fetchMeOptional).mockResolvedValue(null);
    renderAt("/login");
    const docs = await screen.findByRole("link", { name: "Docs" });
    expect(docs.getAttribute("href")).toBe("/docs/");
    fireEvent.click(docs);
    expect(screen.queryByText("unmatched route")).toBeNull();
  });
});
