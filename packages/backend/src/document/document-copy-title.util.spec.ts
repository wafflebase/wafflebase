import { copyTitle } from './document-copy-title.util';

describe('copyTitle', () => {
  it('appends "(copy)" when the name is free', () => {
    expect(copyTitle('Report', ['Report'])).toBe('Report (copy)');
  });

  it('numbers the copy when "(copy)" is taken', () => {
    expect(copyTitle('Report', ['Report', 'Report (copy)'])).toBe(
      'Report (copy 2)',
    );
  });

  it('keeps counting past the first numbered copy', () => {
    expect(
      copyTitle('Report', [
        'Report',
        'Report (copy)',
        'Report (copy 2)',
        'Report (copy 3)',
      ]),
    ).toBe('Report (copy 4)');
  });

  it('reuses a gap in the numbering', () => {
    expect(
      copyTitle('Report', ['Report', 'Report (copy)', 'Report (copy 3)']),
    ).toBe('Report (copy 2)');
  });

  it('only considers the titles it is given', () => {
    // Titles from another folder / workspace are not passed in, so they never
    // push the copy's number up.
    expect(copyTitle('Report', [])).toBe('Report (copy)');
  });

  it('copies a title that is already a copy', () => {
    expect(copyTitle('Report (copy)', ['Report (copy)'])).toBe(
      'Report (copy) (copy)',
    );
  });

  it('clamps to 200 chars by trimming the base, never the suffix', () => {
    const long = 'a'.repeat(200);
    const copy = copyTitle(long, [long]);
    expect(copy).toHaveLength(200);
    expect(copy.endsWith(' (copy)')).toBe(true);
  });
});
