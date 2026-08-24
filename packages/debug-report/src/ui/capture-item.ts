/**
 * Assembling one report: what was aimed at, and what it looked like.
 *
 * Kept out of the React component because this is the part with rules in it —
 * which target a point resolves to, which pixels go with it, what happens when
 * the capture budget refuses. The component's job is to render the result and
 * take a sentence.
 */

import {
  captureRegionFromDom,
  domInventory,
  type Capture,
  type CaptureStore,
  type DebugSession,
  type Point,
  type Rect,
  type Target,
} from "../index";
import { locatePoint, type LocateOptions } from "./locate";

/** A target with its evidence, ready for a sentence. */
export type PendingReport = {
  target: Target;
  capture?: Capture;
  /** Captures the budget dropped to make room for this one. Never silent. */
  evicted: string[];
  /** Set when pixels were expected but could not be stored. */
  captureProblem?: "too-large" | "write-failed";
};

export type CaptureDeps = {
  store: CaptureStore;
  /** Injected in tests: jsdom has no 2-D context and no layout. */
  capturePixels?: typeof captureRegionFromDom;
  inventory?: typeof domInventory;
  locate?: (point: Point, options?: LocateOptions) => Target;
};

/**
 * A DOM region gets an element list rather than pixels.
 *
 * Measured on `/login` and `/harness/visual`, both canvas-free: a region there
 * produced an item with no capture, no selector and no text — coordinates and
 * nothing else, which no agent can act on. Photographing the DOM is still
 * rejected (it would mean an `html2canvas`-class dependency, and a selector plus
 * a text excerpt describes a node better than pixels do), so the description has
 * to carry the weight (`docs/design/debug-report.md`, finding 7).
 */
function withInventory(
  target: Target,
  inventory: typeof domInventory,
): Target {
  if (target.kind !== "viewport" || target.elements) return target;
  const elements = inventory(target.rect);
  return elements.length > 0 ? { ...target, elements } : target;
}

async function attachCapture(
  rect: Rect,
  deps: CaptureDeps,
): Promise<Pick<PendingReport, "capture" | "evicted" | "captureProblem">> {
  const pixels = (deps.capturePixels ?? captureRegionFromDom)(rect);
  if (!pixels) return { evicted: [] };

  const stored = await deps.store.putCapture({
    dataUrl: pixels.dataUrl,
    w: pixels.w,
    h: pixels.h,
    layers: pixels.layers,
    mime: pixels.mime,
  });
  return stored.ok
    ? { capture: stored.capture, evicted: stored.evicted }
    : { evicted: stored.evicted, captureProblem: stored.reason };
}

/**
 * Capture whatever is under `point`.
 *
 * This is what the capture KEY runs. It reads the page and never touches the
 * pointer, which is the whole reason a hover tooltip, an open menu or a drag in
 * progress survives being reported (`docs/design/debug-report.md`, finding 5).
 */
export async function captureAtPoint(
  point: Point,
  deps: CaptureDeps,
  options: LocateOptions = {},
): Promise<PendingReport> {
  const target = withInventory(
    (deps.locate ?? locatePoint)(point, options),
    deps.inventory ?? domInventory,
  );
  // A DOM TARGET IS NEVER PHOTOGRAPHED. Its box routinely overlaps an editor
  // canvas — a side panel, a docs toolbar control — and capturing there would
  // paint whatever share of that canvas lies under the control and fill the
  // rest, producing an image with no button in it. The selector, the box and the
  // text excerpt are the description, and they are a better one.
  if (target.kind === "dom") return { target, evicted: [] };
  return { target, ...(await attachCapture(target.rect, deps)) };
}

/** Capture a dragged rectangle. */
export async function captureRegion(
  rect: Rect,
  deps: CaptureDeps,
): Promise<PendingReport> {
  const pixels = await attachCapture(rect, deps);
  // A region with pixels is described by them; one without is described by the
  // elements it covers.
  const target: Target = pixels.capture
    ? { kind: "viewport", rect }
    : withInventory({ kind: "viewport", rect }, deps.inventory ?? domInventory);
  return { target, ...pixels };
}

/**
 * Forget the captures the budget evicted.
 *
 * The store deletes the blobs; nothing else was clearing the `capture` metadata
 * that pointed at them, so `items()` — which the badge, the panel and the bundle
 * all read — went on claiming images that were gone. The store's own contract is
 * that an eviction is never silent, and a reporter confirming a bundle whose
 * pixels have quietly vanished is exactly what that forbids.
 *
 * Returns the notes whose evidence was dropped, so the panel can name them
 * rather than only counting them.
 */
export function forgetEvictedCaptures(
  session: Pick<DebugSession, "items" | "update">,
  evicted: readonly string[],
): string[] {
  if (evicted.length === 0) return [];
  const gone = new Set(evicted);
  const affected: string[] = [];
  for (const item of session.items()) {
    if (!item.capture || !gone.has(item.capture.id)) continue;
    affected.push(item.note);
    session.update(item.id, { capture: undefined });
  }
  return affected;
}

/** What the panel says about a capture that did not survive. */
export function captureProblemMessage(
  problem: PendingReport["captureProblem"],
): string | undefined {
  if (problem === "too-large") {
    return "The image was larger than the whole capture budget, so it was not stored. The note is kept.";
  }
  if (problem === "write-failed") {
    return "The image could not be stored (browser storage refused it). The note is kept.";
  }
  return undefined;
}
