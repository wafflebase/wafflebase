/**
 * Deciding what a person meant when they aimed at something.
 *
 * Three measured rules govern this file, all from driving the spike by hand
 * (`docs/design/debug-report.md`, findings 3, 4 and 7):
 *
 *   - **Promote to the nearest control.** `elementFromPoint` returns the
 *     deepest node, which is routinely a glyph: aiming at the theme toggle
 *     resolved to `svg.lucide-sun` inside the button. Aiming at a control means
 *     the control.
 *   - **Never fall back to the container on a canvas.** With nothing meaningful
 *     to promote to, promotion grabs the wrapper and the capture becomes a
 *     1280×721 photograph of the whole sheet, which does not say WHICH CELL.
 *     On a canvas the answer comes from an engine locator, or from a small
 *     region around the cursor — never from the container.
 *   - **A region over pure DOM records the DOM under it.** On `/login` and
 *     `/harness/visual` (zero canvases) a region produced coordinates and
 *     nothing else. DOM is described rather than photographed — but the
 *     description has to actually happen, and that element list is the agent's
 *     only grep key into the source.
 */

import { rectsIntersect, type Point, type Rect } from '@wafflebase/core/geometry';
import type { DomElementRef, Target } from './types';

/**
 * What counts as something a person can mean.
 *
 * Interactive elements, labelled things, and anything the app itself marked as
 * significant (`data-testid` is a hook this repository already maintains for
 * its browser lanes, so reusing it costs nothing and points at real seams).
 */
export const MEANINGFUL_SELECTOR =
  'button, a, input, select, textarea, label, summary, [role], [data-testid], [aria-label], [contenteditable]';

/** How far up the tree promotion looks before giving up. */
const PROMOTE_DEPTH = 6;

/** How many ancestors a described selector may name. */
const SELECTOR_DEPTH = 4;

/** Text is a grep key, not a transcript. */
const TEXT_LIMIT = 120;

/** At most this many elements are listed for a DOM region. */
export const INVENTORY_LIMIT = 12;

/**
 * Elements inside a subtree marked with this attribute are never inventoried.
 *
 * The overlay is `position: fixed; inset: 0` and carries a test id, so it
 * matches `MEANINGFUL_SELECTOR` and intersects every possible region — every
 * DOM report came back partly describing the reporting tool, and with a capped
 * list it could displace real controls.
 */
export const EXCLUDE_ATTR = 'data-wb-debug';

const boxOfElement = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/** Injected in tests: jsdom reports every `getBoundingClientRect` as zeroes. */
export type BoxOf = (el: Element) => Rect;

/**
 * The element a person MEANT when they aimed at `el`.
 *
 * Returns `el` itself when nothing meaningful is within reach, so the caller
 * decides what to do about that — on a canvas surface the answer is "nothing",
 * which is why this does not decide it here.
 */
export function promote(el: Element, depth = PROMOTE_DEPTH): Element {
  let node: Element | null = el;
  for (let i = 0; node && i < depth; i += 1) {
    if (node.matches(MEANINGFUL_SELECTOR)) return node;
    node = node.parentElement;
  }
  return el;
}

/** Whether promotion actually found something, rather than falling through. */
export function isMeaningful(el: Element): boolean {
  return el.matches(MEANINGFUL_SELECTOR);
}

/**
 * The largest share of the viewport a named target may cover.
 *
 * Measured in a browser: aiming near the top-left of the hunt harness promoted
 * to `main[data-testid="hunt-harness-root"]` — a page-sized element that matches
 * `MEANINGFUL_SELECTOR` because it carries a test id — and produced a 1280×800,
 * 61 KB photograph of the whole page. That is the same failure SP0's fourth
 * finding is about (a capture of everything says nothing about anything),
 * reached through promotion instead of through a canvas container.
 */
export const MAX_TARGET_VIEWPORT_FRACTION = 0.6;

/**
 * Whether a target's box is small enough to BE a target.
 *
 * SINGLE PURPOSE, deliberately: this rejects things that are too BIG and
 * nothing else. An unmeasurable box — zero-sized because layout has not
 * settled, or because the environment computes none — passes, because turning
 * "not measured" into "not reportable" would silently downgrade every DOM pick
 * to a region and the reporter would never learn why.
 */
export function isPlausibleTarget(
  box: { w: number; h: number },
  viewport: { w: number; h: number },
  fraction = MAX_TARGET_VIEWPORT_FRACTION,
): boolean {
  const area = box.w * box.h;
  const viewportArea = viewport.w * viewport.h;
  if (!Number.isFinite(area) || area <= 0) return true;
  if (viewportArea <= 0) return true;
  return area / viewportArea <= fraction;
}

/**
 * A short, readable path to `el`.
 *
 * Not claimed to be stable across builds — Tailwind class soup is not an
 * identity. It is a hint for a person reading the report and a starting point
 * for an agent that will confirm against the source, which is why the text
 * excerpt matters more than this does.
 */
