# Board navigation feel (PR A of the board usability pass)

The usability audit of 2026-11-16 found board navigation rough in ways
that make every other board feature feel worse. This is the first of
three PRs (A navigation, B peer cursors v2, C marker drawing), all
scoped in `docs/design/board/board-figjam-parity.md`.

## Scope

- [x] Continuous wheel zoom: factor `exp(-Δ·k)` with a clamped `Δ`, so a
      trackpad pinch (many small ctrl+wheel events) zooms smoothly while a
      mouse-wheel tick still lands ~10%.
- [x] Normalise `deltaMode` (line / page) to pixels for pan and zoom.
- [x] Shift + vertical wheel pans horizontally (Windows mice).
- [x] Zoom keys: `Mod+=`/`Mod++` in, `Mod+-` out (stepping through
      presets), `Mod+0` 100%, `Shift+2` zoom to selection. Key repeat
      allowed for in/out. Browser page zoom suppressed on the board.
- [x] Add 800% preset (the zoom range already reaches 8×).
- [x] Hand tool: `H` key + toolbar toggle; left-drag pans; touch pans
      over content too; any other tool exits it.
- [x] Adopt `useCanvasFocusRelease()` on the board toolbar (#882). The
      hook only releases focus after pointer interaction, so a keyboard
      user tabbing to a toggle keeps Space-activates-button, while a mouse
      user's next Space pans — the FigJam behaviour.
- [x] Shortcut sheet + tooltips list the new keys.
- [x] Unit tests for wheel mapping, zoom stepping, key handling.
- [x] Design doc: board-figjam-parity.md roadmap (A/B/C), drop the #882
      known limitation from board-editing-parity.md.
- [x] `pnpm verify:fast` green; manual smoke in `pnpm dev`.

## Review

Browser smoke (branch frontend on :5180 against a branch backend on :3001):
the hand toggle pans when the drag starts on a sticky, and focus returns to
`body` after the toolbar click. A pinch-like 5×Δ2 zoom lands at 111%. Mod+=
goes 100→200%, Mod+- goes back to 100% and Mod+0 lands at 100%, with the
browser page zoom blocked. V, H and T swap tools. Shift+2 on a selected
sticky frames it at 200% without starting an edit. That last one needed two
fixes found only in the browser (see lessons).
