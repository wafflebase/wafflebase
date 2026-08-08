import type { Viewport } from "@wafflebase/board";

/**
 * Background grid mode for the board canvas, mirroring Miro's three-state
 * `View > Grid` setting.
 */
export type BoardGridKind = "none" | "dot" | "line";

/** Grid on by default, matching Miro's out-of-the-box board. */
export const DEFAULT_GRID_KIND: BoardGridKind = "dot";

/**
 * Snap to grid is OFF out of the box, unlike the grid display itself.
 *
 * The two settings are independent (Miro models them the same way), and
 * they carry different risk: showing lines changes nothing about a
 * board, while snapping changes where every subsequent drag lands. A
 * Miro-imported board's elements sit at arbitrary coordinates, so an
 * on-by-default snap would relocate them the first time anyone nudged
 * one — a surprise the user never asked for.
 */
export const DEFAULT_GRID_SNAP = false;

const STORAGE_KEY = "wafflebase.board.grid";
const SNAP_STORAGE_KEY = "wafflebase.board.grid-snap";

/**
 * Finest world-space step the ladder will pick. Below this the grid is
 * finer than anything a user places (the sticky note, the smallest default
 * object, is `STICKY_SIZE` = 180 world units = 9 cells) and reads as noise
 * when zoomed in.
 */
const MIN_STEP = 20;

/**
 * Minimum on-screen spacing (CSS px) between adjacent lines/dots.
 *
 * While zooming OUT the 1-2-5 ladder in {@link gridStep} keeps real
 * spacing inside `[20, 50)` px — dense enough to judge position, sparse
 * enough not to turn into a grey wash. Zooming IN past 1× the
 * {@link MIN_STEP} floor takes over instead and cells simply grow on
 * screen (160 px at 8×): the grid is a fixed WORLD-space reference, so
 * one cell must always mean the same distance.
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
 * {@link MIN_STEP}. Without this the grid would moiré into a solid block
 * as the board is zoomed out — a fixed step only looks right at one
 * scale, and a board spans the whole zoom range (0.1–8).
 *
 * Returns the floor for a non-finite or non-positive `zoom` rather than
 * propagating it. That alone does NOT keep the derived tile size finite
 * (the caller multiplies by `zoom` again) — {@link gridBackgroundStyle}
 * owns that guard.
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
  // `gridStep` already absorbs a corrupted zoom, but the multiplication
  // reintroduces it — `NaN` would emit `"NaNpx"` and `0` a tile the
  // browser never paints, either of which blanks the grid silently.
  const rawSize = gridStep(zoom) * zoom;
  const size = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : MIN_STEP;

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
 *
 * Runs on every pan/zoom frame and writes all four properties every time,
 * including the `backgroundImage` gradient list that a pan does not
 * change. Skipping the unchanged ones would mean either diffing against
 * `host.style` — which returns the CSSOM's RE-SERIALIZED value, not the
 * string that was written, so the comparison silently never matches — or
 * carrying per-element cache state. Four inline-style writes per frame is
 * far below the RAF loop's own canvas repaint; it is not worth either.
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
  // Explicit rather than inherited: the tiling is what makes one gradient
  // a grid, so this module owns it instead of relying on nothing else
  // ever setting `background-repeat` on the host.
  host.style.backgroundRepeat = style ? "repeat" : "";
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

/**
 * Whether move/resize quantize onto the grid. Stored under its own key,
 * separate from the display mode above, because the two are independent
 * toggles: "align my work but don't draw the lines" is a real preference,
 * and one collapsing into the other would make it unrepresentable.
 *
 * Per-user like the mode, and for the same reason — see
 * {@link loadGridKind}.
 */
export function loadGridSnap(): boolean {
  try {
    const raw = localStorage.getItem(SNAP_STORAGE_KEY);
    // Only the exact strings we write count. A missing key, and anything
    // else that ended up there, fall back to the default.
    if (raw === "true") return true;
    if (raw === "false") return false;
    return DEFAULT_GRID_SNAP;
  } catch {
    return DEFAULT_GRID_SNAP;
  }
}

export function saveGridSnap(snap: boolean): void {
  try {
    localStorage.setItem(SNAP_STORAGE_KEY, String(snap));
  } catch {
    // As above: a lost view preference must never break the board.
  }
}
