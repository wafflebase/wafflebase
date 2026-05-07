import type { SlidesDocument } from '../../model/presentation';
import type { Theme } from '../../model/theme';

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
