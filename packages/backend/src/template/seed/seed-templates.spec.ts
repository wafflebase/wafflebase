import yorkieSdk from '@yorkie-js/sdk';
import type { YorkieService } from '../../yorkie/yorkie.service';
import { expectedRootHash, hashRootJson, writeContent } from './seed-templates';
import type { SeedContent } from './types';

/**
 * The root hash is what `writeContent` refuses a write over and what
 * `sync:templates` approves a listing against, so the axis-id canonicalization
 * it is built on has to be injective: two different worksheets must not share
 * a hash. The case that broke it is a key that is not an axis id but is
 * literally equal to the positional name a real axis id renames to.
 */
describe('hashRootJson', () => {
  const sheetRoot = (worksheet: Record<string, unknown>): string =>
    JSON.stringify({
      tabOrder: ['tab'],
      tabs: { tab: { name: 'Sheet1' } },
      sheets: { tab: { rowOrder: ['ra'], colOrder: ['ca'], ...worksheet } },
    });

  const clean = { cells: { 'ra|ca': { v: 'ok' } } };

  it('moves when a cell is injected under a positional-looking key', () => {
    const injectedFirst = {
      cells: { 'r0|c0': { v: 'evil' }, 'ra|ca': { v: 'ok' } },
    };
    const injectedLast = {
      cells: { 'ra|ca': { v: 'ok' }, 'r0|c0': { v: 'evil' } },
    };
    expect(hashRootJson(sheetRoot(injectedFirst))).not.toBe(
      hashRootJson(sheetRoot(clean)),
    );
    // Both member orders, since a dropped member depended on which of the two
    // colliding keys was rebuilt last.
    expect(hashRootJson(sheetRoot(injectedLast))).not.toBe(
      hashRootJson(sheetRoot(clean)),
    );
    // And the two injections are the same worksheet, so they agree.
    expect(hashRootJson(sheetRoot(injectedFirst))).toBe(
      hashRootJson(sheetRoot(injectedLast)),
    );
  });

  it('moves when a bare positional-looking axis key is injected', () => {
    const cleanSizes = { ...clean, rowHeights: { ra: 20 } };
    const injected = { ...clean, rowHeights: { r0: 99, ra: 20 } };
    expect(hashRootJson(sheetRoot(injected))).not.toBe(
      hashRootJson(sheetRoot(cleanSizes)),
    );
  });

  it('still renames by position, so two mintings of one grid agree', () => {
    const other = JSON.stringify({
      tabOrder: ['tab'],
      tabs: { tab: { name: 'Sheet1' } },
      sheets: {
        tab: {
          rowOrder: ['rb'],
          colOrder: ['cb'],
          cells: { 'rb|cb': { v: 'ok' } },
        },
      },
    });
    expect(hashRootJson(other)).toBe(hashRootJson(sheetRoot(clean)));
  });

  // A member named `__proto__` is an own property of what `JSON.parse`
  // returns, but assigning it onto a fresh `{}` reaches `Object.prototype`'s
  // setter instead of creating a property — so a rebuild that assigns would
  // drop it from the hash, past the collision guard, and let injected content
  // sit under an approved listing.
  it('moves when content is injected under a __proto__ key', () => {
    // A computed key, not the literal `__proto__:` form, which sets the
    // prototype rather than creating the own property the hash has to see.
    const injected = { cells: { 'ra|ca': { v: 'ok' } }, ['__proto__']: 1 };
    expect(hashRootJson(sheetRoot(injected))).not.toBe(
      hashRootJson(sheetRoot(clean)),
    );
    const nested = {
      cells: { 'ra|ca': { v: 'ok' }, ['__proto__']: { v: 'evil' } },
    };
    expect(hashRootJson(sheetRoot(nested))).not.toBe(
      hashRootJson(sheetRoot(clean)),
    );
  });

  it('separates a moved cell from an unmoved one', () => {
    const moved = {
      cells: { 'ra|ca': { v: 'ok' } },
      rowOrder: ['rz', 'ra'],
    };
    expect(hashRootJson(sheetRoot(moved))).not.toBe(
      hashRootJson(sheetRoot(clean)),
    );
  });
});

/**
 * Cell text is what a viewer reads, so it is hashed as stored — never renamed
 * as if it were an axis reference. Renaming it folded a cell reading `ra`
 * (the first row's id) into the positional name `r0`.
 */
