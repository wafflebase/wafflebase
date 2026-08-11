import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeClasses, analyzeNodes, analyzeScene } from '../../src/server/extract.mjs';
import { findJsxRoots, parse } from '../../src/server/jsx-nodes.mjs';

/**
 * THE RE-KEYING GUARD.
 *
 * Any object keyed by an identifier taken from a CONSUMER'S SOURCE is a
 * prototype-pollution surface: `roots.__proto__ = tree` hits the inherited
 * setter instead of defining a key, so that component vanishes with nothing
 * reported, and `roots.valueOf` answers with an inherited method — truthy, so a
 * caller testing `if (roots[name])` walks a function instead of reporting "no
 * such component".
 *
 * `findJsxRoots` was fixed for this in #718. `analyzeNodes` then copied its
 * entries into a plain `{}` and undid the fix one layer down, which is the whole
 * reason this file exists: a per-call-site convention failed even with the
 * author who had just written the nine-line comment explaining it. A helper you
 * must remember to call fails the same way.
 *
 * So the guard is a TABLE, not discipline. Every export returning a map keyed by
 * source identifiers gets a row. Adding an export without adding a row is the
 * only way to evade it, and that omission is visible in review.
 *
 * DELIBERATELY NOT LISTED, and the distinction is the point: `analyzeClasses`
 * returns `antiPatterns`, built with `Object.fromEntries` — a prototyped object.
 * It is safe because its keys come from `ANTI_KEYS`, a closed vocabulary in our
 * own source. No consumer identifier can reach it. The rule is about *who
 * chooses the key*, not about which constructor was used; a table that flagged
 * this too would teach the wrong lesson. `asserted below` pins that reasoning so
 * it cannot quietly stop being true.
 */

const dir = mkdtempSync(join(tmpdir(), 'wb-namekeys-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function fixture(src) {
  const p = join(dir, `f${n++}.tsx`);
  writeFileSync(p, src, 'utf8');
  return p;
}

/** Source whose component names collide with `Object.prototype` members. */
const HOSTILE = `
  function toString() { return <div/>; }
  function valueOf() { return <span/>; }
  function __proto__() { return <b/>; }
`;

/**
 * Every export that returns a map keyed by identifiers from consumer source.
 * One row per such map. `get` returns the map from a call on HOSTILE input.
 */
const NAME_KEYED = [
  {
    what: 'findJsxRoots().roots',
    get: () => findJsxRoots(parse(HOSTILE, 'x.tsx')).roots,
  },
  {
    what: 'analyzeNodes().roots',
    get: () => analyzeNodes(fixture(HOSTILE)).roots,
  },
  {
    what: 'analyzeScene().roots',
    get: () => analyzeScene(fixture(HOSTILE), { id: 's', kind: 'dom', label: 'S' }).roots,
  },
];

describe('maps keyed by consumer identifiers carry no prototype', () => {
  for (const { what, get } of NAME_KEYED) {
    it(`${what} has a null prototype`, () => {
      expect(Object.getPrototypeOf(get())).toBeNull();
    });

    it(`${what} registers every hostile name as an ordinary key`, () => {
      const map = get();
      // `__proto__` is the sharp one: on a plain `{}` the assignment hits the
      // inherited setter, so the component disappears from `Object.keys`.
      expect(Object.keys(map).sort()).toEqual(['__proto__', 'toString', 'valueOf']);
    });

    it(`${what} reports an absent name as absent, not as an inherited method`, () => {
      // On a plain `{}` this answers with `Object.prototype.hasOwnProperty` —
      // truthy, so `if (map[name])` proceeds on a function.
      expect(get().hasOwnProperty).toBeUndefined();
      expect(get().constructor).toBeUndefined();
    });
  }
});

describe('the exemption, so it stays a decision', () => {
  it('antiPatterns is prototyped, and that is fine — its keys are ours', () => {
    // Built by `Object.fromEntries`, so it HAS Object.prototype. Excluded from
    // the table above because every key comes from `ANTI_KEYS`; no identifier
    // from a consumer's source can reach it. If that ever changes — a key
    // derived from scanned source — this test is the thing that should start
    // looking wrong.
    const { antiPatterns } = analyzeClasses(['bg-blue-500']);
    expect(Object.getPrototypeOf(antiPatterns)).toBe(Object.prototype);
    expect(Object.keys(antiPatterns).sort()).toEqual([
      'arbitraryPx',
      'hardcodedNamedColors',
      'hardcodedPaletteColors',
      'hexLiterals',
      'rgbHslLiterals',
    ]);
  });
});

describe('the table itself', () => {
  it('covers every map this package hands out', () => {
    // Guards the guard. If a new name-keyed export lands without a row, the
    // count is the reminder — and the count is asserted rather than trusted
    // because an empty table would make every loop above pass vacuously.
    expect(NAME_KEYED).toHaveLength(3);
    for (const { get } of NAME_KEYED) expect(Object.keys(get()).length).toBeGreaterThan(0);
  });
});
