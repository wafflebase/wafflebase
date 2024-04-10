import { Sheet } from "../../src/model/sheet";
import { describe, it, expect } from "vitest";

describe("Sheet", () => {
  it("should correctly calculate sum of numbers", () => {
    const sheet = new Sheet(1);
    sheet.setData(1, 1, 10);
    sheet.setData(1, 2, 20);
    sheet.setData(1, 3, 30);
    expect(sheet.calculateSum("A1:C1")).toBe(60);
  });
});
