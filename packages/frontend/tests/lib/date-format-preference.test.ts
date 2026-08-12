import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DATE_FORMAT,
  getDateFormat,
  setDateFormat,
} from "@/lib/date-format-preference";

describe("date format preference", () => {
  beforeEach(() => {
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
    setDateFormat(DEFAULT_DATE_FORMAT);
  });
});
