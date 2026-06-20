import type { Theme } from '../model/theme';
import { defaultLight } from './default-light';
import { defaultDark } from './default-dark';
import { streamline } from './streamline';
import { focus } from './focus';
import { material } from './material';
import { wafflebase } from './wafflebase';

export { defaultLight, defaultDark, streamline, focus, material, wafflebase };

/**
 * Built-in theme registry. Order is the order they appear in the theme
 * picker side panel. `default-light` is the v1 baseline and the
 * fallback when an unknown id is requested.
 */
export const BUILT_IN_THEMES: Theme[] = [
  defaultLight,
  defaultDark,
  streamline,
  focus,
  material,
  wafflebase,
];

/**
 * Look up a built-in theme by id. Falls back to `defaultLight` for
 * unknown ids — keeps render paths from throwing when a deck references
 * a theme that hasn't been ported yet.
 */
export function getBuiltInTheme(id: string): Theme {
  return BUILT_IN_THEMES.find((t) => t.id === id) ?? defaultLight;
}
