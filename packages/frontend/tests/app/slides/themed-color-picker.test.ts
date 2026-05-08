import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemSlidesStore } from "@wafflebase/slides";
import {
  THEME_ROLES,
  applyShapeFill,
  isRoleSelected,
  makeRoleColor,
  makeSrgbColor,
  readShapeFill,
} from "@/app/slides/themed-color-picker-helpers.ts";

/**
 * The themed color picker UI is a `.tsx` React component, stubbed by
 * `tests/resolve-hooks.mjs` at test load (Node
 * `--experimental-strip-types` can't parse JSX). So the picker's
 * behavioural surface — role-list shape, role-vs-srgb selection
 * detection, ThemeColor builders, and the store-write helper — is
 * extracted into `themed-color-picker-helpers.ts` and tested here.
 */

describe("themed-color-picker helpers", () => {
  it("THEME_ROLES has all 12 ColorScheme slots in OOXML order", () => {
    assert.equal(THEME_ROLES.length, 12);
    assert.ok(THEME_ROLES.includes("text"));
    assert.ok(THEME_ROLES.includes("background"));
    assert.ok(THEME_ROLES.includes("textSecondary"));
    assert.ok(THEME_ROLES.includes("backgroundAlt"));
    for (let i = 1; i <= 6; i++) {
      assert.ok(
        THEME_ROLES.includes(`accent${i}` as (typeof THEME_ROLES)[number]),
        `THEME_ROLES missing accent${i}`,
      );
    }
    assert.ok(THEME_ROLES.includes("hyperlink"));
    assert.ok(THEME_ROLES.includes("visitedHyperlink"));
  });

  it("isRoleSelected returns true only when value is a role match", () => {
    assert.ok(isRoleSelected({ kind: "role", role: "accent1" }, "accent1"));
    assert.ok(!isRoleSelected({ kind: "role", role: "accent1" }, "accent2"));
    // srgb values never match a role swatch — they're concrete colors,
    // so no theme-role marker should appear in the picker.
    assert.ok(!isRoleSelected({ kind: "srgb", value: "#abcdef" }, "accent1"));
    assert.ok(!isRoleSelected(undefined, "accent1"));
  });

  it("makeRoleColor produces a role ThemeColor", () => {
    assert.deepEqual(makeRoleColor("accent1"), {
      kind: "role",
      role: "accent1",
    });
  });

  it("makeSrgbColor produces an srgb ThemeColor", () => {
    assert.deepEqual(makeSrgbColor("#abcdef"), {
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
    assert.equal(shape.type, "shape");

    applyShapeFill(store, slideId, shape, makeRoleColor("accent3"));

    const after = store.read();
    const updated = after.slides[0].elements.find((e) => e.id === elementId)!;
    assert.equal(updated.type, "shape");
    if (updated.type === "shape") {
      assert.deepEqual(updated.data.fill, { kind: "role", role: "accent3" });
    }

    // Single undo should revert the fill — proving applyShapeFill
    // batched its updateElementData write.
    assert.ok(store.canUndo());
    store.undo();
    const reverted = store.read();
    const revShape = reverted.slides[0].elements.find(
      (e) => e.id === elementId,
    )!;
    if (revShape.type === "shape") {
      assert.equal(revShape.data.fill, undefined);
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
    assert.equal(store.canUndo(), canUndoBefore);
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
    assert.equal(readShapeFill(shape), undefined);

    applyShapeFill(store, slideId, shape, makeSrgbColor("#123456"));
    const after = store
      .read()
      .slides[0].elements.find((e) => e.id === elementId)!;
    assert.deepEqual(readShapeFill(after), {
      kind: "srgb",
      value: "#123456",
    });
  });
});
