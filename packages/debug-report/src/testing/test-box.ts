/**
 * jsdom computes no layout: every `getBoundingClientRect` is zeroes, and every
 * locator here is about geometry. Stubbing the rect is what makes these tests
 * assert real behaviour instead of "it declined, as it does for everything".
 */
export type Box = { x: number; y: number; w: number; h: number };

export function withBox<T extends Element>(el: T, box: Box): T {
  el.getBoundingClientRect = () =>
    ({
      x: box.x,
      y: box.y,
      left: box.x,
      top: box.y,
      right: box.x + box.w,
      bottom: box.y + box.h,
      width: box.w,
      height: box.h,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

/** A host element with one canvas child, both measurable. */
export function hostWithCanvas(box: Box, canvasBox: Box = box): HTMLElement {
  const host = withBox(document.createElement('div'), box);
  const canvas = withBox(document.createElement('canvas'), canvasBox);
  host.appendChild(canvas);
  document.body.appendChild(host);
  return host;
}
