import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from "@wafflebase/slides";
import {
  THEME_ROLES,
  applyShapeFill,
  colorTransparencyPercent,
  isRoleSelected,
  makeRoleColor,
  makeSrgbColor,
  readShapeFill,
  withAlpha,
} from "@/app/slides/themed-color-picker-helpers.ts";

/**
 * The themed color picker UI is a `.tsx` React component. Its
 * behavioural surface — role-list shape, role-vs-srgb selection
 * detection, ThemeColor builders, and the store-write helper — is
 * extracted into `themed-color-picker-helpers.ts` and tested here
 * without rendering React.
 */

describe("themed-color-picker helpers", () => {
  it("THEME_ROLES has all 12 ColorScheme slots in OOXML order", () => {
    // Order matches the OOXML mapping the migration / picker UI relies on:
    // dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink.
    expect([...THEME_ROLES]).toEqual([
      "text",
      "background",
      "textSecondary",
      "backgroundAlt",
      "accent1",
      "accent2",
      "accent3",
      "accent4",
      "accent5",
      "accent6",
      "hyperlink",
      "visitedHyperlink",
    ]);
  });

  it("isRoleSelected returns true only when value is a role match", () => {
    expect(isRoleSelected({ kind: "role", role: "accent1" }, "accent1")).toBeTruthy();
    expect(!isRoleSelected({ kind: "role", role: "accent1" }, "accent2")).toBeTruthy();
    // srgb values never match a role swatch — they're concrete colors,
    // so no theme-role marker should appear in the picker.
    expect(!isRoleSelected({ kind: "srgb", value: "#abcdef" }, "accent1")).toBeTruthy();
    expect(!isRoleSelected(undefined, "accent1")).toBeTruthy();
  });

  it("makeRoleColor produces a role ThemeColor", () => {
    expect(makeRoleColor("accent1")).toEqual({
      kind: "role",
      role: "accent1",
    });
  });

  it("makeSrgbColor produces an srgb ThemeColor", () => {
    expect(makeSrgbColor("#abcdef")).toEqual({
      kind: "srgb",
      value: "#abcdef",
    });
  });

  it("applyShapeFill writes data.fill in a single batch", () => {
    const store = new MemSlidesStore();
    let slideId!: string;
    let elementId!: string;
    store.batch(() => {
      slideId = store.addSlide("blank");
      elementId = store.addElement(slideId, {
        type: "shape",
        frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
        data: { kind: "rect" },
      });
    });

    const before = store.read();
    const shape = before.slides[0].elements.find((e) => e.id === elementId)!;
    expect(shape.type).toBe("shape");

    applyShapeFill(store, slideId, shape, makeRoleColor("accent3"));

    const after = store.read();
    const updated = after.slides[0].elements.find((e) => e.id === elementId)!;
    expect(updated.type).toBe("shape");
    if (updated.type === "shape") {
      expect(updated.data.fill).toEqual({ kind: "role", role: "accent3" });
    }

    // Single undo should revert the fill — proving applyShapeFill
    // batched its updateElementData write.
    expect(store.canUndo()).toBeTruthy();
    store.undo();
    const reverted = store.read();
    const revShape = reverted.slides[0].elements.find(
      (e) => e.id === elementId,
    )!;
    if (revShape.type === "shape") {
      expect(revShape.data.fill).toBe(undefined);
    }
  });

  it("applyShapeFill is a no-op when the element is not a shape", () => {
    const store = new MemSlidesStore();
    let slideId!: string;
    let elementId!: string;
    store.batch(() => {
      slideId = store.addSlide("blank");
      elementId = store.addElement(slideId, {
        type: "text",
        frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
        data: { blocks: [] },
      });
    });
    const text = store
      .read()
      .slides[0].elements.find((e) => e.id === elementId)!;
    // Should not throw and should not produce a new undo entry.
    const canUndoBefore = store.canUndo();
    applyShapeFill(store, slideId, text, makeSrgbColor("#ff0000"));
    // canUndo state is unchanged — no new batch was committed.
    expect(store.canUndo()).toBe(canUndoBefore);
  });

  it("colorTransparencyPercent maps alpha to a 0–100 transparency value", () => {
    // No alpha field ⇒ fully opaque ⇒ 0% transparent.
    expect(colorTransparencyPercent({ kind: "srgb", value: "#fff" })).toBe(0);
    expect(colorTransparencyPercent(undefined)).toBe(0);
    // alpha 1 ⇒ 0%, alpha 0 ⇒ 100%, alpha 0.4 ⇒ 60%.
    expect(colorTransparencyPercent({ kind: "srgb", value: "#fff", alpha: 1 })).toBe(0);
    expect(colorTransparencyPercent({ kind: "srgb", value: "#fff", alpha: 0 })).toBe(100);
    expect(colorTransparencyPercent({ kind: "role", role: "accent1", alpha: 0.4 })).toBe(60);
  });

  it("withAlpha sets alpha, clamps, and drops the field when opaque", () => {
    // Sets alpha on srgb and role colors, preserving the other fields.
    expect(withAlpha({ kind: "srgb", value: "#abcdef" }, 0.5)).toEqual({
      kind: "srgb",
      value: "#abcdef",
      alpha: 0.5,
    });
    expect(withAlpha({ kind: "role", role: "accent2", shade: 0.2 }, 0.25)).toEqual({
      kind: "role",
      role: "accent2",
      shade: 0.2,
      alpha: 0.25,
    });
    // alpha ≥ 1 drops the field so opaque colors take resolveColor's fast path.
    expect(withAlpha({ kind: "srgb", value: "#abcdef", alpha: 0.3 }, 1)).toEqual({
      kind: "srgb",
      value: "#abcdef",
    });
    // Out-of-range inputs clamp into [0, 1].
    expect(withAlpha({ kind: "srgb", value: "#000" }, -0.5)).toEqual({
      kind: "srgb",
      value: "#000",
      alpha: 0,
    });
    expect(withAlpha({ kind: "srgb", value: "#000" }, 2)).toEqual({
      kind: "srgb",
      value: "#000",
    });
  });

  it("readShapeFill returns the shape's fill, or undefined", () => {
    const store = new MemSlidesStore();
    let slideId!: string;
    let elementId!: string;
    store.batch(() => {
      slideId = store.addSlide("blank");
      elementId = store.addElement(slideId, {
        type: "shape",
        frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
        data: { kind: "rect" },
      });
    });
    const shape = store
      .read()
      .slides[0].elements.find((e) => e.id === elementId)!;
    expect(readShapeFill(shape)).toBe(undefined);

    applyShapeFill(store, slideId, shape, makeSrgbColor("#123456"));
    const after = store
      .read()
      .slides[0].elements.find((e) => e.id === elementId)!;
    expect(readShapeFill(after)).toEqual({
      kind: "srgb",
      value: "#123456",
    });
  });
});
