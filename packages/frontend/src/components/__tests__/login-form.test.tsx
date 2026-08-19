import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { LoginForm } from "@/components/login-form";
import LoginPage from "@/app/login/page";

/**
 * The refusal half of the OAuth `state` check. `GET /auth/github/callback`
 * returns the browser to `/login?error=oauth_state` instead of throwing a
 * 400, and that redirect is only useful if the page actually says
 * something — an untested message can silently become the button looking
 * untouched after a failed sign-in.
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
    // No @testing-library/jest-dom in this repo — getByText throws on no
    // match, so this is the same assertion strength as toBeInTheDocument().
    expect(screen.getByText("Continue with GitHub")).toBeTruthy();
  });

  it("explains the oauth_state refusal and keeps the retry available", () => {
    renderForm("oauth_state");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("expired");
    expect(alert.textContent).toContain("another tab");
    expect(screen.getByText("Continue with GitHub")).toBeTruthy();
  });

  it("falls back to a generic message for an unknown code", () => {
    renderForm("something_new");
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be completed",
    );
  });

  /**
   * `error` is raw query-string input. A bare `LOGIN_ERRORS[error]` would
   * resolve `constructor` off the prototype chain and hand React a
   * function to render.
   */
  it("does not read messages off the prototype chain", () => {
    renderForm("constructor");
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be completed",
    );
  });
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
