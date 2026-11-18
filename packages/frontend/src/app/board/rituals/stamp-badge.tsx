import { STAMP_ART, stampIconRatio } from "./stamp-art";
import type { BoardStampKind } from "./types";

/**
 * A stamp's sticker art at `size` px, for menus and the toolbar — the same
 * sticker the canvas draws, white rim included, so the menu shows what a
 * click will place and the disc keeps an edge on a dark menu.
 *
 * The icon is sized by `style`, not by the `width`/`height` attributes:
 * `Button`, `Toggle` and menu items all carry
 * `[&_svg:not([class*='size-'])]:size-4`, a CSS rule that beats an SVG
 * attribute, and at 16px the glyph filled an 18px disc to its rim.
 */
/**
 * How much more of the disc the icon takes in a menu-sized badge than on
 * a canvas sticker. At 16–18px the canvas ratio leaves an ~8px glyph that
 * reads as a dot; the disc's edge stays visible at this share because the
 * badge carries the same white rim.
 */
const SMALL_BADGE_ICON_BOOST = 1.25;

export function StampBadge({ kind, size = 18 }: { kind: BoardStampKind; size?: number }) {
  const art = STAMP_ART[kind];
  const boost = size < 24 ? SMALL_BADGE_ICON_BOOST : 1;
  const icon = Math.round(size * stampIconRatio(kind) * boost);
  return (
    <span
      aria-hidden="true"
      data-stamp-badge=""
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: art.color,
        boxShadow: "0 0 0 1.5px #ffffff",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        style={{ width: icon, height: icon }}
        fill="none"
        stroke="#ffffff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {art.paths.map((p) => (
          <path
            key={p.d}
            d={p.d}
            fill={p.fill ? "#ffffff" : undefined}
            stroke={p.fill ? "none" : undefined}
          />
        ))}
      </svg>
    </span>
  );
}

/**
 * A stamp kind's icon alone, outlined in `currentColor` at 16px with a
 * 2px stroke — the dock's idle Stamp button, where a coloured disc would
 * be a second chromatic signal beside syrup (DESIGN.md, The One Accent
 * Rule) and would read as already pressed. It sits beside Tabler's outline
 * icons, so every path is stroked, including the ones the sticker fills.
 */
export function StampGlyph({ kind }: { kind: BoardStampKind }) {
  return (
    <svg
      aria-hidden="true"
      data-stamp-glyph=""
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {STAMP_ART[kind].paths.map((p) => (
        <path key={p.d} d={p.d} />
      ))}
    </svg>
  );
}
