import { beforeEach, describe, expect, it } from "vitest";

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
});
