import { describe, it, expect } from "vitest";
import { formatDwell, returningRate } from "./format";

describe("formatDwell", () => {
  it("shows bare seconds under a minute", () => {
    expect(formatDwell(0)).toBe("0s");
    expect(formatDwell(43)).toBe("43s");
  });

  it("zero-pads the seconds once minutes appear", () => {
    expect(formatDwell(123)).toBe("2m 03s");
    expect(formatDwell(600)).toBe("10m 00s");
  });

  it("clamps negative / non-finite input to 0s", () => {
    expect(formatDwell(-5)).toBe("0s");
    expect(formatDwell(NaN)).toBe("0s");
    expect(formatDwell(Infinity)).toBe("0s");
  });
});

describe("returningRate", () => {
  it("returns a rounded percentage of unique visitors", () => {
    expect(returningRate(2, 5)).toBe("40%");
    expect(returningRate(1, 3)).toBe("33%");
  });

  it("guards a zero denominator", () => {
    expect(returningRate(0, 0)).toBe("0%");
    expect(returningRate(3, 0)).toBe("0%");
  });
});
