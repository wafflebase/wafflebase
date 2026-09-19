/**
 * The user menu, and the settings it is now the way into.
 *
 * The app has two Settings: the workspace's (name, members, API keys) and this
 * device's (appearance, dates, offline saving). Both used to hang off the one
 * sidebar entry in `use-workspace-nav-items`, whose target flips on whether a
 * workspace slug has resolved — so for a signed-in user, who always has one,
 * the device settings had no route into them at all. The offline toggle the
 * whole persistence feature is opted into through was reachable only by typing
 * the URL.
 *
 * It lives here rather than on a route because `NavUser` is rendered by every
 * editor shell as well as `Layout`, so a dialog hung off it opens over the
 * document instead of navigating away from one — and navigating away from a
 * document with unsent edits is what the navigation guard exists to stop.
 *
 * Radix DropdownMenu does not open on a synthetic `.click()` in jsdom; it needs
 * the full pointerdown -> pointerup -> click sequence, as
 * `tests/app/docs/docs-export-button.test.tsx` documents.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const supportsClientKey = vi.fn(() => true);
vi.mock("@/lib/yorkie-capabilities", () => ({
  supportsClientKey: () => supportsClientKey(),
}));

const logout = vi.fn(async () => {});
vi.mock("@/api/auth", () => ({ logout: () => logout() }));

vi.mock("@/components/theme-provider", async () => {
  const react = await import("react");
  const ctx = react.createContext({ theme: "light", setTheme: () => {} });
  return {
    ThemeProviderContext: ctx,
    useTheme: () => ({ resolvedTheme: "light", setTheme: () => {} }),
  };
});

import { NavUser } from "@/components/nav-user";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  getOfflinePersistenceEnabled,
  setOfflinePersistenceEnabled,
} from "@/lib/offline-persistence-preference";

const USER = {
  id: 1,
  username: "hackerwins",
  email: "susukang98@gmail.com",
  photo: "",
} as unknown as Parameters<typeof NavUser>[0]["user"];

function renderMenu() {
  return render(
    <SidebarProvider>
      <NavUser user={USER} />
    </SidebarProvider>,
  );
}

function openMenu() {
  const trigger = screen.getByText("hackerwins");
  for (const type of ["pointerdown", "pointerup", "click"]) {
    fireEvent(
      trigger,
      new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }),
    );
  }
}

beforeEach(() => {
  // `SidebarProvider` reads `useIsMobile`, which jsdom has no `matchMedia` for.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  localStorage.clear();
  supportsClientKey.mockReturnValue(true);
  logout.mockClear();
});

afterEach(() => {
  setOfflinePersistenceEnabled(false);
  localStorage.clear();
});

describe("NavUser", () => {
  it("offers the device settings from the user menu", async () => {
    renderMenu();

    openMenu();

    expect(await screen.findByText("Settings")).toBeTruthy();
  });

  it("opens them as a dialog rather than navigating", async () => {
    // The property that makes this the right surface: no route change, so an
    // editor holding unsent edits is still mounted underneath.
    renderMenu();
    openMenu();

    fireEvent.click(await screen.findByText("Settings"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Save documents on this device");
  });

  it("drives the real preference from inside the dialog", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(await screen.findByText("Settings"));
    await screen.findByRole("dialog");
    expect(getOfflinePersistenceEnabled()).toBe(false);

    fireEvent.click(screen.getByLabelText("Save documents on this device"));

    await waitFor(() => expect(getOfflinePersistenceEnabled()).toBe(true));
  });

  it("hides the offline section on a build that cannot persist", async () => {
    // Same gate the page has always had: a switch promising storage this build
    // cannot perform is not a dark launch, it is a control that lies.
    supportsClientKey.mockReturnValue(false);
    renderMenu();
    openMenu();

    fireEvent.click(await screen.findByText("Settings"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toContain("Save documents on this device");
    expect(dialog.textContent).toContain("Dark mode");
  });

  it("still logs out", async () => {
    renderMenu();
    openMenu();

    fireEvent.click(await screen.findByText("Log out"));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });
});
