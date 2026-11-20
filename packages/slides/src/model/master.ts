import type { Crop } from './element';
import type { ColorRole, Fill, FontRole } from './theme';

export type PlaceholderStyle = {
  fontRole: FontRole;
  fontSize: number;
  colorRole: ColorRole;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
};

/** Same shape as `BackgroundImage` in `presentation.ts`; kept inline
 *  here to avoid a circular dependency between master and presentation. */
export type MasterBackgroundImage = {
  src: string;
  opacity?: number;
  crop?: Crop;
};

export type MasterBackground = {
  fill: Fill;
  image?: MasterBackgroundImage;
};

export type Master = {
  id: string;
  themeId: string;
  background: MasterBackground;
  placeholderStyles: {
    title: PlaceholderStyle;
    body: PlaceholderStyle;
    [key: string]: PlaceholderStyle;
  };
};

/**
 * The placeholder sizes a new deck starts from. Sizes are stored in points
 * but a deck authored here paints them at the docs canvas's 96 DPI
 * (`deckFontScale`), while the 1920px slide runs at `SLIDE_PX_PER_PT` (2),
 * so a stored point lands at two thirds of a physical point. The body, the
 * subtitle and the caption are therefore set at 1.5x the point sizes Google
 * Slides uses on its 10in-wide slide (18 / 28 / 12pt), which keeps the same
 * proportion to the slide; at 18 the body read as 12pt bullets. Existing
 * decks are not affected: each stores its own copy of its master.
 */
export const DEFAULT_MASTER: Master = {
  id: 'default',
  themeId: 'default-light',
  background: { fill: { kind: 'role', role: 'background' } },
  placeholderStyles: {
    title: {
      fontRole: 'heading',
      fontSize: 44,
      colorRole: 'text',
      align: 'left',
      lineHeight: 1.2,
    },
    body: {
      fontRole: 'body',
      fontSize: 27,
      colorRole: 'text',
      align: 'left',
      lineHeight: 1.5,
    },
    subtitle: {
      fontRole: 'body',
      fontSize: 36,
      colorRole: 'textSecondary',
      align: 'left',
      lineHeight: 1.4,
    },
    caption: {
      fontRole: 'body',
      fontSize: 18,
      colorRole: 'textSecondary',
      align: 'left',
      lineHeight: 1.4,
    },
    'big-number': {
      fontRole: 'heading',
      fontSize: 96,
      colorRole: 'text',
      align: 'center',
      lineHeight: 1.1,
    },
  },
};
