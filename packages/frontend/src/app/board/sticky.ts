import {
  type Element,
  type ElementInit,
  type Frame,
  type Point,
  type SlidesStore,
  type SlidesEditor,
  makeDefaultSlidesTextBlock,
} from '@wafflebase/slides';
import {
  STICKY_SHADOW,
  SYNTHETIC_SLIDE_ID,
  isStickyData,
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

/**
 * Whether an element is a sticky note. A sticky is a preset `roundRect`
 * shape rather than its own type, so this reads the preset's signature —
 * see `isStickyData` (`@wafflebase/board`), which the Miro importer's
 * stickies also carry.
 */
export function isStickyElement(el: Element | undefined): boolean {
  return el?.type === 'shape' && isStickyData(el.data);
}

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
      effects: { shadow: { ...STICKY_SHADOW } },
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

/** How many sticky-widths to walk each way before giving up on a free spot. */
const MAX_STEPS = 10;

function overlaps(a: Frame, b: Frame): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(outer: Frame, inner: Frame): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function stickyBox(center: Point): Frame {
  return {
    x: center.x - STICKY_SIZE / 2,
    y: center.y - STICKY_SIZE / 2,
    w: STICKY_SIZE,
    h: STICKY_SIZE,
    rotation: 0,
  };
}

/**
 * Where a new sticky aimed at `center` should actually go: `center` itself
 * when that square is free, otherwise the nearest free square along the
 * same row, one sticky plus {@link STICKY_GAP} at a time — right first,
 * then left, then two to the right, and so on.
 *
 * Without this every sticky from the toolbar lands on the exact viewport
 * centre, so the second one covers the first completely and reads as the
 * first having vanished. Walking the row lays a burst of notes out the way
 * a brainstorm wants. Rotation is ignored: an axis-aligned test is enough
 * to avoid a full cover, which is the failure this exists for.
 *
 * When `visible` (the on-screen world rect) is given, a square is only
 * taken if it lies wholly inside it: the new sticky enters text edit
 * straight away, and typing into a note the user cannot see is worse than
 * a partial overlap. With no free visible square, the sticky is nudged one
 * gap down and right of `center` — overlapping, but never an exact cover.
 */
export function freeStickyCenter(
  occupied: readonly Frame[],
  center: Point,
  visible?: Frame,
): Point {
  const step = STICKY_SIZE + STICKY_GAP;
  for (let i = 0; i <= MAX_STEPS; i++) {
    for (const dir of i === 0 ? [0] : [1, -1]) {
      const candidate = { x: center.x + dir * i * step, y: center.y };
      const box = stickyBox(candidate);
      if (visible && !contains(visible, box)) continue;
      if (!occupied.some((f) => overlaps(f, box))) return candidate;
    }
  }
  return occupied.some((f) => overlaps(f, stickyBox(center)))
    ? { x: center.x + STICKY_GAP, y: center.y + STICKY_GAP }
    : center;
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
 * Drop a sticky at the current viewport center — or the nearest free
 * visible spot along its row ({@link freeStickyCenter}) — select it, and enter text-edit
 * so the user can type immediately. One `batch` = one undo unit. Returns
 * the new element id.
 */
export function dropStickyAtViewportCenter(deps: DropStickyDeps): string {
  const { viewport, hostWidth, hostHeight } = deps;
  return dropStickyAt({
    ...deps,
    at: screenToWorld(viewport, { x: hostWidth / 2, y: hostHeight / 2 }),
    visible: visibleWorldRect(viewport, hostWidth, hostHeight),
  });
}

/** The world rect the viewport shows on a `w` × `h` host. */
export function visibleWorldRect(viewport: Viewport, w: number, h: number): Frame {
  const tl = screenToWorld(viewport, { x: 0, y: 0 });
  const br = screenToWorld(viewport, { x: w, y: h });
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y, rotation: 0 };
}

export interface DropStickyAtDeps {
  store: SlidesStore;
  editor: SlidesEditor;
  /** World point the sticky is aimed at. */
  at: Point;
  colorValue: string;
  occupied?: readonly Frame[];
  /** On-screen world rect; a stepped-off sticky stays inside it. */
  visible?: Frame;
}

/**
 * Drop a sticky aimed at a world point — the right-clicked spot for the
 * canvas menu's "Add sticky note" — stepping off anything it would cover,
 * then select it and enter text-edit.
 */
export function dropStickyAt(deps: DropStickyAtDeps): string {
  const { store, editor, colorValue } = deps;
  const center = freeStickyCenter(deps.occupied ?? [], deps.at, deps.visible);
  let id = '';
  store.batch(() => {
    id = store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit(colorValue, center));
  });
  editor.setSelection([id]);
  editor.enterTextEditing(id);
  return id;
}
