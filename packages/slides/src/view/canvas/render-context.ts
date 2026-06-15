import type { Stroke } from '../../model/element';
import type { SlidesDocument } from '../../model/presentation';
import { resolveColor, type Theme, type ThemeColor } from '../../model/theme';

/**
 * Resolve a stroke color that may be either a legacy ThemeColor discriminated
 * union (stored in older Yorkie documents) or a plain CSS/hex string (produced
 * by the toolbar redesign and all new editing paths).
 */
export function resolveStrokeColor(color: Stroke['color'], theme: Theme): string {
  if (typeof color === 'string') return color;
  return resolveColor(color as ThemeColor, theme);
}

/**
 * Map a stroke dash style to a canvas line-dash array. Shared by the
 * text-box and table renderers so dashed / dotted strokes look identical
 * across surfaces. Absent / `'solid'` ⇒ a continuous line.
 */
export function dashArray(dash: Stroke['dash']): number[] {
  if (dash === 'dashed') return [6, 4];
  if (dash === 'dotted') return [2, 2];
  return [];
}

/**
 * Render-time context bundle threaded through every canvas painter so
 * each `ctx.fillStyle` / `ctx.strokeStyle` site can resolve a
 * `ThemeColor` against the deck's active theme. Currently a thin pair;
 * Task 4 widens this to also carry a `colorResolver` for the docs
 * text path.
 */
export type RenderContext = {
  doc: SlidesDocument;
  theme: Theme;
};

/**
 * Resolve the deck's active theme by `meta.themeId`. Throws when the
 * id doesn't match any entry in `doc.themes` — a misconfigured
 * SlidesDocument is a programmer error, not a runtime fallback.
 */
export function getActiveTheme(doc: SlidesDocument): Theme {
  const t = doc.themes.find((x) => x.id === doc.meta.themeId);
  if (!t) {
    throw new Error(
      `[slides] active theme '${doc.meta.themeId}' not found in document; ` +
        `themes: ${doc.themes.map((x) => x.id).join(', ') || '(none)'}`,
    );
  }
  return t;
}
