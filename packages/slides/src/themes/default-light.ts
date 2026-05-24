import type { Theme } from '../model/theme';
import { palette, typography } from '@wafflebase/tokens';

const firstFamily = (stack: string) =>
  stack.split(',')[0].replace(/"/g, '').trim();

export const defaultLight: Theme = {
  id: 'default-light',
  name: 'Simple Light',
  colors: {
    text: palette.neutrals.light.ink,
    background: palette.neutrals.light.paper,
    textSecondary: palette.neutrals.light.sub,
    backgroundAlt: palette.neutrals.light.bg,
    accent1: palette.syrup,
    accent2: palette.butter,
    accent3: palette.berry,
    accent4: palette.leaf,
    accent5: palette.syrupDeep,
    accent6: palette.berryBright,
    hyperlink: palette.syrup,
    visitedHyperlink: palette.berry,
  },
  fonts: {
    heading: firstFamily(typography.display),
    body: firstFamily(typography.body),
  },
};
