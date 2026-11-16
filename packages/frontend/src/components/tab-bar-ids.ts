/**
 * DOM ids that tie the sheet tab strip (`role="tablist"`) to the content it
 * switches (`role="tabpanel"`). There is one panel — it renders whichever tab
 * is active — so every tab points `aria-controls` at it and the panel is
 * labelled by the active tab.
 */
export const SHEET_TAB_PANEL_ID = "sheet-tab-panel";

/** `sheetTabElementId` is the DOM id of the tab button for `tabId`. */
export function sheetTabElementId(tabId: string): string {
  return `sheet-tab-${tabId}`;
}
