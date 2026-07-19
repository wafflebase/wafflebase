import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rangeForPreset } from "./presets";

describe("rangeForPreset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends the window at today for every preset", () => {
    expect(rangeForPreset("7").to).toBe("2026-07-19");
    expect(rangeForPreset("all").to).toBe("2026-07-19");
  });

  it("subtracts the preset's day count for the from date", () => {
    expect(rangeForPreset("7").from).toBe("2026-07-12");
    expect(rangeForPreset("30").from).toBe("2026-06-19");
  });

  it("uses a fixed early floor for all-time (backend defaults missing from to 30d)", () => {
    expect(rangeForPreset("all").from).toBe("2020-01-01");
  });
});
