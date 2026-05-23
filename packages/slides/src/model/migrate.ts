import type { SlidesDocument } from './presentation';
import type { ThemeColor } from './theme';
import { DEFAULT_MASTER } from './master';
import { defaultLight } from '../themes/default-light';

const LAYOUT_ID_MIGRATIONS: Record<string, string> = {
  title: 'title-slide',
};

export function migrateDocument(input: unknown): SlidesDocument {
  const raw = input as any;
  const meta = {
    title: raw?.meta?.title ?? 'Untitled presentation',
    themeId: raw?.meta?.themeId ?? 'default-light',
    masterId: raw?.meta?.masterId ?? 'default',
  };
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

function migrateGuide(g: any): any {
  return {
    id: g?.id,
    axis: g?.axis === 'y' ? 'y' : 'x',
    position: typeof g?.position === 'number' ? g.position : 0,
  };
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
  return {
    id: slide?.id,
    layoutId,
    background: migrateBackground(slide?.background ?? { fill: '#ffffff' }),
    elements: Array.isArray(slide?.elements) ? slide.elements.map(migrateElement) : [],
    notes: slide?.notes ?? [],
  };
}

function migrateBackground(bg: any): { fill: ThemeColor; image?: any } {
  const out: { fill: ThemeColor; image?: any } = {
    fill: wrapColor(bg?.fill ?? '#ffffff'),
  };
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
