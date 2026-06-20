import type { Theme } from '../model/theme';
import { palette, typography } from '@wafflebase/tokens';
import { firstFamily } from './font-stack';

/**
 * The Wafflebase brand theme — the waffle palette (syrup / butter /
 * berry / leaf) and brand display/body fonts that used to be baked into
 * `default-light`. Kept as a one-click choice so the prior default look
 * is reproducible, while new decks default to the neutral Simple Light.
 */
export const wafflebase: Theme = {
  id: 'wafflebase',
  name: 'Wafflebase',
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
