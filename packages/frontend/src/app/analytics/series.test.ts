import { describe, it, expect } from "vitest";
import { densifyDaily } from "./series";

describe("densifyDaily", () => {
  it("returns sparse input unchanged when under two points", () => {
    expect(densifyDaily([])).toEqual([]);
    expect(densifyDaily([{ date: "2026-07-01", value: 3 }])).toEqual([
      { date: "2026-07-01", value: 3 },
    ]);
  });

  it("fills the gap between two distant days with zeros", () => {
    const out = densifyDaily([
      { date: "2026-07-01", value: 4 },
      { date: "2026-07-04", value: 2 },
    ]);
    expect(out).toEqual([
      { date: "2026-07-01", value: 4 },
      { date: "2026-07-02", value: 0 },
      { date: "2026-07-03", value: 0 },
      { date: "2026-07-04", value: 2 },
    ]);
  });

  it("sorts before densifying so out-of-order input is handled", () => {
    const out = densifyDaily([
      { date: "2026-07-03", value: 1 },
      { date: "2026-07-01", value: 5 },
    ]);
    expect(out.map((p) => p.date)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
    expect(out[1].value).toBe(0);
  });
});
