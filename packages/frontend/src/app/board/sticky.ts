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
  STICKY_ROLE,
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
 * shape rather than its own type, so this reads the explicit
 * `role: 'sticky'` marker or, on a board written before the marker, the
 * preset's signature — see `isStickyData` (`@wafflebase/board`).
 */
export function isStickyElement(el: Element | undefined): boolean {
  return el?.type === 'shape' && isStickyData(el.data);
}

/** Square sticky side length, in board world px. */
export const STICKY_SIZE = 180;

/** A sticky's width and height, in board world px. */
export interface StickySize {
  w: number;
  h: number;
}

/** The default sticky footprint. */
export const DEFAULT_STICKY_SIZE: StickySize = { w: STICKY_SIZE, h: STICKY_SIZE };

/** Extra fields a new sticky can be created with. */
export interface StickyOptions {
  size?: StickySize;
  /** Creator display name, recorded once (absent on an anonymous board). */
  author?: string;
  /** Initial text (a pasted line); absent leaves the body empty. */
  text?: string;
  /** Font size for the body; absent keeps the slides default. */
  fontSize?: number;
  /** Carried over from a source sticky; absent means the tag is shown. */
  showAuthor?: boolean;
}

/**
 * Build the `ElementInit` for a sticky note: a `roundRect` shape with a
 * solid srgb fill, a soft drop shadow, and a middle-anchored,
 * shrink-autofit, center-aligned text body, centered on `center`. It
 * carries the explicit `role: 'sticky'` marker, so restyling it later
 * (a gradient, a border) never demotes it to a plain shape.
 *
 * The text body is seeded (rather than left absent for lazy creation)
 * so the sticky's middle/shrink/center layout applies to the first
 * keystroke — `withShapeText` preserves an existing `data.text` and only
 * synthesizes a bare one (top-anchored, grow) when none exists.
 */
export function buildStickyInit(
  colorValue: string,
  center: Point,
  options: StickyOptions = {},
): ElementInit {
  const { w, h } = options.size ?? DEFAULT_STICKY_SIZE;
  const block = makeDefaultSlidesTextBlock();
  block.style = { ...block.style, alignment: 'center' };
  if (options.text !== undefined || options.fontSize !== undefined) {
    block.inlines = block.inlines.map((inline, i) => ({
      ...inline,
      text: i === 0 && options.text !== undefined ? options.text : inline.text,
      style:
        options.fontSize !== undefined
          ? { ...inline.style, fontSize: options.fontSize }
          : inline.style,
    }));
  }
  const author = options.author?.trim();
  return {
    type: 'shape',
    frame: {
      x: center.x - w / 2,
      y: center.y - h / 2,
      w,
      h,
      rotation: 0,
    },
    data: {
      kind: 'roundRect',
      role: STICKY_ROLE,
      fill: { kind: 'srgb', value: colorValue },
      effects: { shadow: { ...STICKY_SHADOW } },
      text: {
        blocks: [block],
        verticalAnchor: 'middle',
        autofit: 'shrink',
      },
      ...(author ? { author } : {}),
      ...(options.showAuthor === false ? { showAuthor: false } : {}),
    },
  } as ElementInit;
}

/** Space left between a new sticky and the one it steps away from. */
export const STICKY_GAP = 24;

/** Most columns / rows the on-screen search walks each way. */
const MAX_VISIBLE_STEPS = 30;

/** How many rings the off-screen search walks before giving up. */
const MAX_RINGS = 40;

/** How many sticky-widths a directional step walks before searching around. */
const MAX_DIRECTION_STEPS = 10;

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

/** The box of a `size` sticky centred on `center`. */
export function stickyBox(center: Point, size: StickySize = DEFAULT_STICKY_SIZE): Frame {
  return {
    x: center.x - size.w / 2,
    y: center.y - size.h / 2,
    w: size.w,
    h: size.h,
    rotation: 0,
  };
}

/** 0, 1, -1, 2, -2, … up to ±n: nearest first, the positive side first. */
function offsets(n: number): number[] {
  const out = [0];
  for (let k = 1; k <= n; k++) out.push(k, -k);
  return out;
}

