import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DATE_FORMAT,
  getDateFormat,
  setDateFormat,
  useDateFormat,
} from "@/lib/date-format-preference";

describe("date format preference", () => {
  beforeEach(() => {
    // A successful write clears the module's session-only mirror, so this
    // also resets the state a storage-failure test may have left behind —
    // without it those tests would leak into whatever runs next.
    setDateFormat(DEFAULT_DATE_FORMAT);
    localStorage.clear();
  });

  it("defaults to relative when nothing is stored", () => {
    expect(getDateFormat()).toBe("relative");
    expect(DEFAULT_DATE_FORMAT).toBe("relative");
  });

  it("round-trips a stored preference", () => {
    setDateFormat("exact");
    expect(getDateFormat()).toBe("exact");
    setDateFormat("relative");
    expect(getDateFormat()).toBe("relative");
  });

  it("falls back to the default on a junk stored value", () => {
    localStorage.setItem("wafflebase-date-format", "iso-8601-please");
    expect(getDateFormat()).toBe("relative");
  });

  it("notifies subscribers in the same tab", () => {
    let notified = 0;
    const handler = () => {
      notified += 1;
    };
    window.addEventListener("wafflebase-date-format-change", handler);
    setDateFormat("exact");
    window.removeEventListener("wafflebase-date-format-change", handler);
    expect(notified).toBe(1);
  });

  it("falls back to the default when storage throws on read", () => {
    setDateFormat(DEFAULT_DATE_FORMAT);
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    try {
      // Reading is the `useSyncExternalStore` snapshot, so this runs during
      // render — it must never throw.
      expect(getDateFormat()).toBe(DEFAULT_DATE_FORMAT);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the preference for the session when storage is unwritable", () => {
    const setSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    const getSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    try {
      expect(() => setDateFormat("exact")).not.toThrow();
      expect(getDateFormat()).toBe("exact");
    } finally {
      setSpy.mockRestore();
      getSpy.mockRestore();
    }
  });

  it("keeps the preference when only the write fails", () => {
    // QuotaExceededError (full storage, iOS Safari) throws from `setItem`
    // while `getItem` keeps returning the previously stored value. Reading
    // storage first would silently revert the user's choice.
    setDateFormat("relative");
    const setSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    try {
      setDateFormat("exact");
      expect(localStorage.getItem("wafflebase-date-format")).toBe("relative");
      expect(getDateFormat()).toBe("exact");
    } finally {
      setSpy.mockRestore();
    }
  });

  it("lets storage win again once a write succeeds", () => {
    const setSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    setDateFormat("exact");
    setSpy.mockRestore();

    setDateFormat("relative");
    localStorage.clear();
    // The stale mirror must not outvote a key another tab has cleared.
    expect(getDateFormat()).toBe(DEFAULT_DATE_FORMAT);
  });
});

describe("useDateFormat", () => {
  beforeEach(() => {
    setDateFormat(DEFAULT_DATE_FORMAT);
    localStorage.clear();
  });

  it("reads the already-stored preference on mount", () => {
    localStorage.setItem("wafflebase-date-format", "exact");
    const { result } = renderHook(() => useDateFormat());
    expect(result.current).toBe("exact");
  });

  it("re-renders when another component in the tab changes it", () => {
    // The whole point of the subscription: the Settings `Select` and the
    // documents list are separate route trees, so a no-op `subscribe` would
    // leave the list showing the old format until a remount.
    const { result } = renderHook(() => useDateFormat());
    expect(result.current).toBe("relative");

    act(() => setDateFormat("exact"));

    expect(result.current).toBe("exact");
  });

  it("re-renders when another tab changes it", () => {
    const { result } = renderHook(() => useDateFormat());
    expect(result.current).toBe("relative");

    // `storage` is what a *different* tab's write delivers here; the write
    // itself already happened over there, so only the key changes locally.
    act(() => {
      localStorage.setItem("wafflebase-date-format", "exact");
      window.dispatchEvent(
        new StorageEvent("storage", { key: "wafflebase-date-format" }),
      );
    });

    expect(result.current).toBe("exact");
  });

  it("keeps the session-only value when storage is unwritable", () => {
    const setSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    try {
      const { result } = renderHook(() => useDateFormat());

      act(() => setDateFormat("exact"));

      // Rendered from the in-memory mirror — nothing was persisted.
      expect(result.current).toBe("exact");
    } finally {
      setSpy.mockRestore();
    }
  });

  it("unsubscribes both listeners on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      const { unmount } = renderHook(() => useDateFormat());
      const subscribed = addSpy.mock.calls.filter(
        ([type]) =>
          type === "wafflebase-date-format-change" || type === "storage",
      );
      expect(subscribed.map(([type]) => type).sort()).toEqual([
        "storage",
        "wafflebase-date-format-change",
      ]);

      unmount();

      // Every listener the subscription added is handed back with the *same*
      // handler reference, so nothing accumulates across mounts.
      for (const [type, handler] of subscribed) {
        expect(removeSpy).toHaveBeenCalledWith(type, handler);
      }
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
