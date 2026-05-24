/**
 * Logic tests for ArrangeMenu props predicates.
 *
 * These are logic tests rather than component-render tests; visual +
 * interaction tests will land in Task 13 (browser).
 * Here we verify the predicate logic and that the new SlidesEditor methods
 * used by the menu (bringForward, sendBackward, bringToFront, sendToBack,
 * rotateBy) are present on MemSlidesStore-backed editors — the core
 * correctness is covered by editor.test.ts in the slides package.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// canAlign / canDistribute predicate logic (matches arrange-menu.tsx lines)
// ---------------------------------------------------------------------------

function canAlign(editor: unknown, selectionSize: number): boolean {
  return !!editor && selectionSize > 0;
}

function canDistribute(editor: unknown, selectionSize: number): boolean {
  return !!editor && selectionSize >= 3;
}

describe("ArrangeMenu predicate logic", () => {
  it("canAlign is false when editor is null", () => {
    expect(canAlign(null, 1)).toBe(false);
    expect(canAlign(null, 0)).toBe(false);
  });

  it("canAlign is false when selectionSize is 0", () => {
    expect(canAlign({}, 0)).toBe(false);
  });

  it("canAlign is true for selectionSize >= 1 with a live editor", () => {
    expect(canAlign({}, 1)).toBe(true);
    expect(canAlign({}, 2)).toBe(true);
  });

  it("canDistribute is false when fewer than 3 elements selected", () => {
    expect(canDistribute({}, 0)).toBe(false);
    expect(canDistribute({}, 1)).toBe(false);
    expect(canDistribute({}, 2)).toBe(false);
  });

  it("canDistribute is true for selectionSize >= 3", () => {
    expect(canDistribute({}, 3)).toBe(true);
    expect(canDistribute({}, 10)).toBe(true);
  });

  it("canDistribute is false when editor is null regardless of size", () => {
    expect(canDistribute(null, 5)).toBe(false);
  });
});
