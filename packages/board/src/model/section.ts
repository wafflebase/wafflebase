import {
  boundingBox,
  type Element,
  type ElementInit,
  type Frame,
} from '@wafflebase/slides';

/**
 * A board section (FigJam's Shift+S): a titled region that clusters the
 * elements inside it. See docs/design/board/board-sections.md.
 *
 * A section is not its own element type. It is a `rect` shape carrying an
 * additive `data.section` marker, so the shared Slides renderer, store,
 * clipboard and exporters handle it unchanged, and an older client sees a
 * plain tinted rectangle. Membership is GEOMETRIC, never stored: an
 * element belongs to a section when its bounding box lies mostly inside
 * the section's. That keeps the CRDT flat (no child arrays to reconcile
 * when two peers drag the same sticky in and out at once) and keeps every
 * member directly selectable, which a group would not.
 */
export interface SectionMeta {
  title: string;
  /** Contents are covered for everyone until someone reveals them. */
  hidden?: boolean;
  /** The section and its contents ignore clicks until unlocked. */
  locked?: boolean;
}

/** One section colour: a light tint for the body, a darker border/title. */
export interface SectionColor {
  name: string;
  fill: string;
  stroke: string;
}

/**
 * The section palette. Light, low-chroma tints so stickies of every
 * colour stay legible on top, each paired with a border dark enough to
 * carry the white title text.
 */
export const SECTION_COLORS: readonly SectionColor[] = [
  { name: 'Gray', fill: '#F4F4F5', stroke: '#71717A' },
  { name: 'Yellow', fill: '#FEF9C3', stroke: '#A16207' },
  { name: 'Green', fill: '#DCFCE7', stroke: '#15803D' },
  { name: 'Blue', fill: '#DBEAFE', stroke: '#1D4ED8' },
  { name: 'Pink', fill: '#FCE7F3', stroke: '#BE185D' },
  { name: 'Purple', fill: '#EDE9FE', stroke: '#6D28D9' },
];

export const DEFAULT_SECTION_TITLE = 'Section';

/** Size of a section made by a plain click with the section tool. */
export const DEFAULT_SECTION_SIZE = { w: 800, h: 560 } as const;

/** Space between a wrapped selection and the section around it. */
export const SECTION_PADDING = 48;

/**
 * Share of an element's bounding-box area that has to lie inside a
 * section for it to count as a member. Half: a sticky straddling the
 * border belongs to whichever side holds most of it, so it is never
 * claimed by two sibling sections at once.
 */
export const MEMBERSHIP_RATIO = 0.5;

/** The section marker on an element, or `undefined` if it is not one. */
export function sectionOf(el: Element | undefined): SectionMeta | undefined {
  if (!el || el.type !== 'shape') return undefined;
  const marker = (el.data as { section?: unknown }).section;
  if (!marker || typeof marker !== 'object') return undefined;
  const title = (marker as { title?: unknown }).title;
  if (typeof title !== 'string') return undefined;
  return marker as SectionMeta;
}

export function isSectionElement(el: Element | undefined): boolean {
  return sectionOf(el) !== undefined;
}

/** The palette entry whose fill matches `fill`, or the first (gray). */
export function sectionColorOf(el: Element | undefined): SectionColor {
  const fill =
    el?.type === 'shape' && el.data.fill && 'kind' in el.data.fill && el.data.fill.kind === 'srgb'
      ? el.data.fill.value.toUpperCase()
      : undefined;
  return SECTION_COLORS.find((c) => c.fill.toUpperCase() === fill) ?? SECTION_COLORS[0];
}

/** `data` fields that paint a section in `color`. */
export function sectionColorData(color: SectionColor): object {
  return {
    fill: { kind: 'srgb', value: color.fill },
    stroke: { color: color.stroke, width: 2 },
  };
}

/** The `ElementInit` for a new section filling `frame`. */
export function buildSectionInit(
  frame: Omit<Frame, 'rotation'> & { rotation?: number },
  opts: { title?: string; color?: SectionColor } = {},
): ElementInit {
  return {
    type: 'shape',
    frame: { x: frame.x, y: frame.y, w: frame.w, h: frame.h, rotation: 0 },
    data: {
      kind: 'rect',
      ...sectionColorData(opts.color ?? SECTION_COLORS[0]),
      section: { title: opts.title ?? DEFAULT_SECTION_TITLE },
    },
  } as ElementInit;
}

/** The frame of a section wrapping `frames` with `padding` on every side. */
export function frameAround(
  frames: readonly Frame[],
  padding: number = SECTION_PADDING,
): Frame | undefined {
  if (frames.length === 0) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of frames) {
    const b = boundingBox(f);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return {
    x: x0 - padding,
    y: y0 - padding,
    w: x1 - x0 + padding * 2,
    h: y1 - y0 + padding * 2,
    rotation: 0,
  };
}

