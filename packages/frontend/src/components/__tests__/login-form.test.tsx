import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { LoginForm } from "@/components/login-form";
import LoginPage from "@/app/login/page";

/**
 * The refusal half of the OAuth `state` check, and the only thing it leaves a
 * person to act on. `GET /auth/github/callback` returns the browser to
 * `/login?error=…` instead of throwing a 400, and that redirect is only useful
 * if the page actually says something — an untested message can silently
 * become the button looking untouched after a failed sign-in.
 */
function renderForm(error?: string | null, googleEnabled = false) {
  render(
    <MemoryRouter>
      <LoginForm error={error} googleEnabled={googleEnabled} />
    </MemoryRouter>,
  );
}

describe("LoginForm", () => {
  it("shows no alert when there is no error", () => {
    renderForm(null);
    expect(screen.queryByRole("alert")).toBeNull();
    // getByText throws on no match, so this is the same assertion strength
    // as toBeInTheDocument().
    expect(screen.getByText("Continue with GitHub")).toBeTruthy();
  });

  // Both spellings of the same refusal have been in the callback's
  // vocabulary, so both have to reach a real message rather than the
  // fallback.
  it.each(["oauth_state", "login_state"])(
    "explains the %s refusal and keeps the retry available",
    (code) => {
      renderForm(code);
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("expired");
      expect(alert.textContent).toContain("another tab");
      expect(alert.textContent).toContain("try again");
      // The retry path has to survive the error, or the message is advice
      // the page cannot take.
      expect(
        screen.getByRole("link", { name: /continue with github/i }),
      ).toBeTruthy();
    },
  );

  /**
   * Google OAuth is optional and configured per deployment, so the button
   * follows `GET /auth/providers`. A button that is always there would lead
   * every self-hosted install to a 404, and one that is never there would
   * hide the feature on the installs that configured it.
   */
  it("offers no Google button by default", () => {
    renderForm(null);
    expect(screen.queryByRole("link", { name: /continue with google/i })).toBeNull();
  });

  it("offers Google alongside GitHub when the deployment has it", () => {
    renderForm(null, true);
    const google = screen.getByRole("link", { name: /continue with google/i });
    expect(google.getAttribute("href")).toContain("/auth/google");
    expect(
      screen.getByRole("link", { name: /continue with github/i }),
    ).toBeTruthy();
  });

  // `returnTo` is what carries a template link through the sign-in; it has
  // to survive whichever provider the visitor picks.
  it("forwards returnTo on both providers", () => {
    render(
      <MemoryRouter>
        <LoginForm returnTo="/t/abc" googleEnabled />
      </MemoryRouter>,
    );
    for (const name of [/continue with github/i, /continue with google/i]) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toContain(
        "returnTo=%2Ft%2Fabc",
      );
    }
  });

  it("falls back to a generic message for an unknown code", () => {
    renderForm("something_new");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("could not be completed");
    // Never echo the raw code back into the page.
    expect(alert.textContent).not.toContain("something_new");
  });

  // `error` is whatever the URL says, so a lookup that walks the prototype
  // chain has answers for codes nobody defined: `toString` and friends give a
  // function, which React renders as nothing, and `__proto__` gives an object,
  // which React refuses to render at all — taking the login page down with it.
  // Enumerated rather than sampled, because the two failure modes differ.
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"])(
    "does not read the message for %s off the prototype chain",
    (name) => {
      renderForm(name);
      expect(screen.getByRole("alert").textContent).toContain(
        "could not be completed",
      );
      expect(
        screen.getByRole("link", { name: /continue with github/i }),
      ).toBeTruthy();
    },
  );
});

describe("LoginPage", () => {
  // The page asks the backend which providers exist. Stubbed so the test
  // does not depend on a network call — `fetchAuthProviders` swallows a
  // failure into "GitHub only", which would hide a regression here.
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ github: true, google: false }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wires ?error= from the URL into the form", () => {
    render(
      <MemoryRouter initialEntries={["/login?error=oauth_state"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert").textContent).toContain("expired");
  });

  it("renders no alert on a plain visit", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
