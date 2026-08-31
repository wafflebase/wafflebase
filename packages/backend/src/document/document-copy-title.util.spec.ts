import { copyTitle, uniqueTitle } from './document-copy-title.util';

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

describe('uniqueTitle', () => {
  it('uses the name itself when it is free', () => {
    // The whole point of the split from copyTitle: a document started from a
    // "Weekly Report" template is a weekly report, not a copy of one.
    expect(uniqueTitle('Weekly Report', [])).toBe('Weekly Report');
  });

  it('numbers only on collision', () => {
    expect(uniqueTitle('Weekly Report', ['Weekly Report'])).toBe(
      'Weekly Report (2)',
    );
  });

  it('keeps counting', () => {
    expect(
      uniqueTitle('Weekly Report', [
        'Weekly Report',
        'Weekly Report (2)',
        'Weekly Report (3)',
      ]),
    ).toBe('Weekly Report (4)');
  });

  it('reuses a gap in the numbering', () => {
    expect(
      uniqueTitle('Weekly Report', ['Weekly Report', 'Weekly Report (3)']),
    ).toBe('Weekly Report (2)');
  });

  it('clamps to 200 chars by trimming the base, never the suffix', () => {
    const long = 'a'.repeat(200);
    expect(uniqueTitle(long, [])).toHaveLength(200);
    const second = uniqueTitle(long, [long]);
    expect(second).toHaveLength(200);
    expect(second.endsWith(' (2)')).toBe(true);
  });
});
