// packages/slides/src/view/canvas/shapes/preset/types.ts
//
// Data model for an ECMA-376 DrawingML preset shape definition
// (a `<a:custGeom>`-equivalent transcribed from
// `presetShapeDefinitions.xml`). The preset engine (`formula.ts` +
// `path.ts`) consumes these to produce a `Path2D`, so the bespoke
// hand-rolled builders can be replaced by faithful spec ports.
//
// Coordinates and lengths are guide *expressions* — a single token
// that the formula engine resolves (a guide name like `xF`, a
// built-in like `wd2`/`cd4`, or a numeric literal like `-5400000`).

/** One `<a:gd name= fmla=>` guide formula, evaluated in list order. */
export interface PresetGuide {
  name: string;
  /** Reverse-Polish formula, e.g. `"+- ss adj1 100000"`. */
  fmla: string;
}

/** A `<a:pt x= y=>` — each coordinate is a guide token. */
export interface PresetPt {
  x: string;
  y: string;
}

/** One path command (subset of DrawingML path commands we need). */
export type PresetCmd =
  | { t: 'move'; pt: PresetPt }
  | { t: 'line'; pt: PresetPt }
  /** `<a:arcTo wR hR stAng swAng>` — tokens, angles in 60000ths°. */
  | { t: 'arc'; wR: string; hR: string; stAng: string; swAng: string }
  | { t: 'quad'; c: PresetPt; pt: PresetPt }
  | { t: 'cubic'; c1: PresetPt; c2: PresetPt; pt: PresetPt }
  | { t: 'close' };

/** One `<a:path>`; `fill: 'none'` paths are outline-only (skipped). */
export interface PresetPath {
  /** OOXML `fill` attr; `'none'` ⇒ stroke-only outline, not filled. */
  fill?: string;
  cmds: PresetCmd[];
}

/** A complete preset shape geometry definition. */
export interface PresetShapeDef {
  /** `<a:avLst>` defaults keyed by `adj1`, `adj2`, … */
  adj: Record<string, number>;
  /** `<a:gdLst>` in evaluation order. */
  guides: PresetGuide[];
  /** `<a:pathLst>` filled sub-paths (the silhouette to fill). */
  paths: PresetPath[];
  /**
   * Optional `fill="none"` outline commands used for *stroking* only.
   * Some OOXML shapes (e.g. the curved arrows) compose their fill from
   * several sub-paths that share internal edges; stroking that union
   * would draw a seam across the shape. When present, this single
   * outline path traces the shape's true perimeter, so the renderer
   * fills `paths` but strokes `outline`. Left open (no `close`) — it
   * already returns to its start.
   */
  outline?: PresetCmd[];
}
