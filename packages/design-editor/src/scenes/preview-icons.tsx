/*
 * A STAND-IN ICON FOR THE PREVIEW, and why it is hand-drawn rather than imported.
 *
 * Half of what a `Button` variant does is aimed at an icon it does not own: the shipped
 * cva carries `[&_svg]:pointer-events-none`, `[&_svg:not([class*='size-'])]:size-4` and
 * `[&_svg]:shrink-0`, plus a `size: icon` variant that only means anything when there is
 * a glyph inside. Previewing the component with text alone therefore left its icon rules
 * untested — the exact case someone opens this mode to look at.
 *
 * NO ICON LIBRARY. The frame renders the CONSUMER's components, and reaching into their
 * icon set would be a coupling the plugin has spent its whole design avoiding — projects
 * use lucide, tabler, heroicons or their own SVGs, and there is no generic way to name
 * one. What the cva actually selects is `svg`, so a plain inline `<svg>` exercises every
 * one of those rules identically. These are geometry, not branding.
 *
 * NO `class` AND NO `width`/`height`: `:not([class*='size-'])` must match, and an
 * explicit dimension would win over the `size-4` the component is trying to apply —
 * which is precisely the rule under test.
 */
import type { ReactNode } from 'react';

/** Where the glyph sits relative to the text. */
export type IconSlot = 'none' | 'leading' | 'trailing' | 'only';

export const ICON_SLOTS: IconSlot[] = ['none', 'leading', 'trailing', 'only'];

/**
 * The offered glyphs, as bare path data on a 24×24 viewBox — the grid lucide, tabler and
 * heroicons all draw on, so the stroke weight reads the same as the project's own.
 */
export const PREVIEW_ICONS: Record<string, string> = {
  plus: 'M5 12h14M12 5v14',
  check: 'M20 6 9 17l-5-5',
  chevron: 'm6 9 6 6 6-6',
  search: 'M21 21l-4.35-4.35M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  x: 'M18 6 6 18M6 6l12 12',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
};

export const ICON_NAMES = Object.keys(PREVIEW_ICONS);

/** The glyph itself, or `null` for a name nothing is registered under. */
export function PreviewIcon({ name }: { name: string }): ReactNode {
  const d = PREVIEW_ICONS[name];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * The children a preview renders: text, a glyph, or both in either order.
 *
 * `only` drops the text entirely rather than hiding it, because that is what an
 * icon-only button IS — and a `size: icon` variant sized for one glyph would otherwise
 * be judged against a box with a word squeezed out of sight.
 */
export function previewChildren(text: string, slot: IconSlot, icon: string): ReactNode {
  const glyph = <PreviewIcon name={icon} />;
  if (slot === 'only') return glyph;
  if (slot === 'leading') return (
    <>
      {glyph}
      {text}
    </>
  );
  if (slot === 'trailing') return (
    <>
      {text}
      {glyph}
    </>
  );
  return text;
}
