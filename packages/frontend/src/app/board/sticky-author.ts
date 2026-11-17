import type { Element } from "@wafflebase/slides";
import { isStickyData, type StickyDataExtras } from "@wafflebase/board";

/** Inset of the author tag from the sticky's bottom-left corner, world px. */
const AUTHOR_PAD = 8;

/**
 * The name a sticky's author tag shows, or `null` when none is painted:
 * not a sticky, no recorded author, the tag switched off on that sticky
 * ("Show author"), or the board in anonymous mode — which hides every
 * name on the board, including ones recorded before it was switched on.
 */
export function stickyAuthorLabel(
  element: Element,
  anonymous: boolean,
): string | null {
  if (anonymous || element.type !== "shape" || !isStickyData(element.data)) {
    return null;
  }
  const { author, showAuthor } = element.data as StickyDataExtras;
  if (typeof author !== "string" || author.trim() === "") return null;
  if (showAuthor === false) return null;
  return author.trim();
}

/** World-px font size of the tag: small, scaled down on a small sticky. */
export function authorFontSize(w: number, h: number): number {
  return Math.max(9, Math.min(13, Math.min(w, h) * 0.07));
}

/** `text`, cut with an ellipsis to fit `maxWidth` under `ctx`'s font. */
export function fitWithEllipsis(
  ctx: Pick<CanvasRenderingContext2D, "measureText">,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  // Longest prefix that fits with the ellipsis appended.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : text.slice(0, lo) + "…";
}

/**
 * Paint a sticky's author tag small at its bottom edge (FigJam's "show
 * author"). Wired as the editor's `decorateElement` renderer hook, so it
 * runs right after the sticky itself is drawn, with `ctx` in world space.
 * Rotates with the sticky; leaves `ctx` as it found it.
 */
export function drawStickyAuthor(
  ctx: CanvasRenderingContext2D,
  element: Element,
  anonymous: boolean,
): void {
  const label = stickyAuthorLabel(element, anonymous);
  if (label === null) return;
  const { x, y, w, h, rotation } = element.frame;
  ctx.save();
  try {
    ctx.translate(x + w / 2, y + h / 2);
    if (rotation) ctx.rotate(rotation);
    ctx.font = `${authorFontSize(w, h)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const text = fitWithEllipsis(ctx, label, w - AUTHOR_PAD * 2);
    if (text) ctx.fillText(text, -w / 2 + AUTHOR_PAD, h / 2 - AUTHOR_PAD / 2);
  } finally {
    ctx.restore();
  }
}
