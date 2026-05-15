import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LINE_PICKER_ENTRIES,
  isLinePickerKind,
} from "@/app/slides/line-picker-helpers.ts";

/**
 * The `<LinePicker />` UI lives in `line-picker.tsx` (Radix
 * DropdownMenu + canvas-rendered icons). Like `<ShapePicker />`,
 * `tests/resolve-hooks.mjs` stubs `.tsx` modules at test load, so the
 * dropdown's testable surface — the static catalogue + the
 * activeKind type guard — is extracted into `line-picker-helpers.ts`
 * and asserted here without rendering React.
 *
 * The picker contract: exactly two entries (Line + Arrow) in Google
 * Slides order, plus an `isLinePickerKind` guard the toolbar uses to
 * split the editor's `InsertKind` between `<ShapePicker />` and
 * `<LinePicker />` activeKind props. Lines were extracted from the
 * shape picker because line insertion is endpoint-anchored
 * (snap-to-shape), fundamentally different UX from shape
 * drag-to-size — so the affordance gets its own dropdown.
 */

describe("line-picker entries", () => {
  it("exposes exactly Line and Arrow in Google Slides order", () => {
    assert.equal(LINE_PICKER_ENTRIES.length, 2);
    assert.deepEqual(
      LINE_PICKER_ENTRIES.map((e) => e.kind),
      ["connector:line", "connector:arrow"],
    );
    assert.deepEqual(
      LINE_PICKER_ENTRIES.map((e) => e.label),
      ["Line", "Arrow"],
    );
  });

  it("each entry has a non-empty kind and label", () => {
    for (const entry of LINE_PICKER_ENTRIES) {
      assert.equal(typeof entry.kind, "string");
      assert.ok(entry.kind.length > 0);
      assert.equal(typeof entry.label, "string");
      assert.ok(entry.label.length > 0);
    }
  });

  it("kind values are unique across the catalogue", () => {
    const kinds = LINE_PICKER_ENTRIES.map((e) => e.kind);
    assert.equal(new Set(kinds).size, kinds.length);
  });
});

describe("isLinePickerKind", () => {
  it("returns true for connector kinds", () => {
    assert.equal(isLinePickerKind("connector:line"), true);
    assert.equal(isLinePickerKind("connector:arrow"), true);
  });

  it("returns false for shape kinds, text, and null", () => {
    assert.equal(isLinePickerKind("rect"), false);
    assert.equal(isLinePickerKind("ellipse"), false);
    assert.equal(isLinePickerKind("rightArrow"), false);
    assert.equal(isLinePickerKind("text"), false);
    assert.equal(isLinePickerKind(null), false);
    assert.equal(isLinePickerKind(undefined), false);
  });
});
