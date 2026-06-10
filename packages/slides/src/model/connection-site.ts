export type ConnectionSite = {
  /** Normalized [0, 1], pre-rotation, in the source element's local bbox. */
  x: number;
  /** Normalized [0, 1], pre-rotation. */
  y: number;
  /** Outward normal angle in radians (canvas convention: 0 = +x). */
  angle: number;
};

/** Outward-normal direction constants (canvas convention). */
export const DIR_E = 0;
export const DIR_S = Math.PI / 2;
export const DIR_W = Math.PI;
export const DIR_N = -Math.PI / 2;
/** Diagonal outward-normal constants — used by ellipse / oval connection sites. */
export const DIR_NE = -Math.PI / 4;
export const DIR_SE = Math.PI / 4;
export const DIR_SW = (3 * Math.PI) / 4;
export const DIR_NW = (-3 * Math.PI) / 4;
