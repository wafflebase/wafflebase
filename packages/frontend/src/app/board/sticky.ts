import {
  type ElementInit,
  type Frame,
  type Point,
  type SlidesStore,
  type SlidesEditor,
  makeDefaultSlidesTextBlock,
} from '@wafflebase/slides';
import {
  SYNTHETIC_SLIDE_ID,
  type Viewport,
  screenToWorld,
} from '@wafflebase/board';

/**
 * Six pastel sticky fills. Kept light so the default dark slides text
 * color stays legible on top — a sticky is a preset `roundRect` shape,
 * not a distinct element type, so it inherits the shape text renderer.
 */
export const STICKY_COLORS: readonly { name: string; value: string }[] = [
  { name: 'Yellow', value: '#FFF8B8' },
  { name: 'Green', value: '#CDEFC4' },
  { name: 'Blue', value: '#C7E5FF' },
  { name: 'Pink', value: '#FFD6E7' },
  { name: 'Orange', value: '#FFE0B2' },
  { name: 'Purple', value: '#E5D4FF' },
];

/** Square sticky side length, in board world px. */
export const STICKY_SIZE = 180;

/**
 * Build the `ElementInit` for a sticky note: a `roundRect` shape with a
 * solid srgb fill, a soft drop shadow, and a middle-anchored,
 * shrink-autofit, center-aligned text body, centered on `center`.
 *
 * The text body is seeded (rather than left absent for lazy creation)
 * so the sticky's middle/shrink/center layout applies to the first
 * keystroke — `withShapeText` preserves an existing `data.text` and only
 * synthesizes a bare one (top-anchored, grow) when none exists.
 */
export function buildStickyInit(colorValue: string, center: Point): ElementInit {
  const block = makeDefaultSlidesTextBlock();
  block.style = { ...block.style, alignment: 'center' };
  return {
    type: 'shape',
    frame: {
      x: center.x - STICKY_SIZE / 2,
      y: center.y - STICKY_SIZE / 2,
      w: STICKY_SIZE,
      h: STICKY_SIZE,
      rotation: 0,
    },
    data: {
      kind: 'roundRect',
      fill: { kind: 'srgb', value: colorValue },
      effects: {
        shadow: {
          color: '#000000',
          opacity: 0.18,
          angle: Math.PI / 2, // straight down
          distance: 3,
          blur: 8,
        },
      },
      text: {
        blocks: [block],
        verticalAnchor: 'middle',
        autofit: 'shrink',
      },
    },
  } as ElementInit;
}

/** Space left between a new sticky and the one it steps away from. */
export const STICKY_GAP = 24;

/** How many sticky-widths to walk right before giving up on a free spot. */
const MAX_STEPS = 20;

function overlaps(a: Frame, b: Frame): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Where a new sticky aimed at `center` should actually go: `center` itself
 * when that square is free, otherwise the first free square stepping
 * right by one sticky plus {@link STICKY_GAP}.
 *
 * Without this every sticky from the toolbar lands on the exact viewport
 * centre, so the second one covers the first completely and reads as the
 * first having vanished. Stepping right rather than diagonally lays a
 * burst of notes out as a row, which is what a brainstorm wants, and it
 * keeps going right from whatever is already there. Rotation is ignored:
 * an axis-aligned test is enough to avoid a full cover, which is the
 * failure this exists for.
 *
 * Falls back to `center` after {@link MAX_STEPS} so a dense board never
 * throws a note off-screen.
 */
export function freeStickyCenter(occupied: readonly Frame[], center: Point): Point {
  const step = STICKY_SIZE + STICKY_GAP;
  for (let i = 0; i <= MAX_STEPS; i++) {
    const candidate = { x: center.x + i * step, y: center.y };
    const box: Frame = {
      x: candidate.x - STICKY_SIZE / 2,
      y: candidate.y - STICKY_SIZE / 2,
      w: STICKY_SIZE,
      h: STICKY_SIZE,
      rotation: 0,
    };
    if (!occupied.some((f) => overlaps(f, box))) return candidate;
  }
  return center;
}

export interface DropStickyDeps {
  store: SlidesStore;
  editor: SlidesEditor;
  viewport: Viewport;
  hostWidth: number;
  hostHeight: number;
  colorValue: string;
  /** Frames already on the board; the sticky steps off any it would cover. */
  occupied?: readonly Frame[];
}

/**
 * Drop a sticky at the current viewport center — or the nearest free spot
 * to its right ({@link freeStickyCenter}) — select it, and enter text-edit
 * so the user can type immediately. One `batch` = one undo unit. Returns
 * the new element id.
 */
export function dropStickyAtViewportCenter(deps: DropStickyDeps): string {
  const { store, editor, viewport, hostWidth, hostHeight, colorValue } = deps;
  const center = freeStickyCenter(
    deps.occupied ?? [],
    screenToWorld(viewport, { x: hostWidth / 2, y: hostHeight / 2 }),
  );
  let id = '';
  store.batch(() => {
    id = store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit(colorValue, center));
  });
  editor.setSelection([id]);
  editor.enterTextEditing(id);
  return id;
}
