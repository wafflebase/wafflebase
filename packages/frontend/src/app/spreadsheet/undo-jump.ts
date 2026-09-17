import type { UndoSelection } from "@wafflebase/sheets";

/**
 * A cross-tab undo waiting to be applied.
 *
 * Yorkie's undo history is per *document* while a sheet engine is mounted on
 * one tab, so a replay can land where the user is not looking. The engine
 * reports it, the host switches tabs, and the selection is handed to the
 * mount that appears — which does not exist until the switch has rendered,
 * hence the `requestId`-keyed hand-off rather than a direct call.
 */
export type UndoJumpTarget = {
  selection: UndoSelection;
  requestId: number;
};

/**
 * Whether a reported jump names a tab the editor can actually go to.
 *
 * The tab id comes out of `root.sheets`, which can outlive `root.tabs`, and
 * only a `sheet` tab has a grid to restore a selection into — a datasource or
 * lakehouse tab renders a different view entirely. Every other jump path in
 * these hosts makes the same check; without it a stale id switches the editor
 * to a tab that renders nothing.
 */
export function isJumpableSheetTab(
  tab: { type?: string } | undefined | null,
): boolean {
  return !!tab && tab.type === "sheet";
}

/**
 * Whether this mount should apply a pending jump.
 *
 * Three guards, and each one is load-bearing: there may be no pending jump;
 * the mount that renders first after a tab switch may still be the *old*
 * tab's; and the effect re-runs whenever the engine re-renders, so without
 * the request id a single jump would be re-applied over whatever the user
 * selected afterwards.
 */
export function shouldApplyUndoJump(
  target: UndoJumpTarget | null | undefined,
  tabId: string,
  lastHandledRequestId: number,
): boolean {
  if (!target) return false;
  if (target.selection.tabId !== tabId) return false;
  return target.requestId !== lastHandledRequestId;
}
