import { hashRootJson } from './seed-templates';

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
