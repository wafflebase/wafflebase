import { describe, expect, it } from "vitest";
import type { Element } from "@wafflebase/slides";
import { buildSectionInit } from "@wafflebase/board";
import { hiddenSectionContentIds } from "./hidden-content";

const frame = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rotation: 0 });
const rect = (id: string, x: number, y: number) =>
  ({ id, type: "shape", frame: frame(x, y, 100, 100), data: { kind: "rect" } }) as unknown as Element;
const section = (id: string, meta: { hidden?: boolean; locked?: boolean }) => {
  const el = { ...buildSectionInit(frame(0, 0, 1000, 1000), { title: "S" }), id } as Element;
  const data = (el as unknown as { data: { section: Record<string, unknown> } }).data;
  data.section = { ...data.section, ...meta };
  return el;
};

describe("hiddenSectionContentIds", () => {
  it("names what a hidden section covers, not the section or what is outside", () => {
    const els = [section("s", { hidden: true }), rect("in", 100, 100), rect("out", 2000, 0)];
    expect([...hiddenSectionContentIds(els)]).toEqual(["in"]);
  });

  it("names nothing for a visible or merely locked section", () => {
    expect(hiddenSectionContentIds([section("s", {}), rect("in", 100, 100)]).size).toBe(0);
    expect(hiddenSectionContentIds([section("s", { locked: true }), rect("in", 100, 100)]).size).toBe(0);
  });
});