/** Position of `k` in {@link offsets}: 0 → 0, +k → 2k−1, −k → 2k. */
function offsetRank(k: number): number {
  return k === 0 ? 0 : k > 0 ? 2 * k - 1 : -2 * k;
}

/**
 * A bucketed index over occupied frames, so a search that tries thousands
 * of candidate squares on a crowded board tests each one against the few
 * frames near it rather than all of them.
 */
function frameIndex(frames: readonly Frame[], cell: number) {
  const buckets = new Map<string, Frame[]>();
  const big: Frame[] = [];
  for (const f of frames) {
    const x0 = Math.floor(f.x / cell);
    const x1 = Math.floor((f.x + f.w) / cell);
    const y0 = Math.floor(f.y / cell);
    const y1 = Math.floor((f.y + f.h) / cell);
    // A huge frame (a background image, a long connector) would fill
    // thousands of buckets; it is cheaper to test it every time.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) {
      big.push(f);
      continue;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        const list = buckets.get(key);
        if (list) list.push(f);
        else buckets.set(key, [f]);
      }
    }
  }
  return (box: Frame): boolean => {
    if (big.some((f) => overlaps(f, box))) return true;
    const x0 = Math.floor(box.x / cell);
    const x1 = Math.floor((box.x + box.w) / cell);
    const y0 = Math.floor(box.y / cell);
    const y1 = Math.floor((box.y + box.h) / cell);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = buckets.get(`${x},${y}`);
        if (list?.some((f) => overlaps(f, box))) return true;
      }
    }
    return false;
  };
}

/**
 * Where a new sticky aimed at `center` should actually go so that it
 * never covers anything, even partly.
 *
 * The candidates form a grid of sticky-plus-{@link STICKY_GAP} cells
 * around `center`. When `visible` (the on-screen world rect) is given,
 * the cells wholly inside it are tried first, in reading order outward
 * from the centre: the centre row (centre, right, left, two right, …),
 * then the row below, the row above, two below, and so on. So a burst of
 * `S` presses fills the screen the way a brainstorm wants, a row at a
 * time.
 *
 * Only when the screen is full does it go off-screen: ring by ring around
 * `center` (each ring in the same reading order), until one is free. The caller pans to a
 * spot it is given off-screen (see `placeSticky`'s `reveal`), because the
 * new sticky enters text edit straight away. Past the last ring it puts
 * the sticky just right of everything. It never stacks one sticky on
 * another; the old version cascaded 24 px down-right, which is exactly
 * how six presses of `S` ended up as one pile.
 *
 * Rotation is ignored: an axis-aligned test is enough to avoid a cover.
 */
export function freeStickyCenter(
  occupied: readonly Frame[],
  center: Point,
  visible?: Frame,
  size: StickySize = DEFAULT_STICKY_SIZE,
): Point {
  const stepX = size.w + STICKY_GAP;
  const stepY = size.h + STICKY_GAP;
  const taken = frameIndex(occupied, Math.max(stepX, stepY));
  const at = (i: number, j: number): Point => ({
    x: center.x + i * stepX,
    y: center.y + j * stepY,
  });

  if (visible) {
    const nx = Math.min(MAX_VISIBLE_STEPS, Math.ceil(visible.w / stepX) + 1);
    const ny = Math.min(MAX_VISIBLE_STEPS, Math.ceil(visible.h / stepY) + 1);
    for (const j of offsets(ny)) {
      for (const i of offsets(nx)) {
        const p = at(i, j);
        const box = stickyBox(p, size);
        if (!contains(visible, box)) continue;
        if (!taken(box)) return p;
      }
    }
  }

  for (let r = 0; r <= MAX_RINGS; r++) {
    const ring: { i: number; j: number }[] = [];
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) === r) ring.push({ i, j });
      }
    }
    // Reading order within the ring, as on screen.
    ring.sort(
      (a, b) => offsetRank(a.j) - offsetRank(b.j) || offsetRank(a.i) - offsetRank(b.i),
    );
    for (const { i, j } of ring) {
      const p = at(i, j);
      if (!taken(stickyBox(p, size))) return p;
    }
  }

  // Nothing free within the rings: just right of everything there is.
  const right = occupied.reduce((m, f) => Math.max(m, f.x + f.w), center.x);
  return { x: right + STICKY_GAP + size.w / 2, y: center.y };
}

