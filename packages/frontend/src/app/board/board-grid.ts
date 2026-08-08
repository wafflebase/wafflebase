import type { Viewport } from "@wafflebase/board";

/**
 * Background grid mode for the board canvas, mirroring Miro's three-state
 * `View > Grid` setting.
 */
export type BoardGridKind = "none" | "dot" | "line";

/** Grid on by default, matching Miro's out-of-the-box board. */
export const DEFAULT_GRID_KIND: BoardGridKind = "dot";

const STORAGE_KEY = "wafflebase.board.grid";

/**
 * Finest world-space step the ladder will pick. Below this the grid is
 * finer than anything a user places (the sticky note, the smallest default
 * object, is `STICKY_SIZE` = 180 world units = 9 cells) and reads as noise
 * when zoomed in.
 */
const MIN_STEP = 20;

/**
 * Minimum on-screen spacing (CSS px) between adjacent lines/dots. The
 * 1-2-5 ladder in {@link gridStep} keeps the real spacing inside
 * `[20, 50)` px — dense enough to judge position, sparse enough not to
 * turn into a grey wash.
 */
const MIN_SCREEN_STEP = 20;

/** In `line` mode every Nth line is darker, so cells stay countable. */
const MAJOR_EVERY = 5;

const COLORS = {
  light: {
    minor: "rgba(0, 0, 0, 0.08)",
    major: "rgba(0, 0, 0, 0.16)",
    // Dots carry far less ink than a line, so they need more contrast to
    // read at the same perceived weight.
    dot: "rgba(0, 0, 0, 0.22)",
  },
  dark: {
    minor: "rgba(255, 255, 255, 0.08)",
    major: "rgba(255, 255, 255, 0.16)",
    dot: "rgba(255, 255, 255, 0.22)",
  },
} as const;

/**
 * World-space distance between grid lines at the given zoom.
 *
 * Walks a 1-2-5 × 10^k ladder and returns the smallest step whose
 * on-screen spacing is at least {@link MIN_SCREEN_STEP}, floored at
 * {@link MIN_STEP}. Without this the grid would either vanish when zoomed
 * in or moiré into a solid block when zoomed out — a fixed step only looks
 * right at one scale, and a board spans the whole zoom range (0.1–8).
 *
 * Defensive against a non-finite or non-positive `zoom` (returns the floor)
 * so a corrupted viewport can never produce a `NaN` background-size that
 * silently blanks the grid.
 */
export function gridStep(zoom: number): number {
  const target = MIN_SCREEN_STEP / zoom;
  if (!Number.isFinite(target) || target <= MIN_STEP) return MIN_STEP;
  const decade = 10 ** Math.floor(Math.log10(target));
  const n = target / decade;
  const multiplier = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return Math.max(MIN_STEP, multiplier * decade);
}

/** The three CSS background properties that together paint the grid. */
export interface GridBackgroundStyle {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
}

/** Euclidean modulo — `%` alone keeps the sign of a negative pan. */
function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Map a board viewport onto the CSS background that paints its grid, or
 * `null` for `"none"`.
 *
 * The grid is painted by the canvas HOST element rather than the canvas
 * itself: board-mode `drawSlide` only `clearRect`s (it paints no slide-rect
 * background, because a board is an unbounded plane), so the host's
 * background shows through under every element. That keeps the grid out of
 * the slides renderer entirely — no per-frame stroke cost, and no risk of
 * it leaking into the minimap, which snapshots through the same `drawSlide`.
 *
 * Offsets are wrapped into `[0, size)` instead of being passed through raw.
 * A CSS background repeats every tile, so only the remainder matters — and
 * a board sitting far from the world origin (a Miro import routinely does)
 * would otherwise feed six-digit pixel offsets to the compositor on every
 * pan frame.
 */
export function gridBackgroundStyle(
  kind: BoardGridKind,
  viewport: Viewport,
  theme: "light" | "dark",
): GridBackgroundStyle | null {
  if (kind === "none") return null;

  const colors = COLORS[theme];
  const { panX, panY, zoom } = viewport;
  const size = gridStep(zoom) * zoom;

  if (kind === "dot") {
    // `radial-gradient` centres its circle in each tile, so shift the
    // tiling back by half a cell to land dots ON the grid intersections
    // rather than in the middle of the cells.
    const x = mod(panX - size / 2, size);
    const y = mod(panY - size / 2, size);
    return {
      backgroundImage: `radial-gradient(circle, ${colors.dot} 1px, transparent 1px)`,
      backgroundSize: `${size}px ${size}px`,
      backgroundPosition: `${x}px ${y}px`,
    };
  }

  const major = size * MAJOR_EVERY;
  const x = mod(panX, size);
  const y = mod(panY, size);
  const majorX = mod(panX, major);
  const majorY = mod(panY, major);
  return {
    // Major layers come first: earlier layers paint on top, so a major line
    // wins wherever it coincides with a minor one.
    backgroundImage: [
      `linear-gradient(to right, ${colors.major} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${colors.major} 1px, transparent 1px)`,
      `linear-gradient(to right, ${colors.minor} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${colors.minor} 1px, transparent 1px)`,
    ].join(", "),
    backgroundSize: [
      `${major}px ${major}px`,
      `${major}px ${major}px`,
      `${size}px ${size}px`,
      `${size}px ${size}px`,
    ].join(", "),
    backgroundPosition: [
      `${majorX}px ${majorY}px`,
      `${majorX}px ${majorY}px`,
      `${x}px ${y}px`,
      `${x}px ${y}px`,
    ].join(", "),
  };
}

/**
 * Write (or clear) the grid background on the canvas host. Separated from
 * {@link gridBackgroundStyle} so the mapping stays a pure function the
 * tests can drive without a DOM.
 */
export function applyGridBackground(
  host: HTMLElement,
  kind: BoardGridKind,
  viewport: Viewport,
  theme: "light" | "dark",
): void {
  const style = gridBackgroundStyle(kind, viewport, theme);
  host.style.backgroundImage = style?.backgroundImage ?? "";
  host.style.backgroundSize = style?.backgroundSize ?? "";
  host.style.backgroundPosition = style?.backgroundPosition ?? "";
}

function isGridKind(value: unknown): value is BoardGridKind {
  return value === "none" || value === "dot" || value === "line";
}

/**
 * The grid is a per-USER view preference, not board state — one
 * collaborator turning it on must not change anyone else's view (Miro
 * models it the same way). So it lives in `localStorage`, not in the
 * Yorkie document, which also means a read-only share-link viewer can
 * toggle it freely.
 */
export function loadGridKind(): BoardGridKind {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isGridKind(raw) ? raw : DEFAULT_GRID_KIND;
  } catch {
    // Storage can throw outright in private mode / with cookies blocked.
    return DEFAULT_GRID_KIND;
  }
}

export function saveGridKind(kind: BoardGridKind): void {
  try {
    localStorage.setItem(STORAGE_KEY, kind);
  } catch {
    // Losing a view-local preference is harmless — never break the board.
  }
}