function area(f: { w: number; h: number }): number {
  return Math.max(0, f.w) * Math.max(0, f.h);
}

/**
 * Whether `inner`'s bounding box lies mostly ({@link MEMBERSHIP_RATIO})
 * inside `outer`'s. A degenerate box (a horizontal line has no height)
 * falls back to its centre point.
 */
export function isMostlyInside(inner: Frame, outer: Frame): boolean {
  const a = boundingBox(inner);
  const b = boundingBox(outer);
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const own = area(a);
  if (own === 0) {
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  }
  if (ix <= 0 || iy <= 0) return false;
  return (ix * iy) / own >= MEMBERSHIP_RATIO;
}

/**
 * The top-level elements inside section `section`: everything mostly
 * inside it, nested sections included as long as they are smaller (a
 * larger section mostly overlapping a smaller one is its parent, not its
 * child). Contents of nested sections are members too, since they lie
 * inside the outer bounds as well.
 */
export function sectionMemberIds(
  elements: readonly Element[],
  section: Element,
): string[] {
  const ownArea = area(section.frame);
  const out: string[] = [];
  for (const el of elements) {
    if (el.id === section.id) continue;
    if (isSectionElement(el) && area(el.frame) >= ownArea) continue;
    if (isMostlyInside(el.frame, section.frame)) out.push(el.id);
  }
  return out;
}

/**
 * What travels with a move of `movedIds`: the members of every moved
 * section, minus anything already moving. Read at drag start, so a
 * section carries what was inside it when the gesture began.
 */
export function companionMoveIds(
  movedIds: readonly string[],
  elements: readonly Element[],
): string[] {
  const moving = new Set(movedIds);
  const out = new Set<string>();
  for (const id of movedIds) {
    const el = elements.find((e) => e.id === id);
    if (!el || !isSectionElement(el)) continue;
    for (const member of sectionMemberIds(elements, el)) {
      if (!moving.has(member)) out.add(member);
    }
  }
  return [...out];
}

/**
 * Elements a click passes over: a locked section with its contents, and
 * the contents of a hidden section (the section itself stays selectable,
 * so it can be revealed).
 */
export function unselectableIds(elements: readonly Element[]): Set<string> {
  const out = new Set<string>();
  for (const el of elements) {
    const meta = sectionOf(el);
    if (!meta || (!meta.locked && !meta.hidden)) continue;
    if (meta.locked) out.add(el.id);
    for (const id of sectionMemberIds(elements, el)) out.add(id);
  }
  return out;
}

/**
 * The lasso rule for sections: a marquee picks a section only when it
 * encloses the whole of it, so lassoing a few stickies inside a big
 * section does not also grab the section (FigJam's rule). Other elements
 * keep the bbox-intersection rule.
 */
export function filterSectionLasso(
  ids: readonly string[],
  elements: readonly Element[],
  rect: { x: number; y: number; w: number; h: number },
): string[] {
  return ids.filter((id) => {
    const el = elements.find((e) => e.id === id);
    if (!el || !isSectionElement(el)) return true;
    const b = boundingBox(el.frame);
    return (
      b.x >= rect.x &&
      b.y >= rect.y &&
      b.x + b.w <= rect.x + rect.w &&
      b.y + b.h <= rect.y + rect.h
    );
  });
}

/**
 * Where a new section of `frame`'s size goes in the z-order: behind every
 * ordinary element, and behind sections smaller than it, so a section
 * drawn around another reads as its parent. Walks the leading run of
 * larger sections and stops at the first thing it should sit behind.
 */
export function sectionInsertIndex(
  elements: readonly Element[],
  frame: { w: number; h: number },
): number {
  const own = area(frame);
  let i = 0;
  while (i < elements.length && isSectionElement(elements[i]) && area(elements[i].frame) >= own) {
    i++;
  }
  return i;
}

/** Sections in reading order (top to bottom, then left to right): the sections list. */
export function listSections(
  elements: readonly Element[],
): { id: string; meta: SectionMeta; frame: Frame }[] {
  const out: { id: string; meta: SectionMeta; frame: Frame }[] = [];
  for (const el of elements) {
    const meta = sectionOf(el);
    if (meta) out.push({ id: el.id, meta, frame: el.frame });
  }
  return out.sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);
}

/**
 * The top-level sections enclosing world point `p`, smallest first —
 * what a right-click on a locked section's area offers to unlock.
 */
export function sectionsAt(
  elements: readonly Element[],
  p: { x: number; y: number },
): Element[] {
  return elements
    .filter((el) => {
      if (!isSectionElement(el)) return false;
      const b = boundingBox(el.frame);
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    })
    .sort((a, b) => area(a.frame) - area(b.frame));
}
