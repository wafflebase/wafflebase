import { describe, expect, it } from "vitest";
import { formatShortTime } from "@/components/chat/format-time";

describe("formatShortTime", () => {
  it("drops the AM/PM marker that wrapped the gutter onto two lines", () => {
    const iso = new Date(2026, 10, 21, 23, 22).toISOString();
    const short = formatShortTime(iso);
    expect(short).toMatch(/^\d{1,2}:22$/);
  });
});