export function describeSelector(el: Element, depth = SELECTOR_DEPTH): string {
  const parts: string[] = [];
  let node: Element | null = el;
  for (let i = 0; node && i < depth; i += 1) {
    if (node.id) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const testId = node.getAttribute('data-testid');
    if (testId) {
      parts.unshift(`[data-testid="${testId}"]`);
      break;
    }
    // `html` and `body` are on every page and identify nothing, so the path
    // stops below them rather than spending two of its four slots saying so.
    if (node === document.body || node === document.documentElement) break;
    // Utility classes that only describe a state (`hover:`, `md:`) or carry
    // bracket syntax say nothing about identity and make the path unreadable.
    const cls = Array.from(node.classList)
      .filter((c) => !c.includes(':') && !c.includes('[') && !c.startsWith('_'))
      .slice(0, 2)
      .join('.');
    const tag = node.tagName.toLowerCase();
    parts.unshift(cls ? `${tag}.${cls}` : tag);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

/** Visible text, trimmed and truncated. The agent's grep key. */
export function textExcerpt(el: Element, limit = TEXT_LIMIT): string | undefined {
  const raw = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (raw.length === 0) return undefined;
  return raw.length > limit ? `${raw.slice(0, limit)}…` : raw;
}

/** The nearest `data-testid`, on the element or an ancestor within reach. */
export function nearestTestId(el: Element, depth = PROMOTE_DEPTH): string | undefined {
  let node: Element | null = el;
  for (let i = 0; node && i < depth; i += 1) {
    const id = node.getAttribute('data-testid');
    if (id) return id;
    node = node.parentElement;
  }
  return undefined;
}

/** Describe one element as a report names it. */
export function describeElement(el: Element, boxOf: BoxOf = boxOfElement): DomElementRef {
  return {
    selector: describeSelector(el),
    tag: el.tagName.toLowerCase(),
    ...(textExcerpt(el) ? { text: textExcerpt(el) } : {}),
    rect: boxOf(el),
  };
}

/** A DOM target for one element. */
export function domTarget(el: Element, boxOf: BoxOf = boxOfElement): Target {
  const testId = nearestTestId(el);
  const text = textExcerpt(el);
  return {
    kind: 'dom',
    selector: describeSelector(el),
    tag: el.tagName.toLowerCase(),
    ...(testId ? { testId } : {}),
    ...(text ? { text } : {}),
    rect: boxOf(el),
  };
}

export type CanvasBox = { box: Rect };

/** Whether `point` lands on a canvas — which routes the pick away from the DOM. */
export function onCanvas(point: Point, canvases: readonly CanvasBox[]): boolean {
  return canvases.some(
    ({ box }) =>
      box.w > 0 &&
      box.h > 0 &&
      point.x >= box.x &&
      point.x <= box.x + box.w &&
      point.y >= box.y &&
      point.y <= box.y + box.h,
  );
}

/**
 * The meaningful elements under `rect`, most specific first.
 *
 * Ordered by area ascending because the small ones say more: a report about a
 * cramped icon row wants the buttons, not the page shell that also intersects.
 * Capped, because an unbounded list of a hundred elements is not a description.
 */
export function domInventory(
  rect: Rect,
  options: {
    root?: ParentNode;
    boxOf?: BoxOf;
    limit?: number;
    selector?: string;
  } = {},
): DomElementRef[] {
  const root = options.root ?? document;
  const boxOf = options.boxOf ?? boxOfElement;
  const limit = options.limit ?? INVENTORY_LIMIT;

  const candidates = Array.from(
    root.querySelectorAll(options.selector ?? MEANINGFUL_SELECTOR),
  )
    .filter((el) => !el.closest(`[${EXCLUDE_ATTR}]`))
    .map((el) => ({ el, box: boxOf(el) }))
    .filter(
      ({ box }) => box.w > 0 && box.h > 0 && rectsIntersect(box, rect),
    )
    .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)
    .slice(0, limit);

  return candidates.map(({ el, box }) => ({
    selector: describeSelector(el),
    tag: el.tagName.toLowerCase(),
    ...(textExcerpt(el) ? { text: textExcerpt(el) } : {}),
    rect: box,
  }));
}

/**
 * A small region around a point, used where a pick cannot name anything.
 *
 * This is the canvas fallback: rather than photographing the whole surface
 * (measured at 1280×721 and 81 KB, and useless for "which cell?"), take a box
 * the size of a few cells around the cursor. Clamped to the viewport so a pick
 * near an edge does not produce a capture that is mostly nothing.
 */
export function regionAround(
  point: Point,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
): Rect {
  const w = Math.min(size.w, viewport.w);
  const h = Math.min(size.h, viewport.h);
  return {
    x: Math.max(0, Math.min(point.x - w / 2, viewport.w - w)),
    y: Math.max(0, Math.min(point.y - h / 2, viewport.h - h)),
    w,
    h,
  };
}

/** Default size of that fallback region: a few sheet cells across. */
export const FALLBACK_REGION = { w: 240, h: 120 };
