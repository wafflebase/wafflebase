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

  // Tokens are numbered in collection order, depth first: the slide `s-1` is
  // `#0`, the element is `#1`, its block `<id>-p0` is `#2`, the connector
  // `c-1` is `#3`. The tests below name `#1` / `#2` because those are the
  // tokens the element and its block really take; any other number is a
  // literal the old canonicalization already kept apart, and proves nothing.
  const ELEMENT_TOKEN = '#1';
  const BLOCK_TOKEN = '#2';

  it('still ignores which id the builders happened to mint', () => {
    expect(seedContentHash(deck('a1b2c3d4', 'Hi'))).toBe(
      seedContentHash(deck('9f8e7d6c', 'Hi')),
    );
  });

  it('moves when text is edited to read like a token', () => {
    // `x` renames to `#1`. Text reading `x` used to take that token, and
    // text reading `#1` was left alone, so the two decks hashed the same.
    expect(seedContentHash(deck('x', 'x'))).not.toBe(
      seedContentHash(deck('x', ELEMENT_TOKEN)),
    );
  });

  it('hashes text as written, not as the id it happens to equal', () => {
    // Two decks whose only difference is what the paragraph reads.
    expect(seedContentHash(deck('x', 'x'))).not.toBe(
      seedContentHash(deck('y', 'y')),
    );
  });

  it('keeps a token-looking literal apart from a renamed reference', () => {
    // A connector pointing at the element (`x` → `#1`) and one whose `from`
    // is the literal string `#1` are different decks.
    expect(seedContentHash(deck('x', 'Hi', 'x'))).not.toBe(
      seedContentHash(deck('x', 'Hi', ELEMENT_TOKEN)),
    );
    // The same for the block id (`x-p0` → `#2`) …
    expect(seedContentHash(deck('x', 'Hi', 'x-p0'))).not.toBe(
      seedContentHash(deck('x', 'Hi', BLOCK_TOKEN)),
    );
    // … and for a string keyed off the element (`x-q` → `#1-q`).
    expect(seedContentHash(deck('x', 'Hi', 'x-q'))).not.toBe(
      seedContentHash(deck('x', 'Hi', `${ELEMENT_TOKEN}-q`)),
    );
  });
});
