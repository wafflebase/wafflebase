import { Link } from "react-router-dom";
import { formatCombo } from "@wafflebase/slides";
import { semantic } from "@wafflebase/core/tokens";
import { useIsMobile } from "@/hooks/use-mobile";
import { isCoarsePointer } from "@/hooks/use-coarse-pointer";

/*
 * Colours are pinned to light-surface inks, not the theme-flipping classes:
 * the hint sits on the board plane, which stays light in both app themes
 * but is dimmed to #BBBCB8 in dark mode (see `board-plane.ts`). Each ink
 * has to clear 4.5:1 on BOTH planes; the ratios are white / dimmed.
 *
 * - HINT_INK, zinc-700: 10.46 / 5.48. The muted token (4.83 / 2.53) fell
 *   under the floor on the dimmed plane, and nothing between it and
 *   `foreground` in the token set clears 4.5 there.
 * - INK, `foreground`: 19.89 / 10.42, for the key names and the link.
 * - ACCENT, deep syrup: only the link's underline (a 3:1 mark: 6.84 /
 *   3.58). Strong syrup as the link's words was 5.53 on white but 2.90 on
 *   the dimmed plane, and no syrup step reaches 4.5 there, so the words
 *   take the ink and the accent stays in the underline.
 */
const HINT_INK = "oklch(0.37 0.013 285.805)";
const INK = semantic.light.foreground;
const RULE = semantic.light.border;
const WASH = semantic.light.muted;
const ACCENT = semantic.light.primaryHover;

/**
 * Where "Start from a template" goes: the workspace Templates page, on its
 * public tab (where the seeded board templates are listed), filtered to
 * boards. Without a workspace (a share-link editor), the public gallery,
 * which takes the same `type` filter.
 */
function boardTemplatesHref(workspaceId?: string): string {
  return workspaceId
    ? `/w/${encodeURIComponent(workspaceId)}/templates?tab=public&type=board`
    : "/templates?type=board";
}

function Key({ children }: { children: string }) {
  return (
    <kbd
      className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded px-1 font-mono text-xs"
      style={{ border: `1px solid ${RULE}`, background: WASH, color: INK }}
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
 * never stands between the user and the canvas — except its one link,
 * which offers a board template instead of a blank plane.
 */
export function BoardEmptyHint({ workspaceId }: { workspaceId?: string }) {
  // A phone has no S/T keys, no right button and no Mod+/, so it is told
  // about the tool dock along the bottom and the long-press menu
  // (`board-touch-gestures.ts` opens it on an empty-canvas hold) instead.
  // Both conditions: a narrow desktop window still has a keyboard.
  const isMobile = useIsMobile();
  const touch = isMobile && isCoarsePointer();
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <p className="max-w-xs text-center text-sm leading-relaxed" style={{ color: HINT_INK }}>
        {touch ? (
          <>
            Tap a tool in the bar below for a sticky note, text or shape, or
            press and hold the board to add something.
          </>
        ) : (
          <>
            Press <Key>S</Key> for a sticky note or <Key>T</Key> for text, or
            right-click to add something. <Key>{formatCombo("Mod+/", isMac)}</Key>{" "}
            shows every shortcut.
          </>
        )}
        <br />
        <Link
          to={boardTemplatesHref(workspaceId)}
          className="focus-ring pointer-events-auto mt-2 inline-block rounded-sm font-medium underline decoration-2 underline-offset-4"
          style={{ color: INK, textDecorationColor: ACCENT }}
        >
          Start from a template
        </Link>
      </p>
    </div>
  );
}
