import type { Guide, GuideAxis, SlidesDocument } from './presentation';
import { MAX_RECENT_COLORS } from './presentation';
import type { ThemeColor } from './theme';
import { DEFAULT_MASTER } from './master';
import { generateId } from './element';
import { defaultLight } from '../themes/default-light';

const LAYOUT_ID_MIGRATIONS: Record<string, string> = {
  title: 'title-slide',
};

/**
 * Migrate just the document metadata: fill defaults and preserve the
 * optional fields (`unit`, `pxPerPt`, `slideHeight`, `recentColors`) that
 * would otherwise be dropped on every read. Split out of
 * {@link migrateDocument} so `SlidesStore.readMeta()` can migrate meta
 * without scaffolding a whole default document (themes / masters / …).
 */
export function migrateMeta(rawMeta: unknown): import('./presentation').Meta {
  const m = rawMeta as any;
  const meta: import('./presentation').Meta = {
    title: m?.title ?? 'Untitled presentation',
    themeId: m?.themeId ?? 'default-light',
    masterId: m?.masterId ?? 'default',
  };
  // Preserve the optional unit field if present and valid.
  if (m?.unit === 'in' || m?.unit === 'cm') {
    meta.unit = m.unit;
  }
  // Preserve the deck-DPI font scale. PPTX-imported decks set this
  // from `<p:sldSz>`; without the migrate-time copy the field is
  // dropped on every Yorkie read and the renderer falls back to the
  // 96-DPI docs default — which is exactly the original bug.
  if (typeof m?.pxPerPt === 'number' && Number.isFinite(m.pxPerPt) && m.pxPerPt > 0) {
    meta.pxPerPt = m.pxPerPt;
  }
  // Preserve the per-deck logical height. Like pxPerPt, non-16:9 decks
  // set this from `<p:sldSz>`; without the migrate-time copy the field is
  // dropped on every Yorkie read and the deck renders stretched into the
  // default 1080 canvas — the exact distortion this field fixes.
  if (
    typeof m?.slideHeight === 'number' &&
    Number.isFinite(m.slideHeight) &&
    m.slideHeight > 0
  ) {
    meta.slideHeight = m.slideHeight;
  }
  // Preserve recent colors. Re-enforce the same normalization `pushRecent`
  // applies on write (lower-case, de-dupe most-recent-first, cap at
  // MAX_RECENT_COLORS) so an externally-authored or pre-cap deck can't
  // surface a malformed list.
  if (Array.isArray(m?.recentColors)) {
    const seen = new Set<string>();
    const colors: string[] = [];
    for (const c of m.recentColors) {
      if (typeof c !== 'string') continue;
      const norm = c.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      colors.push(norm);
      if (colors.length >= MAX_RECENT_COLORS) break;
    }
    if (colors.length > 0) meta.recentColors = colors;
  }
  return meta;
}

export function migrateDocument(input: unknown): SlidesDocument {
  const raw = input as any;
  const meta = migrateMeta(raw?.meta);
  const themes = Array.isArray(raw?.themes) && raw.themes.length > 0
    ? raw.themes
    : [defaultLight];
  const masters = Array.isArray(raw?.masters) && raw.masters.length > 0
    ? raw.masters
    : [DEFAULT_MASTER];
  const layouts = Array.isArray(raw?.layouts) ? raw.layouts.map(migrateLayout) : [];
  const slides = Array.isArray(raw?.slides) ? raw.slides.map(migrateSlide) : [];
  // Pre-ruler decks did not carry `guides`. Default to an empty array
  // so consumers downstream never see undefined and the read-path stays
  // shape-stable across pre- / post-v0.4.2 documents.
  const guides = Array.isArray(raw?.guides) ? raw.guides.map(migrateGuide) : [];
  return { meta, themes, masters, layouts, slides, guides };
}

/**
 * Normalise an arbitrary guide-shaped value into a well-typed
 * `Guide`. Two hardenings vs. raw shape pass-through:
 *
 * - **id**: synthesised when missing or non-string. Without this the
 *   editor's hit-test treats a guide-shaped object as targetable
 *   (axis + position are enough) but moveGuide / removeGuide call
 *   into the store with `undefined`, which then throws
 *   `Guide not found: undefined`.
 * - **position**: only accepted if finite. `NaN` / `Infinity` would
 *   otherwise propagate into the snap engine's `Math.abs(diff)` math
 *   and corrupt drag dx/dy, and into the overlay's
 *   `position * scale` arithmetic.
 */
function migrateGuide(g: any): Guide {
  const id = typeof g?.id === 'string' && g.id.length > 0 ? g.id : generateId();
  const axis: GuideAxis = g?.axis === 'y' ? 'y' : 'x';
  const rawPos = g?.position;
  const position =
    typeof rawPos === 'number' && Number.isFinite(rawPos) ? rawPos : 0;
  return { id, axis, position };
}

function migrateLayout(layout: any): any {
  const out: Record<string, unknown> = {
    id: layout?.id ?? 'blank',
    masterId: layout?.masterId ?? 'default',
    name: layout?.name ?? layout?.id ?? 'Layout',
    placeholders: layout?.placeholders ?? [],
    staticElements: layout?.staticElements ?? [],
  };
  if (layout?.background != null) out.background = migrateBackground(layout.background);
  return out;
}

function migrateSlide(slide: any): any {
  const layoutId = LAYOUT_ID_MIGRATIONS[slide?.layoutId] ?? slide?.layoutId ?? 'blank';
  const migrated: any = {
    id: slide?.id,
    layoutId,
    background: migrateBackground(slide?.background ?? {}),
    elements: Array.isArray(slide?.elements) ? slide.elements.map(migrateElement) : [],
    notes: slide?.notes ?? [],
  };
  // Preserve optional transition and animations fields.
  if (slide?.transition != null) migrated.transition = slide.transition;
  if (slide?.animations != null) migrated.animations = slide.animations;
  return migrated;
}

function migrateBackground(bg: any): { fill?: ThemeColor; image?: any } {
  const out: { fill?: ThemeColor; image?: any } = {};
  // Preserve an absent fill as "inherit" (slide → layout → master →
  // background role). Only wrap a fill that is actually set; never
  // synthesize a white default — an inheriting slide resolves to the
  // `background` role, which is white for default-light, so old decks
  // look identical.
  if (bg?.fill != null) out.fill = wrapColor(bg.fill);
  if (bg?.image != null) out.image = bg.image;
  return out;
}

function migrateElement(el: any): any {
  if (el?.type !== 'shape') return el;
  const data: Record<string, unknown> = { ...el.data };
  if (el.data?.fill != null) data.fill = wrapColor(el.data.fill);
  if (el.data?.stroke != null) {
    data.stroke = { ...el.data.stroke, color: wrapColor(el.data.stroke.color) };
  }
  return { ...el, data };
}

function wrapColor(c: unknown): ThemeColor {
  if (typeof c === 'string') return { kind: 'srgb', value: c };
  if (c && typeof c === 'object' && 'kind' in (c as any)) return c as ThemeColor;
  return { kind: 'role', role: 'background' };
}
