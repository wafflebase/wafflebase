import type { Theme } from '../model/theme';
import { defaultLight } from './default-light';
import { defaultDark } from './default-dark';
import { streamline } from './streamline';
import { swiss } from './swiss';
import { paradigm } from './paradigm';
import { material } from './material';
import { shift } from './shift';
import { momentum } from './momentum';
import { focus } from './focus';
import { luxe } from './luxe';
import { modernWriter } from './modern-writer';
import { coral } from './coral';
import { spearmint } from './spearmint';
import { pop } from './pop';
import { tropic } from './tropic';
import { marina } from './marina';
import { geometric } from './geometric';
import { plum } from './plum';
import { slate } from './slate';
import { forest } from './forest';
import { spotlight } from './spotlight';
import { beachDay } from './beach-day';
import { wafflebase } from './wafflebase';

export {
  defaultLight, defaultDark, streamline, swiss, paradigm, material, shift,
  momentum, focus, luxe, modernWriter, coral, spearmint, pop, tropic,
  marina, geometric, plum, slate, forest, spotlight, beachDay, wafflebase,
};

/**
 * Built-in theme registry. Order is the order they appear in the theme
 * picker side panel: neutral defaults first, then light professional,
 * warm/editorial, vibrant, dark, with the Wafflebase brand theme last.
 * `default-light` is the baseline and the fallback for unknown ids.
 */
export const BUILT_IN_THEMES: Theme[] = [
  defaultLight, defaultDark, streamline, swiss, paradigm, material, shift,
  momentum, focus, luxe, modernWriter, coral, spearmint, pop, tropic,
  marina, geometric, plum, slate, forest, spotlight, beachDay, wafflebase,
];

/**
 * Look up a built-in theme by id. Falls back to `defaultLight` for
 * unknown ids — keeps render paths from throwing when a deck references
 * a theme that hasn't been ported yet.
 */
export function getBuiltInTheme(id: string): Theme {
  return BUILT_IN_THEMES.find((t) => t.id === id) ?? defaultLight;
}
