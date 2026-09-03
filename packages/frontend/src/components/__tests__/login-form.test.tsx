import { describe, it, expect } from "vitest";
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
function renderForm(error?: string | null) {
  render(
    <MemoryRouter>
      <LoginForm error={error} />
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
