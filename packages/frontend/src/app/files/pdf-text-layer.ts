/**
 * Geometry for the PDF selectable text layer.
 *
 * pdf.js positions each text span as a **percentage** of the page box taken
 * from `viewport.rawDims`, which is the *unrotated* viewBox and is therefore
 * independent of the viewport scale. Two things follow, and they are what
 * make a text layer cheap in a fluid, CSS-scaled viewer:
 *
 * 1. The layer is rendered once, at scale 1. Resizing never re-renders it —
 *    only `--total-scale-factor` changes, and it feeds nothing but font size.
 * 2. Because the span coordinate space is unrotated but the canvas beside it
 *    is rasterized through the page's `/Rotate`, a rotated page needs the
 *    layer sized to the *unrotated* box and rotated into place on top.
 *
 * We compute the box here rather than letting pdf.js's `setLayerDimensions`
 * do it: that helper emits
 * `round(down, var(--total-scale-factor) * Npx, var(--scale-round-x))`, and
 * `--scale-round-x` is defined only by the full pdf.js viewer stylesheet. In
 * this app the declaration would be invalid and silently dropped.
 */

/** The unrotated page box, in PDF user-space units (`viewport.rawDims`). */
export type RawPageDims = { width: number; height: number };

export type TextLayerBox = {
  /** Container width in CSS pixels — the *unrotated* page's width. */
  width: number;
  /** Container height in CSS pixels — the *unrotated* page's height. */
  height: number;
  /** `transform` placing the unrotated box over the rendered page, or "". */
  transform: string;
  /** Unrotated page units → CSS pixels. Drives `--total-scale-factor`. */
  scaleFactor: number;
};

/**
 * Place the text layer over a page rendered `displayWidth` CSS pixels wide.
 *
 * `rotation` is the page's own rotation as pdf.js reports it
 * (`viewport.rotation`, always normalized to 0/90/180/270). At 90 and 270 the
 * rendered page is the unrotated box turned on its side, so the layer's width
 * comes from the page's *height*.
 *
 * Each transform rotates about the container's top-left corner (the
 * stylesheet pins `transform-origin: 0 0`) and then translates the result
 * back into the positive quadrant, so the layer lands exactly on the canvas.
 */
export function textLayerBox(
  rotation: number,
  displayWidth: number,
  raw: RawPageDims,
): TextLayerBox {
  const turned = rotation === 90 || rotation === 270;
  // The unrotated page dimension that ends up along the screen's x axis.
  const acrossScreen = turned ? raw.height : raw.width;
  const scaleFactor = acrossScreen > 0 ? displayWidth / acrossScreen : 0;

  // The container always holds the unrotated page; the transform turns it.
  const width = raw.width * scaleFactor;
  const height = raw.height * scaleFactor;
  // The rendered page's on-screen box, which the transform must fill.
  const displayHeight = turned ? width : height;

  const px = (n: number) => `${n.toFixed(2)}px`;
  let transform = "";
  if (rotation === 90) {
    transform = `translateX(${px(displayWidth)}) rotate(90deg)`;
  } else if (rotation === 180) {
    transform = `translate(${px(displayWidth)}, ${px(displayHeight)}) rotate(180deg)`;
  } else if (rotation === 270) {
    transform = `translateY(${px(displayHeight)}) rotate(270deg)`;
  }

  return { width, height, transform, scaleFactor };
}

/** Write a computed box onto the layer element. */
export function applyTextLayerBox(el: HTMLElement, box: TextLayerBox): void {
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  el.style.transform = box.transform;
  el.style.setProperty("--total-scale-factor", String(box.scaleFactor));
}
