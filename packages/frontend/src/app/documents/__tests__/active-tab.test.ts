import { describe, expect, it } from "vitest";

import { resolveActiveTabId } from "@/app/documents/active-tab";

/**
 * `resolveActiveTabId` is the only writer of `activeTabId` that runs when a
 * spreadsheet is opened, so "which tab does a workbook open on" is decided
 * here. Issue #1196 reported a multi-tab workbook opening on its rightmost
 * tab; these pin the answer to `tabOrder[0]` at the unit level, and
 * `document-detail-active-tab.test.tsx` pins it through the real route.
 */
describe("resolveActiveTabId", () => {
  const tabs = {
    t1: { id: "t1", name: "Sheet1" },
    t2: { id: "t2", name: "Sheet2" },
    t3: { id: "t3", name: "Sheet3" },
  };

  it("opens a multi-tab workbook on the leftmost tab", () => {
    expect(resolveActiveTabId(["t1", "t2", "t3"], tabs, null)).toBe("t1");
  });

  it("keeps a selection the user already made", () => {
    expect(resolveActiveTabId(["t1", "t2", "t3"], tabs, "t3")).toBe("t3");
  });

  // The case the fallback exists for: a peer deleted the tab being viewed, or
  // a revision restore replaced the root without it.
  it("falls back to the leftmost tab when the selection disappears", () => {
    expect(resolveActiveTabId(["t1", "t2", "t3"], tabs, "gone")).toBe("t1");
  });

  // A `datasource` / `lakehouse` tab holds a `tabOrder` slot, so `tabOrder[0]`
  // is not necessarily a tab that still has metadata.
  it("skips ordered ids with no tab metadata", () => {
    expect(resolveActiveTabId(["missing", "t2"], tabs, null)).toBe("t2");
  });

  it("answers null for a workbook with no tabs", () => {
    expect(resolveActiveTabId([], {}, null)).toBeNull();
    expect(resolveActiveTabId(undefined, undefined, null)).toBeNull();
  });
});
