import type { Theme } from '../model/theme';
import { palette, typography } from '@wafflebase/tokens';
import { firstFamily } from './font-stack';

export const defaultDark: Theme = {
  id: 'default-dark',
  name: 'Simple Dark',
  colors: {
    text: palette.neutrals.dark.ink,
    background: palette.neutrals.dark.bg,
    textSecondary: palette.neutrals.dark.sub,
    backgroundAlt: palette.neutrals.dark.paper,
    accent1: palette.syrupBright,
    accent2: palette.butter,
    accent3: palette.berryBright,
    accent4: palette.leafBright,
    accent5: palette.syrup,
    accent6: palette.berry,
    hyperlink: palette.syrupBright,
    visitedHyperlink: palette.berryBright,
  },
  fonts: {
    heading: firstFamily(typography.display),
    body: firstFamily(typography.body),
  },
};
