import { describe, it, expect } from 'vitest';
import {
  LINE_PICKER_ENTRIES,
  isLinePickerKind,
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
  it("exposes the four connector tools in Google Slides order", () => {
    expect(LINE_PICKER_ENTRIES.length).toBe(4);
    expect(LINE_PICKER_ENTRIES.map((e) => e.kind)).toEqual([
      "connector:line",
      "connector:arrow",
      "connector:elbow",
      "connector:curved",
    ]);
    expect(LINE_PICKER_ENTRIES.map((e) => e.label)).toEqual([
      "Line",
      "Arrow",
      "Elbow connector",
      "Curved connector",
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

  it("returns false for shape kinds, text, and null", () => {
    expect(isLinePickerKind("rect")).toBe(false);
    expect(isLinePickerKind("ellipse")).toBe(false);
    expect(isLinePickerKind("rightArrow")).toBe(false);
    expect(isLinePickerKind("text")).toBe(false);
    expect(isLinePickerKind(null)).toBe(false);
    expect(isLinePickerKind(undefined)).toBe(false);
  });
});
