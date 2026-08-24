/**
 * One point in, one target out — the routing between the DOM path and the
 * engine path.
 *
 * The rules encoded here are all measured (`docs/design/debug-report.md`):
 *
 *   - On a canvas, ask the engine. Never promote to the container: with nothing
 *     meaningful above it, promotion grabs the wrapper and the capture becomes a
 *     1280×721 photograph of the whole sheet, which does not say which cell.
 *   - When the engine cannot answer, degrade to a small region around the
 *     cursor. It says less; it says nothing false.
 *   - Off the canvas, promote to the nearest control, because
 *     `elementFromPoint` returns the deepest node and aiming at a control means
 *     the control, not the glyph inside it.
 */

import {
  canvasLayers,
  domTarget,
  FALLBACK_REGION,
  isMeaningful,
  isPlausibleTarget,
  onCanvas,
  promote,
  regionAround,
  type Point,
  type Target,
} from "../index";
export type LocateOptions = {
  /**
   * Point → semantic address, for a Canvas surface.
   *
   * INJECTED, because only the mounted engine can answer "which cell" and this
   * package must not know which engines exist. A host that has none omits it and
   * every canvas point falls back to a region, which is the correct answer for a
   * surface nothing can interrogate.
   */
  locateOnCanvas?: (point: Point) => Target | undefined;
  /** Injected in tests, where jsdom has neither canvases nor layout. */
  elementAt?: (x: number, y: number) => Element | null;
  layers?: ReadonlyArray<{ box: { x: number; y: number; w: number; h: number } }>;
  viewport?: { w: number; h: number };
};

/**
 * The element under a point, or `undefined`.
 *
 * Guarded because `elementFromPoint` is not universally implemented — jsdom
 * throws outright — and an exception here would make the capture key do NOTHING
 * with no explanation, which is the one failure mode this feature cannot have.
 * A missing element is a normal answer: the point becomes a region instead.
 */
function elementAt(
  point: Point,
  injected: LocateOptions['elementAt'],
): Element | null {
  try {
    return injected
      ? injected(point.x, point.y)
      : document.elementFromPoint(point.x, point.y);
  } catch {
    return null;
  }
}

/**
 * The target a person meant by aiming at `point`.
 *
 * Never returns `undefined`: every point resolves to something recordable, so a
 * capture keystroke can never be a no-op the reporter cannot explain. The
 * question is only how much meaning came with it — an address, an element, or
 * just a region.
 */
export function locatePoint(point: Point, options: LocateOptions = {}): Target {
  const layers = options.layers ?? canvasLayers();
  const viewport =
    options.viewport ??
    (typeof window === "undefined"
      ? { w: 0, h: 0 }
      : { w: window.innerWidth, h: window.innerHeight });

  // THE HIT-TEST COMES FIRST, and the order is load-bearing. Asking `onCanvas`
  // first makes every control that floats OVER a canvas unreachable: the sheet
  // parks its filter panel, list and date popovers, validation tooltip, cell
  // input and DOM chart overlays inside the grid's box, so aiming at the filter
  // dropdown to report "this panel is misaligned" would have named `Sheet1!D3`
  // and attached a picture of one cell. The control would appear nowhere in the
  // report, leaving the agent with no grep key at all.
  const hit = elementAt(point, options.elementAt);
  const promoted = hit ? promote(hit) : null;
  if (
    promoted &&
    // A canvas is not a DOM answer even when the hit-test returns one: "which
    // cell" lives in the engine, and that is the next branch's job.
    promoted.tagName !== "CANVAS" &&
    isMeaningful(promoted)
  ) {
    const target = domTarget(promoted);
    // A page shell that happens to carry a test id matches the promotion
    // selector but is not what anyone aimed at, and naming it produces a
    // photograph of the whole viewport. Measured: `main[data-testid]` at
    // 1280×800 and 61 KB.
    if (isPlausibleTarget(target.rect, viewport)) return target;
  }

  if (onCanvas(point, layers)) {
    const located = options.locateOnCanvas?.(point);
    if (located) return located;
  }

  // Nothing worth naming, no engine that could answer: describe the region
  // rather than pretending a `div` three levels up was the thing reported, or
  // photographing the whole surface.
  return { kind: "viewport", rect: regionAround(point, FALLBACK_REGION, viewport) };
}