/** A side of a sticky a new one can be added on. */
export type StickyDirection = 'right' | 'left' | 'down' | 'up';

const UNIT: Record<StickyDirection, Point> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
};

/**
 * Where a sticky added next to `source` on its `direction` side goes: the
 * neighbouring cell one gap away, or the next free one further along that
 * side (stopping at the screen edge when `visible` is given). With that
 * whole line taken it falls back to {@link freeStickyCenter} around the
 * first neighbour, which continues in reading order. The new sticky has
 * the source's size.
 */
export function adjacentStickyCenter(
  occupied: readonly Frame[],
  source: Frame,
  direction: StickyDirection,
  visible?: Frame,
): Point {
  const size = { w: source.w, h: source.h };
  const unit = UNIT[direction];
  const step = unit.x !== 0 ? source.w + STICKY_GAP : source.h + STICKY_GAP;
  const origin = { x: source.x + source.w / 2, y: source.y + source.h / 2 };
  const along = (k: number): Point => ({
    x: origin.x + unit.x * k * step,
    y: origin.y + unit.y * k * step,
  });
  const taken = frameIndex(occupied, Math.max(size.w, size.h) + STICKY_GAP);
  for (let k = 1; k <= MAX_DIRECTION_STEPS; k++) {
    const p = along(k);
    const box = stickyBox(p, size);
    if (visible && !contains(visible, box)) break;
    if (!taken(box)) return p;
  }
  return freeStickyCenter(occupied, along(1), visible, size);
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
  /** Creator display name to record on the sticky. */
  author?: string;
  /** Bring an off-screen landing spot into view. */
  reveal?: (box: Frame) => void;
}

/**
 * Drop a sticky at the current viewport center — or the nearest free
 * spot ({@link freeStickyCenter}) — select it, and enter text-edit so the
 * user can type immediately. One `batch` = one undo unit. Returns the new
 * element id.
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
  /** On-screen world rect; a free spot inside it is preferred. */
  visible?: Frame;
  /** Creator display name to record on the sticky. */
  author?: string;
  /** Bring an off-screen landing spot into view. */
  reveal?: (box: Frame) => void;
}

/**
 * Drop a sticky aimed at a world point — the right-clicked spot for the
 * canvas menu's "Add sticky note" — stepping off anything it would cover,
 * then select it and enter text-edit.
 */
export function dropStickyAt(deps: DropStickyAtDeps): string {
  const center = freeStickyCenter(deps.occupied ?? [], deps.at, deps.visible);
  return placeSticky({
    store: deps.store,
    editor: deps.editor,
    center,
    colorValue: deps.colorValue,
    options: { author: deps.author },
    visible: deps.visible,
    reveal: deps.reveal,
  });
}

export interface PlaceStickyDeps {
  store: SlidesStore;
  editor: SlidesEditor;
  center: Point;
  colorValue: string;
  options?: StickyOptions;
  visible?: Frame;
  reveal?: (box: Frame) => void;
}

/**
 * Create a sticky at exactly `center` in one batch (one undo unit),
 * select it and enter text edit. When it lands outside `visible`,
 * `reveal` brings it on screen first, so the caret is never typed into
 * a note the user cannot see.
 */
export function placeSticky(deps: PlaceStickyDeps): string {
  const { store, editor, center, colorValue, options } = deps;
  const init = buildStickyInit(colorValue, center, options);
  if (deps.visible && deps.reveal && !contains(deps.visible, init.frame as Frame)) {
    deps.reveal(init.frame as Frame);
  }
  let id = '';
  store.batch(() => {
    id = store.addElement(SYNTHETIC_SLIDE_ID, init);
  });
  editor.setSelection([id]);
  editor.enterTextEditing(id);
  return id;
}
