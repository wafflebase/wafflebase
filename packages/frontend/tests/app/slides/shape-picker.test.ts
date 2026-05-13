import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SHAPE_PICKER_CATEGORIES,
  type Category,
} from "@/app/slides/shape-picker-helpers.ts";

/**
 * The ShapePicker UI is a `.tsx` React component (Radix Popover +
 * canvas-rendered icons) which `tests/resolve-hooks.mjs` stubs at
 * test load (Node `--experimental-strip-types` cannot parse JSX).
 * The picker's testable surface — the category catalogue that
 * drives the popover's sections + grid layout — is extracted into
 * `shape-picker-helpers.ts` so the toolbar contract can be asserted
 * without rendering React.
 *
 * The picker contract: 7 categories (Lines, Shapes, Block Arrows,
 * Flowchart, Callouts, Equation, Stars) with a combined entry count
 * matching the registered `ShapeKind` catalogue. Each entry is
 * tagged with a non-empty user-facing label that doubles as the
 * IconButton's `aria-label` for accessibility.
 *
 * The entry-count expectation is updated as P3-B adds new shapes:
 * 55 (P3-A.2) → 58 (T2a: heptagon, decagon, dodecagon) → 62
 * (T2b: pie, chord, arc, blockArc) → 70 (T2c: frame, halfFrame,
 * corner, diagStripe, plaque, bevel, foldedCorner, cube) → 77
 * (T2d: teardrop, smileyFace, heart, lightningBolt, sun, moon,
 * noSmoking) → 84 (T3: snip1/2 + round1/2 + snipRound, 7 rects)
 * → 88 (T4a: upDownArrow, leftRightUpArrow, notchedRightArrow,
 * stripedRightArrow) → 92 (T4b: bentArrow, bentUpArrow,
 * uturnArrow, swooshArrow) → 97 (T4c: circularArrow + 4×
 * curved*Arrow) → 102 (T5: 5 banners — new "Banners" section
 * inserted between Block Arrows and Flowchart) → 105 (T6:
 * borderCallout1/2/3 appended to Callouts) → 106 (T7a:
 * actionButtonBlank — infrastructure pilot, new "Action Buttons"
 * section at end) → 117 (T7b: 11 remaining action buttons —
 * final P3-B catalog).
 */

describe("shape-picker categories", () => {
  it("exposes 9 categories in display order", () => {
    assert.equal(SHAPE_PICKER_CATEGORIES.length, 9);
    assert.deepEqual(
      SHAPE_PICKER_CATEGORIES.map((c) => c.id),
      [
        "lines",
        "shapes",
        "block-arrows",
        "banners",
        "flowchart",
        "callouts",
        "equation",
        "stars",
        "action-buttons",
      ],
    );
  });

  it("each category has a human-readable title", () => {
    const expected: Record<string, string> = {
      lines: "Lines",
      shapes: "Shapes",
      "block-arrows": "Block Arrows",
      banners: "Banners",
      flowchart: "Flowchart",
      callouts: "Callouts",
      equation: "Equation",
      stars: "Stars",
      "action-buttons": "Action Buttons",
    };
    for (const cat of SHAPE_PICKER_CATEGORIES) {
      assert.equal(cat.title, expected[cat.id]);
    }
  });

  it("contains exactly 117 ShapeKind entries across all categories", () => {
    const total = SHAPE_PICKER_CATEGORIES.reduce(
      (sum: number, cat: Category) => sum + cat.kinds.length,
      0,
    );
    assert.equal(total, 117);
  });

  it("each entry has a non-empty kind and label", () => {
    for (const cat of SHAPE_PICKER_CATEGORIES) {
      for (const entry of cat.kinds) {
        assert.equal(typeof entry.kind, "string");
        assert.ok(entry.kind.length > 0, `empty kind in ${cat.id}`);
        assert.equal(typeof entry.label, "string");
        assert.ok(entry.label.length > 0, `empty label in ${cat.id}`);
      }
    }
  });

  it("includes the canonical first entry per category", () => {
    // Anchor entries — the first kind in each section is the user's
    // mental "default" for that category. Locking these prevents an
    // accidental category-order shuffle from breaking habits.
    const firsts: Record<string, string> = {
      lines: "line",
      shapes: "rect",
      "block-arrows": "rightArrow",
      banners: "ribbon",
      flowchart: "flowChartTerminator",
      callouts: "wedgeRectCallout",
      equation: "mathPlus",
      stars: "star4",
      "action-buttons": "actionButtonBlank",
    };
    for (const cat of SHAPE_PICKER_CATEGORIES) {
      assert.equal(cat.kinds[0]?.kind, firsts[cat.id]);
    }
  });

  it("ShapeKind values are unique across the catalogue", () => {
    const kinds = SHAPE_PICKER_CATEGORIES.flatMap((c) =>
      c.kinds.map((k) => k.kind),
    );
    assert.equal(new Set(kinds).size, kinds.length);
  });
});
