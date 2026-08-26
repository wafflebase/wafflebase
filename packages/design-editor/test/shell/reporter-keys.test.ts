import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '@wafflebase/debug-report';
import { isReporterKey, REPORTER_SINGLE_KEYS } from '../../src/shell/App.tsx';

/**
 * The shell forwards the reporter's keys into the scene frame, so it has to know
 * what they are — and it cannot import them, because the reporter is an optional
 * peer and this file is the shell's bundle.
 *
 * This is the joint holding that duplication honest. It exists because the
 * duplication had ALREADY drifted: the shell forwarded `p` after the package
 * dropped that binding, which meant it swallowed a key nothing would answer,
 * taking it from the scene's own app whenever the pointer was over a frame.
 */
describe('the shell forwards exactly the reporter’s bindings', () => {
  const singleKeys = Object.values(DEFAULT_BINDINGS)
    .filter((c) => !c.mod && !c.shift && !c.alt)
    .map((c) => c.key.toLowerCase())
    .sort();

  it('lists every single-key binding the package defines, and no others', () => {
    expect([...REPORTER_SINGLE_KEYS].sort()).toEqual(singleKeys);
  });

  it('recognises the toggle as the package spells it', () => {
    const t = DEFAULT_BINDINGS.toggle;
    expect({ key: t.key, mod: t.mod, shift: t.shift }).toEqual({ key: 'y', mod: true, shift: true });
    expect(isReporterKey({ key: 'Y', ctrlKey: true, shiftKey: true } as KeyboardEvent)).toBe(true);
    expect(isReporterKey({ key: 'y', metaKey: true, shiftKey: true } as KeyboardEvent)).toBe(true);
  });

  it('leaves the shell’s own chords alone', () => {
    // `Mod+Y` and `Mod+Shift+Z` are redo, `Mod+S` is save. Claiming any of them
    // is the bug this whole path was introduced to fix, in reverse.
    expect(isReporterKey({ key: 'y', ctrlKey: true } as KeyboardEvent)).toBe(false);
    expect(isReporterKey({ key: 'z', ctrlKey: true, shiftKey: true } as KeyboardEvent)).toBe(false);
    expect(isReporterKey({ key: 's', ctrlKey: true } as KeyboardEvent)).toBe(false);
  });

  it('does not claim a modified or shifted single key', () => {
    expect(isReporterKey({ key: 'c' } as KeyboardEvent)).toBe(true);
    expect(isReporterKey({ key: 'C', shiftKey: true } as KeyboardEvent)).toBe(false);
    expect(isReporterKey({ key: 'c', altKey: true } as KeyboardEvent)).toBe(false);
    expect(isReporterKey({ key: 'c', ctrlKey: true } as KeyboardEvent)).toBe(false);
  });
});
