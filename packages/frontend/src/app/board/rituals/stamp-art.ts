import { getPeerCursorColor } from "@wafflebase/sheets";
import type { BoardStampKind } from "./types";

/**
 * How a stamp is drawn: a sticker — a coloured disc with a white rim and a
 * white icon — rather than an OS emoji, which looked different on every
 * platform and blended into whatever it sat on.
 *
 * Icons are lucide's (ISC; already a dependency through `lucide-react`),
 * on its 24×24 grid. `fill` paths are filled as well as stroked.
 */
export interface StampArt {
  color: string;
  paths: ReadonlyArray<{ d: string; fill?: boolean }>;
  /**
   * Optical size of the icon relative to the others. Solid and wide glyphs
   * (heart, star, thumbs-up) carry more white than a check, so at the same
   * box they swallow the disc and its colour edge disappears.
   */
  scale?: number;
}

/** Icon box as a fraction of the disc, before a kind's {@link StampArt.scale}. */
export const STAMP_ICON_RATIO = 0.54;

/** The icon box for a kind, as a fraction of the disc. */
export function stampIconRatio(kind: BoardStampKind): number {
  return STAMP_ICON_RATIO * (STAMP_ART[kind].scale ?? 1);
}

export const STAMP_ART: Readonly<Record<BoardStampKind, StampArt>> = {
  plus1: {
    color: "#2F80ED",
    scale: 0.84,
    paths: [
      { d: "M7 10v12" },
      {
        d: "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",
      },
    ],
  },
  heart: {
    color: "#E8457C",
    scale: 0.9,
    paths: [
      {
        d: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
        fill: true,
      },
    ],
  },
  star: {
    color: "#F2A516",
    scale: 0.92,
    paths: [
      {
        d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
        fill: true,
      },
    ],
  },
  question: {
    color: "#8B5CF6",
    paths: [{ d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }, { d: "M12 17h.01" }],
  },
  check: {
    color: "#1F9D61",
    paths: [{ d: "M20 6 9 17l-5-5" }],
  },
  cross: {
    color: "#E5484D",
    paths: [{ d: "M18 6 6 18" }, { d: "m6 6 12 12" }],
  },
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** The white icon of a stamp kind, as an SVG element sized by its parent. */
export function createStampIconSvg(kind: BoardStampKind): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "#ffffff");
  svg.setAttribute("stroke-width", "2.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const p of STAMP_ART[kind].paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", p.d);
    if (p.fill) {
      // Solid glyphs are filled, not outlined: a stroke would fatten them
      // past the box their `scale` sized them for.
      path.setAttribute("fill", "#ffffff");
      path.setAttribute("stroke", "none");
    }
    svg.appendChild(path);
  }
  return svg;
}

/**
 * The stamper's colour, keyed on their stable user key so the same person
 * gets the same colour on every stamp and every device. The board plane is
 * pinned light in both app themes, so the light palette always applies.
 *
 * Deliberately NOT the peer-cursor key: cursors hash the Yorkie clientID,
 * which changes per tab and session, so a stamp keyed on it would change
 * colour on reload. A person's badge and live cursor can therefore differ.
 */
export function stamperColor(userKey: string): string {
  return getPeerCursorColor("light", userKey);
}

/** The first character of a display name, upper-cased, for the stamper badge. */
export function stamperInitial(name: unknown): string {
  const first = typeof name === "string" ? Array.from(name.trim())[0] : undefined;
  return first ? first.toUpperCase() : "?";
}

/** Below this screen size the stamper badge is too small to read. */
export const STAMP_BADGE_MIN_SIZE = 22;

/** How recent a stamp must be for its node to play the landing animation. */
export const STAMP_POP_WINDOW_MS = 2000;

/**
 * Whether a stamp node created now should play the landing animation: the
 * stamp was just placed (here or by a peer), not loaded with the board or
 * re-shown after a section was un-hidden.
 */
export function shouldPopStamp(at: number, now: number): boolean {
  return now - at >= -STAMP_POP_WINDOW_MS && now - at <= STAMP_POP_WINDOW_MS;
}
