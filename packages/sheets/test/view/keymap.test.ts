import { describe, expect, it } from 'vitest';
import {
  isModPressed,
  keyEquals,
  matchesKeyCombo,
} from '../../src/view/keymap';

type KeyEventLike = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

const toEvent = ({
  key,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  shiftKey = false,
}: KeyEventLike): KeyboardEvent =>
  ({
    key,
    metaKey,
    ctrlKey,
    altKey,
    shiftKey,
  }) as KeyboardEvent;

describe('keymap helpers', () => {
  it('treats Ctrl as mod key', () => {
    expect(isModPressed(toEvent({ key: 'a', ctrlKey: true }))).toBe(true);
  });

  it('treats Cmd as mod key', () => {
    expect(isModPressed(toEvent({ key: 'a', metaKey: true }))).toBe(true);
  });

  it('matches character keys case-insensitively', () => {
    expect(keyEquals(toEvent({ key: 'M' }), 'm')).toBe(true);
  });

  it('matches combo modifiers when requested', () => {
    expect(
      matchesKeyCombo(toEvent({ key: 'z', ctrlKey: true }), {
        key: 'z',
        mod: true,
        shift: false,
      }),
    ).toBe(true);
  });
});