describe('hashRootJson cell text', () => {
  const root = (rowOrder: string[], v: string, f?: string): string =>
    JSON.stringify({
      tabOrder: ['tab'],
      tabs: { tab: { name: 'Sheet1' } },
      sheets: {
        tab: {
          rowOrder,
          colOrder: ['ca'],
          cells: { [`${rowOrder[0]}|ca`]: { v, ...(f ? { f } : {}) } },
        },
      },
    });

  // Within one grid this already held once 8232deb escaped literal positional
  // names (`r0` → `~r0`); it guards that escaping. The tests that fail
  // without verbatim cell text are the re-minted ones below.
  it('moves when a cell is edited to read an axis id', () => {
    expect(hashRootJson(root(['ra'], 'ra'))).not.toBe(
      hashRootJson(root(['ra'], 'r0')),
    );
    expect(hashRootJson(root(['ra'], 'ra'))).not.toBe(
      hashRootJson(root(['ra'], 'hello')),
    );
  });

  it('does not let a re-minted grid carry different text under one hash', () => {
    // Renaming text with the ids made `ra` over row `ra` and `rb` over row
    // `rb` the same worksheet, though one reads "ra" and the other "rb".
    expect(hashRootJson(root(['ra'], 'ra'))).not.toBe(
      hashRootJson(root(['rb'], 'rb')),
    );
    // Same text over a re-minted id is still the same worksheet.
    expect(hashRootJson(root(['ra'], 'ra'))).toBe(
      hashRootJson(root(['rb'], 'ra')),
    );
  });

  it('hashes a cell formula as written, not only its value', () => {
    // The re-minted form, as above, on `f`. Renaming matched a whole string
    // (or a `|`-separated part) equal to an id, so it is an `f` reading
    // exactly the row id that folded — `=ra` was never renamed.
    expect(hashRootJson(root(['ra'], '1', 'ra'))).not.toBe(
      hashRootJson(root(['rb'], '1', 'rb')),
    );
  });
});

/**
 * `renameAxisIds` refuses a key that collides after renaming. That branch is
 * unreachable by construction — the renaming is injective: an axis id becomes
 * a bare `r<i>`/`c<j>`, a literal that looks like one gains a `~`, anything
 * else is kept, and a JSON object cannot repeat a key — so there is no fixture
 * that reaches it. What is tested instead is the property it stands behind:
 * adversarial keys, each a plausible collision, survive as distinct members.
 */
describe('hashRootJson axis-id renaming is injective', () => {
  const keys = ['ra|ca', 'r0|c0', '~r0|c0', '~~r0|~c0', 'ra|c0', 'r0|ca'];
  const sheetWith = (present: string[]): string =>
    JSON.stringify({
      sheets: {
        tab: {
          rowOrder: ['ra'],
          colOrder: ['ca'],
          cells: Object.fromEntries(present.map((k) => [k, { v: 'x' }])),
          rowHeights: Object.fromEntries(present.map((k) => [k, 1])),
        },
      },
    });

  it('never merges two members, so dropping any one moves the hash', () => {
    const full = hashRootJson(sheetWith(keys));
    for (const k of keys) {
      expect(hashRootJson(sheetWith(keys.filter((x) => x !== k)))).not.toBe(
        full,
      );
    }
  });
});

describe('writeContent', () => {
  const content = {
    kind: 'note',
    document: { content: '# Hello' },
  } as unknown as SeedContent;

  /**
   * The refusal runs *inside* the updater, the only place it withholds the
   * change. A root whose half-built state reports a member the catalogue never
   * defined stands in for any write that would leave content behind.
   */
  it('refuses from inside the update, leaving nothing to push', async () => {
    const doc = new yorkieSdk.Document<Record<string, unknown>>(
      'seed-refusal-test',
    );
    const tainted = {
      update(updater: (root: Record<string, unknown>) => void) {
        doc.update((root) => {
          updater(
            new Proxy(root, {
              get(target, prop, receiver) {
                if (prop !== 'toJSON')
                  return Reflect.get(target, prop, receiver) as unknown;
                return () =>
                  JSON.stringify({
                    ...(JSON.parse(
                      (target as unknown as { toJSON(): string }).toJSON(),
                    ) as object),
                    smuggled: true,
                  });
              },
            }),
          );
        });
      },
    };
    const yorkie = {
      withDocument: (_id: string, cb: (d: unknown) => unknown) =>
        Promise.resolve(cb(tainted)),
    } as unknown as YorkieService;

    await expect(writeContent(yorkie, 'doc-id', content)).rejects.toThrow(
      /nothing was written/,
    );
    // Yorkie discarded the clone: no root change and no local change to ship.
    expect(doc.toSortedJSON()).toBe('{}');
    expect(doc.hasLocalChanges()).toBe(false);
  });

  it('writes and returns the catalogue hash when the root matches', async () => {
    const doc = new yorkieSdk.Document<Record<string, unknown>>(
      'seed-write-test',
    );
    const yorkie = {
      withDocument: (_id: string, cb: (d: unknown) => unknown) => cb(doc),
    } as unknown as YorkieService;

    await expect(writeContent(yorkie, 'doc-id', content)).resolves.toBe(
      expectedRootHash(content),
    );
    expect(doc.hasLocalChanges()).toBe(true);
  });
});
