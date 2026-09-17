import { describe, it, expect } from "vitest";
import type { UndoSelection } from "@wafflebase/sheets";
import {
  isJumpableSheetTab,
  shouldApplyUndoJump,
  type UndoJumpTarget,
} from "./undo-jump";

const selection = (tabId: string): UndoSelection => ({
  tabId,
  otherTab: true,
  selectionType: "cell",
  range: [
    { r: 1, c: 1 },
    { r: 1, c: 1 },
  ],
});

const target = (tabId: string, requestId: number): UndoJumpTarget => ({
  selection: selection(tabId),
  requestId,
});

describe("isJumpableSheetTab", () => {
  it("accepts a sheet tab", () => {
    expect(isJumpableSheetTab({ type: "sheet" })).toBe(true);
  });

  it("refuses a tab that renders something other than a grid", () => {
    // A datasource or lakehouse tab has no selection to restore into.
    expect(isJumpableSheetTab({ type: "datasource" })).toBe(false);
    expect(isJumpableSheetTab({ type: "lakehouse" })).toBe(false);
  });

  it("refuses an id that names no tab at all", () => {
    // `root.sheets` can outlive `root.tabs`; switching to such an id would
    // leave the editor on a tab that renders nothing.
    expect(isJumpableSheetTab(undefined)).toBe(false);
    expect(isJumpableSheetTab(null)).toBe(false);
    expect(isJumpableSheetTab({})).toBe(false);
  });
});

describe("shouldApplyUndoJump", () => {
  it("applies a fresh jump on the tab it names", () => {
    expect(shouldApplyUndoJump(target("tab-a", 1), "tab-a", 0)).toBe(true);
  });

  it("does nothing when no jump is pending", () => {
    expect(shouldApplyUndoJump(null, "tab-a", 0)).toBe(false);
    expect(shouldApplyUndoJump(undefined, "tab-a", 0)).toBe(false);
  });

  it("waits for the mount the jump actually names", () => {
    // The old tab's mount re-renders before the switch lands; it must not
    // steal a selection meant for another grid.
    expect(shouldApplyUndoJump(target("tab-b", 1), "tab-a", 0)).toBe(false);
  });

  it("applies a given request only once", () => {
    // The effect re-runs on every engine render, so without this the jump
    // would be re-applied over whatever the user selected afterwards.
    expect(shouldApplyUndoJump(target("tab-a", 7), "tab-a", 7)).toBe(false);
  });

  it("applies the next request after one was handled", () => {
    expect(shouldApplyUndoJump(target("tab-a", 8), "tab-a", 7)).toBe(true);
  });
});
