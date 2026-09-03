import { describe, expect, it } from "vitest";

import { applyTextLayerBox, textLayerBox } from "../pdf-text-layer.ts";

// US Letter at 72dpi — portrait, so width < height.
const LETTER = { width: 612, height: 792 };

describe("textLayerBox", () => {
  it("fills the rendered page and scales it, unrotated", () => {
    const box = textLayerBox(0, 1000, LETTER);

    expect(box.scaleFactor).toBeCloseTo(1000 / 612);
    expect(box.width).toBeCloseTo(1000);
    expect(box.height).toBeCloseTo(1000 * (792 / 612));
    expect(box.transform).toBe("");
  });

  it("holds the unrotated page and turns it, at 90 degrees", () => {
    // The page is rendered on its side, so 1000px of screen width shows the
    // page's 792pt height.
    const box = textLayerBox(90, 1000, LETTER);

    expect(box.scaleFactor).toBeCloseTo(1000 / 792);
    // The container stays the unrotated page: 612 wide, 792 tall, scaled.
    expect(box.width).toBeCloseTo(612 * (1000 / 792));
    expect(box.height).toBeCloseTo(1000);
    expect(box.transform).toBe("translateX(1000.00px) rotate(90deg)");
  });

  it("translates by both axes at 180 degrees", () => {
    const box = textLayerBox(180, 1000, LETTER);
    const displayHeight = 1000 * (792 / 612);

    expect(box.scaleFactor).toBeCloseTo(1000 / 612);
    expect(box.transform).toBe(
      `translate(1000.00px, ${displayHeight.toFixed(2)}px) rotate(180deg)`,
    );
  });

  it("translates down only at 270 degrees", () => {
    const box = textLayerBox(270, 1000, LETTER);
    // Rendered box is 1000 wide; its height is the page's width, scaled.
    const displayHeight = 612 * (1000 / 792);

    expect(box.transform).toBe(
      `translateY(${displayHeight.toFixed(2)}px) rotate(270deg)`,
    );
  });

  // The real contract: whatever the rotation, the transform must land the
  // unrotated container exactly on the rendered page. Anything else shows up
  // as selection drifting off the glyphs — the classic OCR-viewer complaint.
  it.each([0, 90, 180, 270])(
    "places the layer flush on the rendered page at %i degrees",
    (rotation) => {
      const displayWidth = 1000;
      const box = textLayerBox(rotation, displayWidth, LETTER);
      const turned = rotation === 90 || rotation === 270;
      const displayHeight = turned ? box.width : box.height;

      const placed = placeCorners(box, rotation);

      expect(Math.min(...placed.map((p) => p.x))).toBeCloseTo(0);
      expect(Math.min(...placed.map((p) => p.y))).toBeCloseTo(0);
      expect(Math.max(...placed.map((p) => p.x))).toBeCloseTo(displayWidth);
      expect(Math.max(...placed.map((p) => p.y))).toBeCloseTo(displayHeight);
    },
  );

  it("degrades to zero rather than dividing by a zero-width page", () => {
    const box = textLayerBox(0, 1000, { width: 0, height: 0 });
    expect(box.scaleFactor).toBe(0);
    expect(Number.isFinite(box.width)).toBe(true);
  });
});

/**
 * Apply the box's own emitted `transform` to the container's four corners,
 * about the `transform-origin: 0 0` the stylesheet pins. Reads the translate
 * back out of the CSS string rather than recomputing it, so a wrong string is
 * a failing test rather than a matching mistake on both sides.
 */
function placeCorners(
  box: { width: number; height: number; transform: string },
  rotation: number,
) {
  const [tx = 0, ty = 0] = (box.transform.match(/-?\d+\.?\d*(?=px)/g) ?? []).map(
    Number,
  );
  // `translateY(Npx)` carries its single value on the y axis, not the x.
  const isTranslateY = box.transform.startsWith("translateY");
  const dx = isTranslateY ? 0 : tx;
  const dy = isTranslateY ? tx : ty;

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return [
    [0, 0],
    [box.width, 0],
    [0, box.height],
    [box.width, box.height],
  ].map(([x = 0, y = 0]) => ({
    x: x * cos - y * sin + dx,
    y: x * sin + y * cos + dy,
  }));
}

describe("applyTextLayerBox", () => {
  it("writes size, transform, and the one scale variable pdf.js reads", () => {
    const el = document.createElement("div");

    applyTextLayerBox(el, textLayerBox(0, 1000, LETTER));

    expect(el.style.width).toBe("1000px");
    // Spans are positioned in percentages; this variable is the only thing
    // carrying the render scale, so font size tracks the page.
    expect(el.style.getPropertyValue("--total-scale-factor")).toBe(
      String(1000 / 612),
    );
    expect(el.style.transform).toBe("");
  });

  it("clears a stale transform when a page is re-placed", () => {
    const el = document.createElement("div");

    applyTextLayerBox(el, textLayerBox(90, 1000, LETTER));
    expect(el.style.transform).not.toBe("");

    applyTextLayerBox(el, textLayerBox(0, 1000, LETTER));
    expect(el.style.transform).toBe("");
  });
});
