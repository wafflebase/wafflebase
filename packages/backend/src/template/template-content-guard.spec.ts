import { findExternalDataTabs } from './template-content-guard';

describe('findExternalDataTabs', () => {
  it('returns nothing for a document of ordinary sheets', () => {
    expect(
      findExternalDataTabs(
        { a: { name: 'Sheet1', type: 'sheet' }, b: { name: 'Sheet2' } },
        ['a', 'b'],
      ),
    ).toEqual([]);
  });

  it('names datasource and lakehouse tabs in tab order', () => {
    const tabs = {
      c: { name: 'Warehouse', type: 'lakehouse' },
      a: { name: 'Summary', type: 'sheet' },
      b: { name: 'Orders', type: 'datasource' },
    };
    expect(findExternalDataTabs(tabs, ['a', 'b', 'c'])).toEqual([
      'Orders',
      'Warehouse',
    ]);
  });

  it('finds a tab missing from tabOrder', () => {
    // Otherwise a stale or partial `tabOrder` would hide a tab from the check.
    expect(
      findExternalDataTabs({ a: { name: 'Orders', type: 'datasource' } }, []),
    ).toEqual(['Orders']);
  });

  it('reports each tab once when tabOrder repeats it', () => {
    expect(
      findExternalDataTabs({ a: { name: 'Orders', type: 'datasource' } }, [
        'a',
        'a',
      ]),
    ).toEqual(['Orders']);
  });

  it('falls back to the tab id when a tab has no usable name', () => {
    expect(
      findExternalDataTabs({ t9: { type: 'datasource', name: '' } }),
    ).toEqual(['t9']);
  });

  it('tolerates a root with no tabs at all', () => {
    // A document nobody has opened has an empty root.
    expect(findExternalDataTabs(undefined, undefined)).toEqual([]);
    expect(findExternalDataTabs(null)).toEqual([]);
    expect(findExternalDataTabs([], 'not-an-array')).toEqual([]);
  });

  it('ignores entries that are not tab objects', () => {
    expect(findExternalDataTabs({ a: 'datasource', b: null })).toEqual([]);
  });
});
