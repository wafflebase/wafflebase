import { seedContentHash } from './seed-hash';
import type { SeedContent } from './types';

/**
 * `seedContentHash` decides whether `sync:templates` rewrites a seed and
 * whether a rendered thumbnail is still the catalogue's, so the id
 * canonicalization under it has to be injective: two contents a viewer can
 * tell apart must not share a hash.
 */
describe('seedContentHash', () => {
  const deck = (id: string, text: string, ref = id): SeedContent =>
    ({
      kind: 'slides',
      document: {
        slides: [
          {
            id: 's-1',
            elements: [
              { id, data: { blocks: [{ id: `${id}-p0`, text }] } },
              { id: 'c-1', type: 'connector', from: ref },
            ],
          },
        ],
      },
    }) as unknown as SeedContent;

  it('still ignores which id the builders happened to mint', () => {
    expect(seedContentHash(deck('a1b2c3d4', 'Hi'))).toBe(
      seedContentHash(deck('9f8e7d6c', 'Hi')),
    );
  });

  it('moves when text is edited to read like a token', () => {
    // `x` is the first id collected, so it renames to `#0`; text reading
    // `#0` used to be left alone and so hashed the same as text reading `x`.
    expect(seedContentHash(deck('x', 'x'))).not.toBe(
      seedContentHash(deck('x', '#0')),
    );
  });

  it('hashes text as written, not as the id it happens to equal', () => {
    // Two decks whose only difference is what the paragraph reads.
    expect(seedContentHash(deck('x', 'x'))).not.toBe(
      seedContentHash(deck('y', 'y')),
    );
  });

  it('keeps a token-looking literal apart from a renamed reference', () => {
    // A connector pointing at the element (`x` → `#0`) and one whose `from`
    // is the literal string `#0` are different decks.
    expect(seedContentHash(deck('x', 'Hi', 'x'))).not.toBe(
      seedContentHash(deck('x', 'Hi', '#0')),
    );
    expect(seedContentHash(deck('x', 'Hi', '#0-p0'))).not.toBe(
      seedContentHash(deck('x', 'Hi', 'x-p0')),
    );
  });
});
