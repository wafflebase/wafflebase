import { describe, it, expect } from 'vitest';
import {
  LINE_PICKER_ENTRIES,
  isLinePickerKind,
  isLineToolKind,
} from "@/app/slides/line-picker-helpers.ts";

/**
 * The `<LinePicker />` UI lives in `line-picker.tsx` (Radix
 * DropdownMenu + canvas-rendered icons). Like `<ShapePicker />`, the
 * dropdown's testable surface — the static catalogue + the
 * activeKind type guard — is extracted into `line-picker-helpers.ts`
 * and asserted here without rendering React.
 *
 * The picker contract: the four connector tools (Line, Arrow, Elbow
 * connector, Curved connector) in Google Slides order, plus an
 * `isLinePickerKind` guard the toolbar uses to split the editor's
 * `InsertKind` between `<ShapePicker />` and `<LinePicker />`
 * activeKind props. Lines were extracted from the shape picker
 * because line insertion is endpoint-anchored (snap-to-shape),
 * fundamentally different UX from shape drag-to-size — so the
 * affordance gets its own dropdown.
 */

describe("line-picker entries", () => {
  it("exposes the four connector tools plus scribble in Google Slides order", () => {
    expect(LINE_PICKER_ENTRIES.length).toBe(5);
    expect(LINE_PICKER_ENTRIES.map((e) => e.kind)).toEqual([
      "connector:line",
      "connector:arrow",
      "connector:elbow",
      "connector:curved",
      "freeform",
    ]);
    expect(LINE_PICKER_ENTRIES.map((e) => e.label)).toEqual([
      "Line",
      "Arrow",
      "Elbow connector",
      "Curved connector",
      "Scribble",
    ]);
  });

  it("each entry has a non-empty kind and label", () => {
    for (const entry of LINE_PICKER_ENTRIES) {
      expect(typeof entry.kind).toBe("string");
      expect(entry.kind.length > 0).toBeTruthy();
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length > 0).toBeTruthy();
    }
  });

  it("kind values are unique across the catalogue", () => {
    const kinds = LINE_PICKER_ENTRIES.map((e) => e.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe("isLinePickerKind", () => {
  it("returns true for connector kinds", () => {
    expect(isLinePickerKind("connector:line")).toBe(true);
    expect(isLinePickerKind("connector:arrow")).toBe(true);
    expect(isLinePickerKind("connector:elbow")).toBe(true);
    expect(isLinePickerKind("connector:curved")).toBe(true);
  });

  it("returns false for shape kinds, text, scribble, and null", () => {
    expect(isLinePickerKind("rect")).toBe(false);
    expect(isLinePickerKind("ellipse")).toBe(false);
    expect(isLinePickerKind("rightArrow")).toBe(false);
    expect(isLinePickerKind("text")).toBe(false);
    expect(isLinePickerKind("freeform")).toBe(false);
    expect(isLinePickerKind(null)).toBe(false);
    expect(isLinePickerKind(undefined)).toBe(false);
  });
});

describe("isLineToolKind", () => {
  it("returns true for connector kinds and the scribble", () => {
    expect(isLineToolKind("connector:line")).toBe(true);
    expect(isLineToolKind("connector:arrow")).toBe(true);
    expect(isLineToolKind("connector:elbow")).toBe(true);
    expect(isLineToolKind("connector:curved")).toBe(true);
    expect(isLineToolKind("freeform")).toBe(true);
  });

  it("returns false for shape kinds, text, and null", () => {
    expect(isLineToolKind("rect")).toBe(false);
    expect(isLineToolKind("text")).toBe(false);
    expect(isLineToolKind(null)).toBe(false);
    expect(isLineToolKind(undefined)).toBe(false);
  });
});
