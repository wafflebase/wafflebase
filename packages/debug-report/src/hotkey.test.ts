import { describe, expect, it } from 'vitest';
import {
  actionFor,
  actionWhileReviewing,
  DEFAULT_BINDINGS,
  isTypingTarget,
  matchChord,
  type KeyLike,
} from './hotkey';

const press = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, ...mods });

describe('matchChord', () => {
  it('compares the key case-insensitively', () => {
    expect(matchChord(press('C'), DEFAULT_BINDINGS.capture)).toBe(true);
    expect(matchChord(press('c'), DEFAULT_BINDINGS.capture)).toBe(true);
  });

  it('accepts either modifier for Mod, so one binding covers both platforms', () => {
    const toggle = DEFAULT_BINDINGS.toggle;
    expect(matchChord(press('y', { ctrlKey: true, shiftKey: true }), toggle)).toBe(true);
    expect(matchChord(press('y', { metaKey: true, shiftKey: true }), toggle)).toBe(true);
  });

  it('rejects a modifier the chord does not ask for', () => {
    // Otherwise `c` would fire on Ctrl+C, eating copy.
    expect(matchChord(press('c', { ctrlKey: true }), DEFAULT_BINDINGS.capture)).toBe(false);
    expect(matchChord(press('c', { altKey: true }), DEFAULT_BINDINGS.capture)).toBe(false);
    expect(matchChord(press('c', { shiftKey: true }), DEFAULT_BINDINGS.capture)).toBe(false);
  });

  it('rejects a chord missing a modifier it asks for', () => {
    expect(matchChord(press('y'), DEFAULT_BINDINGS.toggle)).toBe(false);
    expect(matchChord(press('y', { ctrlKey: true }), DEFAULT_BINDINGS.toggle)).toBe(false);
  });
});

describe('actionFor', () => {
  it('answers toggle whether or not debug mode is live', () => {
    const key = press('y', { ctrlKey: true, shiftKey: true });
    expect(actionFor(key, false)).toBe('toggle');
    expect(actionFor(key, true)).toBe('toggle');
  });

  it('ignores the single-letter bindings while debug mode is off', () => {
    // Claiming bare `c`/`p`/`r` app-wide would be a worse defect than any this
    // feature reports.
    for (const key of ['c', 'p', 'r', 'Escape']) {
      expect(actionFor(press(key), false)).toBeUndefined();
    }
  });

  it('answers every action while debug mode is live', () => {
    expect(actionFor(press('c'), true)).toBe('capture');
    // `p` is deliberately NOT bound: it used to enter a mode whose whole effect
    // was the hover outline the overlay now paints unconditionally, so it looked
    // like a third action beside `c` and `r` while never producing an item.
    // Unbound means it reaches the app, which is the correct answer for a letter
    // this tool has no use for.
    expect(actionFor(press('p'), true)).toBeUndefined();
    expect(actionFor(press('r'), true)).toBe('region');
    expect(actionFor(press('v'), true)).toBe('review');
    expect(actionFor(press('Escape'), true)).toBe('cancel');
  });

  it('never claims Enter, which the app needs everywhere', () => {
    // A recognised binding is intercepted at capture phase, so binding Enter
    // took it from the panel's own buttons and from Enter-to-commit in the grid.
    expect(actionFor(press('Enter'), true)).toBeUndefined();
    expect(actionFor(press('Enter'), false)).toBeUndefined();
  });

  it('answers undefined for anything unbound', () => {
    expect(actionFor(press('q'), true)).toBeUndefined();
  });

  it('honours replaced bindings', () => {
    const custom = { ...DEFAULT_BINDINGS, capture: { key: ' ' } };
    expect(actionFor(press(' '), true, custom)).toBe('capture');
    expect(actionFor(press('c'), true, custom)).toBeUndefined();
  });
});

describe('isTypingTarget', () => {
  it('is true for the fields the overlay renders', () => {
    document.body.innerHTML =
      '<input id="i"><textarea id="t"></textarea><div id="c" contenteditable="true"></div>';
    for (const id of ['#i', '#t', '#c']) {
      expect(isTypingTarget(document.querySelector(id))).toBe(true);
    }
  });

  it('is false for a button, and for a non-element target', () => {
    document.body.innerHTML = '<button id="b"></button>';
    expect(isTypingTarget(document.querySelector('#b'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });
});

describe('actionWhileReviewing', () => {
  it('recognises only leaving the panel and the global toggle', () => {
    expect(actionWhileReviewing(press('Escape'))).toBe('cancel');
    expect(actionWhileReviewing(press('y', { ctrlKey: true, shiftKey: true }))).toBe('toggle');
  });

  it('leaves aiming keys to the panel, whose buttons need the keyboard', () => {
    for (const key of ['c', 'p', 'r', 'v', 'Enter', ' ']) {
      expect(actionWhileReviewing(press(key))).toBeUndefined();
    }
  });
});
