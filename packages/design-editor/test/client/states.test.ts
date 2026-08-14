import { describe, expect, it } from 'vitest';
import {
  buildColorClass,
  derivedStateValue,
  forcedStateClasses,
  opacityLabel,
  parseColorClasses,
  promotedTokenKey,
  STATE_UTILITIES,
  stateSlots,
} from '../../src/client/states.ts';

const ROLES = ['primary', 'secondary', 'accent', 'primary-foreground'];

describe('parseColorClasses', () => {
  it('reads the utility, role, modifiers and alpha out of one token', () => {
    const [c] = parseColorClasses('dark:hover:bg-primary/90', ROLES, STATE_UTILITIES);
    expect(c).toMatchObject({
      className: 'dark:hover:bg-primary/90',
      mods: ['dark', 'hover'],
      state: 'hover',
      utility: 'bg',
      role: 'primary',
      opacity: 90,
    });
  });

  it('reports a resting class as having no state', () => {
    expect(parseColorClasses('bg-primary', ROLES, STATE_UTILITIES)[0]).toMatchObject({
      state: null,
      opacity: null,
    });
  });

  it('skips classes that are not on the token layer', () => {
    // `bg-zinc-300` and `text-white` are real Tailwind, but the state editor must not
    // appear to bless them — the anti-pattern warning owns that case.
    expect(parseColorClasses('bg-zinc-300 text-white', ROLES, STATE_UTILITIES)).toEqual([]);
  });

  it('prefers the longest utility when BOTH readings name a real role', () => {
    // `ring-offset-primary` splits two ways: `ring-` + `offset-primary`, or
    // `ring-offset-` + `primary`. The shorter utility is only wrong when its role
    // also exists — otherwise the role check already rejects it and the loop moves
    // on, which is why a role list without `offset-primary` proves nothing here.
    // Measured both ways before writing this.
    const roles = ['primary', 'offset-primary'];
    const [c] = parseColorClasses('ring-offset-primary', roles, ['ring', 'ring-offset']);
    expect(c).toMatchObject({ utility: 'ring-offset', role: 'primary' });
  });

  it('keeps a role that itself contains a dash', () => {
    expect(parseColorClasses('text-primary-foreground', ROLES, STATE_UTILITIES)[0]).toMatchObject({
      utility: 'text',
      role: 'primary-foreground',
    });
  });
});

describe('buildColorClass', () => {
  it('preserves the modifier chain and emits the alpha', () => {
    expect(
      buildColorClass({ mods: ['dark', 'hover'], utility: 'bg' }, { role: 'secondary', opacity: 70 }),
    ).toBe('dark:hover:bg-secondary/70');
  });

  it.each([[100], [null]])('emits no modifier at all for %s', (opacity) => {
    // 100 means "the plain token", not "alpha at full" — so no `/n` is written.
    expect(buildColorClass({ mods: [], utility: 'bg' }, { role: 'primary', opacity })).toBe(
      'bg-primary',
    );
  });
});

describe('stateSlots', () => {
  it('offers a state that source does not define, when a resting class exists', () => {
    const slots = stateSlots('bg-primary', ROLES, STATE_UTILITIES);
    const hover = slots.find((s) => s.id === 'hover|bg');
    expect(hover?.current).toBeNull();
    expect(hover?.base?.className).toBe('bg-primary');
  });

  it('pairs an existing state class with the resting one it derives from', () => {
    const slots = stateSlots('bg-primary hover:bg-primary/90', ROLES, STATE_UTILITIES);
    const hover = slots.find((s) => s.id === 'hover|bg');
    expect(hover?.current?.opacity).toBe(90);
    expect(hover?.base?.className).toBe('bg-primary');
  });

  it('emits nothing for a utility with neither a state nor a resting class', () => {
    expect(stateSlots('', ROLES, STATE_UTILITIES)).toEqual([]);
  });

  it('keeps light and dark in separate slots, each paired with its own resting class', () => {
    // Found in review. Keying by utility alone collapsed these four classes into ONE
    // `hover|bg` slot whose `current` was the DARK hover and whose `base` was the
    // LIGHT resting class — so the panel claimed `dark:hover:bg-secondary/90` derives
    // from `bg-primary`, and an edit computed from that base would write the wrong
    // role. Measured before and after the fix.
    const slots = stateSlots(
      'bg-primary dark:bg-secondary hover:bg-primary/90 dark:hover:bg-secondary/90',
      ROLES,
      STATE_UTILITIES,
    ).filter((s) => s.state === 'hover');

    expect(slots.map((s) => s.id)).toEqual(['hover|bg', 'dark|hover|bg']);
    expect(slots[0]).toMatchObject({
      context: '',
      current: { className: 'hover:bg-primary/90' },
      base: { className: 'bg-primary' },
    });
    expect(slots[1]).toMatchObject({
      context: 'dark',
      current: { className: 'dark:hover:bg-secondary/90' },
      base: { className: 'dark:bg-secondary' },
    });
  });

  it('does not offer a light resting class as the base for a dark-only state', () => {
    // The narrower half of the same bug: with no `dark:` resting class there is
    // nothing in that context to derive from, and saying otherwise would invent one.
    const dark = stateSlots('bg-primary dark:hover:bg-secondary/90', ROLES, STATE_UTILITIES).find(
      (s) => s.context === 'dark' && s.state === 'hover',
    );
    expect(dark?.current?.className).toBe('dark:hover:bg-secondary/90');
    expect(dark?.base).toBeNull();
  });
});

describe('forcedStateClasses', () => {
  it('drops the state modifier and keeps the rest', () => {
    // CSS pseudo-classes cannot be forced from JS, so the simulator promotes
    // `hover:`-prefixed utilities to unprefixed ones and lets twMerge win. `dark:`
    // stays, because the theme wrapper still decides whether it matches.
    expect(forcedStateClasses('dark:hover:bg-primary/90 bg-primary', 'hover')).toEqual([
      'dark:bg-primary/90',
    ]);
  });

  it('returns nothing when the state is absent', () => {
    expect(forcedStateClasses('bg-primary hover:bg-primary/90', 'active')).toEqual([]);
  });
});

describe('promotion helpers', () => {
  it('resolves an alpha to the color-mix a promoted token is seeded with', () => {
    expect(derivedStateValue('primary', 90)).toBe(
      'color-mix(in oklab, var(--primary) 90%, transparent)',
    );
  });

  it.each([[100], [null]])('uses the bare variable at %s', (opacity) => {
    expect(derivedStateValue('primary', opacity)).toBe('var(--primary)');
  });

  it('shortens focus-visible to focus in the promoted key', () => {
    expect(promotedTokenKey('primary', 'focus-visible')).toBe('primary-focus');
    expect(promotedTokenKey('primary', 'hover')).toBe('primary-hover');
  });

  it('says "no alpha" rather than "100%"', () => {
    expect(opacityLabel(100)).toBe('no alpha');
    expect(opacityLabel(90)).toBe('90%');
  });
});
