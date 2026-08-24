import { describe, expect, it } from 'vitest';
import { DEBUG_SESSION_ID, newSessionId } from './session-id';

describe('newSessionId', () => {
  it('does not collide for two tabs opened in the same millisecond', () => {
    // The id was the clock alone, so two tabs took the same one — which meant
    // they shared a `.wb-reports/<sessionId>` directory and a persistence key,
    // so one tab's bundle could be written over the other's and the store's
    // adoption check read both as the same session.
    const clock = () => 1_770_000_000_000;
    const a = newSessionId(clock, () => 0.1234);
    const b = newSessionId(clock, () => 0.9876);
    expect(a).not.toBe(b);
  });

  it('keeps the clock prefix, so a directory listing sorts by when', () => {
    // REAL epoch milliseconds, because that is the only range where the claim
    // holds: base-36 of a 13-digit number is eight characters, and a
    // lexicographic sort agrees with a numeric one only at a fixed width. Toy
    // values like 1_000 and 2_000 differ in width and sort the other way.
    const earlier = newSessionId(() => Date.parse('2026-08-24T00:00:00Z'), () => 0.5);
    const later = newSessionId(() => Date.parse('2026-08-25T00:00:00Z'), () => 0.5);
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('is a plain filename — it names a directory', () => {
    // `.wb-reports/<sessionId>` is a path, and the write endpoint rejects a
    // segment that is not an ordinary name.
    for (const random of [() => 0, () => 0.5, () => 0.999999]) {
      expect(newSessionId(() => 1_770_000_000_000, random)).toMatch(/^wb-[0-9a-z]+-[0-9a-z]{6}$/);
    }
  });

  it('exports one derivation for both users', () => {
    // It was computed independently in `mount.tsx` and `use-debug-session.ts`,
    // so the report directory and the persisted session agreed only because both
    // modules happened to evaluate in the same millisecond.
    expect(DEBUG_SESSION_ID).toMatch(/^wb-[0-9a-z]+-[0-9a-z]{6}$/);
  });
});
