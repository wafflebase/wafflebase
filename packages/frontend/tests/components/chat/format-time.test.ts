import { describe, expect, it } from "vitest";
import { dayLabel, formatShortTime } from "@/components/chat/format-time";

describe("formatShortTime", () => {
  it("drops the AM/PM marker that wrapped the gutter onto two lines", () => {
    const iso = new Date(2026, 10, 21, 23, 22).toISOString();
    const short = formatShortTime(iso);
    expect(short).toMatch(/^\d{1,2}:22$/);
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 10, 25, 12, 0);
  const at = (y: number, m: number, d: number) =>
    new Date(y, m, d, 9, 0).toISOString();

  it("says Today and Yesterday", () => {
    expect(dayLabel(at(2026, 10, 25), now)).toBe("Today");
    expect(dayLabel(at(2026, 10, 24), now)).toBe("Yesterday");
  });

  it("is compact within this year and dated in full before it", () => {
    expect(dayLabel(at(2026, 10, 18), now)).toBe(
      new Date(2026, 10, 18).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    );
    const older = dayLabel(at(2025, 10, 18), now);
    expect(older).toContain("2025");
    expect(older).toBe(
      new Date(2025, 10, 18).toLocaleDateString([], {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    );
  });
});
