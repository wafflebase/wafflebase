import type { Crop } from './element';
import type { ColorRole, FontRole, ThemeColor } from './theme';

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
  fill: ThemeColor;
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
      fontSize: 18,
      colorRole: 'text',
      align: 'left',
      lineHeight: 1.5,
    },
    subtitle: {
      fontRole: 'body',
      fontSize: 24,
      colorRole: 'textSecondary',
      align: 'left',
      lineHeight: 1.4,
    },
    caption: {
      fontRole: 'body',
      fontSize: 14,
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
