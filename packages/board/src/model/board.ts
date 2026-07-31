import {
  type SlidesDocument,
  type Slide,
  type Meta,
  type Element,
  BUILT_IN_LAYOUTS,
  DEFAULT_BACKGROUND,
  DEFAULT_MASTER,
  defaultLight,
} from '@wafflebase/slides';

/** Slide id for the single synthetic slide a board is presented as. */
export const SYNTHETIC_SLIDE_ID = 'board';

/**
 * Board's own data model. A board is one unbounded canvas of elements —
 * there is no per-slide structure — so this is intentionally flatter
 * than {@link SlidesDocument}: no slides/layouts/masters/themes, just
 * the element array plus the handful of meta fields the board UI needs
 * (title, display unit, recent colors).
 */
export interface BoardModel {
  meta: {
    title: string;
    unit?: 'in' | 'cm';
    recentColors?: string[];
  };
  elements: Element[];
}

/**
 * Wrap a board's element array in a single-slide {@link SlidesDocument}
 * so the reused slides scene engine (renderer + editor) can operate on
 * a board unchanged. The synthesized deck always uses the built-in
 * `blank` layout, the built-in default master, and the `default-light`
 * theme — a board has no theme/layout concept of its own, so any valid,
 * always-present built-in triple works. The slide's `background` is the
 * inheritable {@link DEFAULT_BACKGROUND} (a bare `background`-role
 * fill), which resolves to the master's background; the board's own
 * viewport chrome is what visually gates what's shown around it.
 */
export function boardToSlidesDocument(model: BoardModel): SlidesDocument {
  const theme = defaultLight;
  const master = DEFAULT_MASTER;
  const layout = BUILT_IN_LAYOUTS.find((l) => l.id === 'blank');
  if (!layout) {
    throw new Error("[board] built-in 'blank' layout not found");
  }

  const slide: Slide = {
    id: SYNTHETIC_SLIDE_ID,
    layoutId: layout.id,
    background: DEFAULT_BACKGROUND,
    elements: model.elements,
    notes: [],
  };

  const meta: Meta = {
    title: model.meta.title,
    themeId: theme.id,
    masterId: master.id,
    unit: model.meta.unit,
    recentColors: model.meta.recentColors,
  };

  return {
    meta,
    themes: [theme],
    masters: [master],
    layouts: [layout],
    slides: [slide],
    guides: [],
  };
}
