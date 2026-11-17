/**
 * Let a click on the board canvas close an open toolbar popover AND act.
 *
 * Every modal Radix layer (the slides colour pickers are modal Popovers,
 * Arrange / weight / dash are modal DropdownMenus) sets
 * `body.style.pointerEvents = "none"` while open. The canvas inherits that,
 * so the browser hit-tests the dismissing click to `<html>`: Radix closes
 * the popover from its document-level `pointerdown` listener, but the
 * canvas never sees the press. That was the hands-on report "the first
 * click after closing a toolbar popover is swallowed".
 *
 * An explicit `pointer-events: auto` on the canvas host overrides the
 * inherited `none` for its subtree only. The press then reaches the editor
 * (select, marquee, drag) and still bubbles to `document`, where Radix
 * dismisses the layer as before — FigJam's click-through dismissal. The
 * toolbar and the rest of the page stay inert while a menu is open, and a
 * Dialog is unaffected: its overlay covers the canvas and takes the click.
 */
export function allowClickThroughDismiss(host: HTMLElement): void {
  host.style.pointerEvents = "auto";
}
