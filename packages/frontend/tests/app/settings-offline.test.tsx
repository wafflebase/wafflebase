import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The Settings offline section is the feature's primary entry point, and it is
 * gated on a build-time capability. Both halves need a test for the same
 * reason: a control that promises "turning this off deletes them" on a build
 * that can store nothing is not a dark launch, it is a control that lies.
 */

const supportsClientKey = vi.fn(() => true);
vi.mock("@/lib/yorkie-capabilities", () => ({
  supportsClientKey: () => supportsClientKey(),
}));

vi.mock("@/components/theme-provider", async () => {
  const react = await import("react");
  return {
    ThemeProviderContext: react.createContext({
      theme: "light",
      setTheme: () => {},
    }),
  };
});

import Settings from "../../src/app/settings/page";
import {
  getOfflinePersistenceEnabled,
  setOfflinePersistenceEnabled,
} from "../../src/lib/offline-persistence-preference";

/**
 * Whoever is signed in. Offline saving is consented to per account on this
 * device, so the switch reads and writes an identity rather than the machine.
 */
const USER = "7";

/**
 * Settings reads the signed-in account from the cache the authenticated shell
 * filled, so every case renders under a seeded client. Seeded rather than
 * fetched: nothing here is testing the request.
 */
function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["me"], { id: Number(USER), username: "ada" });
  return rtlRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  supportsClientKey.mockReturnValue(true);
});

afterEach(() => {
  setOfflinePersistenceEnabled(USER, false);
  localStorage.clear();
});

describe("the offline setting", () => {
  it("is offered on a build that can honour it", () => {
    render(<Settings />);

    expect(screen.getByText("Offline")).toBeTruthy();
    const toggle = screen.getByLabelText("Save documents on this device");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("is absent on a build that cannot carry a client key", () => {
    // Without one the store fills with entries no reload can use, so a switch
    // here would promise storage — and an erasure of it — that cannot happen.
    supportsClientKey.mockReturnValue(false);

    render(<Settings />);

    expect(screen.queryByText("Offline")).toBeNull();
    expect(screen.queryByLabelText("Save documents on this device")).toBeNull();
  });

  it("writes the per-device preference when it is switched on", async () => {
    render(<Settings />);

    fireEvent.click(screen.getByLabelText("Save documents on this device"));

    await waitFor(() => expect(getOfflinePersistenceEnabled(USER)).toBe(true));
    expect(
      screen
        .getByLabelText("Save documents on this device")
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("reflects a preference another surface already set", () => {
    // The chip offers the same switch from inside an editor, so Settings must
    // not be the only writer nor show a stale answer.
    setOfflinePersistenceEnabled(USER, true);

    render(<Settings />);

    expect(
      screen
        .getByLabelText("Save documents on this device")
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("says that it is per device and that turning it off deletes", () => {
    // The copy is load-bearing: an account-level reading of this setting would
    // follow the user onto a shared machine, which is the case it exists to
    // prevent, and the erase is a promise another module has to keep.
    render(<Settings />);

    const copy = screen.getByText(/Applies to this device and this account only/);
    expect(copy.textContent).toContain("turning it off deletes what was stored");
  });
});
