import { DEFAULT_BLOCK_STYLE, type Block, type StoredColor } from '@wafflebase/docs';
import type { PlaceholderStyle } from './master';
import type { Theme } from './theme';
import { resolveFont } from './theme';

/**
 * Build the initial Block[] for a fresh placeholder element so the
 * typed text inherits the slot's master typography (font role and
 * size, theme-aware color, alignment, lineHeight) the moment the
 * user starts typing. The first inline carries fontSize / fontFamily
 * / color so that DocStore's caret-position type-insert keeps the
 * styling on each new character; the block carries alignment and
 * lineHeight.
 *
 * fontFamily resolves to a concrete string at seed time. A future
 * follow-up could make it role-aware so theme switches update typed
 * text the way they already update typed colors.
 */
export function seedPlaceholderBlocks(
  style: PlaceholderStyle,
  theme: Theme,
): Block[] {
  return [
    {
      id: 'placeholder',
      type: 'paragraph',
      inlines: [{
        text: '',
        style: {
          fontSize: style.fontSize,
          fontFamily: resolveFont({ kind: 'role', role: style.fontRole }, theme),
          color: { kind: 'role', role: style.colorRole } as StoredColor,
        },
      }],
      style: {
        ...DEFAULT_BLOCK_STYLE,
        alignment: style.align,
        lineHeight: style.lineHeight,
      },
    },
  ];
}
