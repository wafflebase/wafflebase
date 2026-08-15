import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LoginForm } from "@/components/login-form";

/**
 * The banner is the only thing a refused OAuth callback leaves a person to
 * act on: the backend answers a failed `state` check with a redirect to
 * `/login?error=login_state` rather than a JSON 401, so if this stops
 * rendering the login simply loops with no explanation.
 */
function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <LoginForm />
    </MemoryRouter>,
  );
}

describe("LoginForm", () => {
  it("shows nothing when the login was not refused", () => {
    renderAt("");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("link", { name: /continue with github/i }),
    ).toBeTruthy();
  });

  it("explains a refused `state` check and what to do about it", () => {
    renderAt("?error=login_state");

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("expired");
    expect(alert.textContent).toContain("try again");
    // The retry path has to survive the error, or the message is advice the
    // page cannot take.
    expect(
      screen.getByRole("link", { name: /continue with github/i }),
    ).toBeTruthy();
  });

  it("falls back to a generic message for an unknown error code", () => {
    renderAt("?error=something_new");

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Sign-in did not complete. Please try again.");
    // Never echo the raw code back into the page.
    expect(alert.textContent).not.toContain("something_new");
  });
});
