import { formatCombo } from "@wafflebase/slides";
import { semantic } from "@wafflebase/core/tokens";

/*
 * Colours are pinned to the LIGHT tokens, not the theme-flipping classes:
 * the hint sits on the board plane, which stays light in both app themes
 * (see `board-plane.ts`). `mutedForeground` is 4.83:1 on the white plane.
 */
const MUTED = semantic.light.mutedForeground;
const RULE = semantic.light.border;
const WASH = semantic.light.muted;

function Key({ children }: { children: string }) {
  return (
    <kbd
      className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded px-1 font-mono text-xs"
      style={{ border: `1px solid ${RULE}`, background: WASH, color: semantic.light.foreground }}
    >
      {children}
    </kbd>
  );
}

/**
 * First-run cue on an empty, editable board.
 *
 * An empty board was an unmarked plane: the tools are icon-only and the
 * single-key shortcuts lived nowhere a newcomer would find them. This
 * names the two most common first moves and the right-click menu, and
 * goes away with the first element. It takes no pointer events, so it
 * never stands between the user and the canvas.
 */
export function BoardEmptyHint() {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <p className="max-w-xs text-center text-sm leading-relaxed" style={{ color: MUTED }}>
        Press <Key>S</Key> for a sticky note or <Key>T</Key> for text, or
        right-click to add something. <Key>{formatCombo("Mod+/", isMac)}</Key>{" "}
        shows every shortcut.
      </p>
    </div>
  );
}
