import {
  MemSlidesStore,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  SlideRenderer,
} from './src/index';

const HOST_W = 960;
const HOST_H = 540;
const DPR = window.devicePixelRatio || 1;

const canvas = document.getElementById('slide') as HTMLCanvasElement;
canvas.width = HOST_W * DPR;
canvas.height = HOST_H * DPR;
canvas.style.width = `${HOST_W}px`;
canvas.style.height = `${HOST_H}px`;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('No 2D context');

// Build a sample deck via the public API only — exercises slide ops,
// element ops, all four shape kinds, the text renderer (via docs
// computeLayout), and an image element. The image src is a transparent
// 1x1 data URL so it loads synchronously; subsequent phases will swap
// in real workspace images.

const store = new MemSlidesStore();
store.batch(() => {
  const slideId = store.addSlide('blank');

  // Title text
  store.addElement(slideId, {
    type: 'text',
    frame: {
      x: 80, y: 80,
      w: SLIDE_WIDTH - 160,
      h: 200,
      rotation: 0,
    },
    data: {
      blocks: [{
        id: 't1', type: 'paragraph',
        inlines: [
          { text: 'Phase 2 ', style: { fontSize: 48, bold: true, color: '#222' } },
          { text: 'demo', style: { fontSize: 48, italic: true, color: '#3a7' } },
        ],
        style: {},
      } as never],
    },
  });

  // Body text
  store.addElement(slideId, {
    type: 'text',
    frame: { x: 80, y: 320, w: 900, h: 200, rotation: 0 },
    data: {
      blocks: [{
        id: 't2', type: 'paragraph',
        inlines: [
          { text: 'Shapes, text, and images all render through @wafflebase/slides.',
            style: { fontSize: 18, color: '#444' } },
        ],
        style: {},
      } as never],
    },
  });

  // Filled rectangle
  store.addElement(slideId, {
    type: 'shape',
    frame: { x: 1040, y: 80, w: 320, h: 200, rotation: 0 },
    data: { kind: 'rect', fill: '#3a7' },
  });

  // Stroked ellipse
  store.addElement(slideId, {
    type: 'shape',
    frame: { x: 1400, y: 80, w: 240, h: 200, rotation: 0 },
    data: { kind: 'ellipse', stroke: { color: '#a33', width: 8 } },
  });

  // Rotated arrow
  store.addElement(slideId, {
    type: 'shape',
    frame: {
      x: 1040, y: 340, w: 600, h: 60,
      rotation: -Math.PI / 8,
    },
    data: {
      kind: 'arrow',
      stroke: { color: '#222', width: 6 },
      fill: '#222',
    },
  });

  // Plain line
  store.addElement(slideId, {
    type: 'shape',
    frame: { x: 1040, y: 540, w: 600, h: 0, rotation: 0 },
    data: { kind: 'line', stroke: { color: '#888', width: 2 } },
  });

  // Image placeholder — a 1x1 transparent PNG so the load is
  // synchronous in browsers.
  store.addElement(slideId, {
    type: 'image',
    frame: { x: 80, y: 600, w: 400, h: 300, rotation: 0 },
    data: {
      src:
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3">` +
          `<rect width="4" height="3" fill="%23eef"/>` +
          `<text x="2" y="1.7" text-anchor="middle" font-size="0.4" fill="%2399b">image</text>` +
          `</svg>`,
        ),
      alt: 'placeholder',
    },
  });
});

const slide = store.read().slides[0];

const renderer = new SlideRenderer(ctx, {
  hostWidth: HOST_W,
  hostHeight: HOST_H,
  dpr: DPR,
});
renderer.render(slide);

// Note: the SVG image loads via getOrLoadImage's async path. The
// renderer schedules a re-render via markDirty when the load fires;
// we re-call render() on requestAnimationFrame so the dirty repaint
// actually happens. (Phase 3's editor wires this through its own
// scheduler.)
function tick(): void {
  renderer.render(slide);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Used by the testing harness to assert the demo started without
// errors. Safe to ignore.
(window as unknown as { __slidesDemoReady?: boolean }).__slidesDemoReady = true;

// Suppress "unused" warning for SLIDE_HEIGHT — it's only here for
// downstream demos that want to extend the fixture below the visible
// area.
void SLIDE_HEIGHT;
