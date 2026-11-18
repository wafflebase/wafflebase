import { STAMP_ART, stampIconRatio } from "./stamp-art";
import type { BoardStampKind } from "./types";

/**
 * A stamp's sticker art at `size` px, for menus and the toolbar — the same
 * sticker the canvas draws, white rim included, so the menu shows what a
 * click will place and the disc keeps an edge on a dark menu.
 */
export function StampBadge({ kind, size = 18 }: { kind: BoardStampKind; size?: number }) {
  const art = STAMP_ART[kind];
  const icon = Math.round(size * stampIconRatio(kind));
  return (
    <span
      aria-hidden="true"
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
        width={icon}
        height={icon}
        fill="none"
        stroke="#ffffff"
        strokeWidth={size < 20 ? 2.25 : 2.75}
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
