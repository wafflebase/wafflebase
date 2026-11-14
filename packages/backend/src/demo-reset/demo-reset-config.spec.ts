import {
  DEFAULT_DEMO_RESET_HOUR_UTC,
  DEFAULT_DEMO_RESET_LABEL,
  findNewestRevision,
  msUntilNextRun,
  parseDemoResetConfig,
  REVISION_MAX_PAGES,
  REVISION_PAGE_SIZE,
  RevisionRef,
} from './demo-reset-config';

const HOUR = 60 * 60 * 1000;

function env(values: Record<string, string>) {
  return (key: string) => values[key];
}

describe('parseDemoResetConfig', () => {
  it('is disabled with defaults when nothing is set', () => {
    expect(parseDemoResetConfig(env({}))).toEqual({
      tokens: [],
      label: DEFAULT_DEMO_RESET_LABEL,
      hourUtc: DEFAULT_DEMO_RESET_HOUR_UTC,
    });
  });

  it('trims, drops empties and dedupes tokens', () => {
    const config = parseDemoResetConfig(
      env({ WAFFLEBASE_DEMO_RESET_TOKENS: ' a, ,b,a ,' }),
    );
    expect(config.tokens).toEqual(['a', 'b']);
  });

  it('reads the label and hour', () => {
    const config = parseDemoResetConfig(
      env({
        WAFFLEBASE_DEMO_RESET_LABEL: ' golden ',
        WAFFLEBASE_DEMO_RESET_HOUR_UTC: '0',
      }),
    );
    expect(config.label).toBe('golden');
    expect(config.hourUtc).toBe(0);
  });

  it.each(['', '24', '-1', '3.5', 'noon'])(
    'falls back to the default hour for %p',
    (raw) => {
      const config = parseDemoResetConfig(
        env({ WAFFLEBASE_DEMO_RESET_HOUR_UTC: raw }),
      );
      expect(config.hourUtc).toBe(DEFAULT_DEMO_RESET_HOUR_UTC);
    },
  );

  it('treats an empty label as unset', () => {
    const config = parseDemoResetConfig(
      env({ WAFFLEBASE_DEMO_RESET_LABEL: '  ' }),
    );
    expect(config.label).toBe(DEFAULT_DEMO_RESET_LABEL);
  });
});

describe('msUntilNextRun', () => {
  it('waits for later today', () => {
    const now = new Date(Date.UTC(2026, 10, 15, 10, 30));
    expect(msUntilNextRun(now, 15)).toBe(4.5 * HOUR);
  });

  it('rolls over to tomorrow once the hour has passed', () => {
    const now = new Date(Date.UTC(2026, 10, 15, 16));
    expect(msUntilNextRun(now, 15)).toBe(23 * HOUR);
  });

  it('schedules a full day ahead when fired exactly on time', () => {
    const now = new Date(Date.UTC(2026, 10, 15, 15));
    expect(msUntilNextRun(now, 15)).toBe(24 * HOUR);
  });

  it('crosses a month boundary', () => {
    const now = new Date(Date.UTC(2026, 10, 30, 23));
    expect(msUntilNextRun(now, 0)).toBe(HOUR);
  });
});

describe('findNewestRevision', () => {
  function pages(all: RevisionRef[]) {
    const listPage = jest.fn((offset: number) =>
      Promise.resolve(all.slice(offset, offset + REVISION_PAGE_SIZE)),
    );
    return listPage;
  }

  function filler(n: number, from = 0): RevisionRef[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `auto-${from + i}`,
      label: `snapshot-${from + i}`,
    }));
  }

  it('returns the first (newest) match', async () => {
    const listPage = pages([
      ...filler(3),
      { id: 'new', label: 'demo-golden' },
      { id: 'old', label: 'demo-golden' },
    ]);
    await expect(findNewestRevision(listPage, 'demo-golden')).resolves.toEqual({
      id: 'new',
      label: 'demo-golden',
    });
    expect(listPage).toHaveBeenCalledTimes(1);
  });

  it('pages past the first page', async () => {
    const listPage = pages([
      ...filler(REVISION_PAGE_SIZE + 7),
      { id: 'golden', label: ' demo-golden ' },
    ]);
    await expect(
      findNewestRevision(listPage, 'demo-golden'),
    ).resolves.toMatchObject({ id: 'golden' });
    expect(listPage).toHaveBeenNthCalledWith(2, REVISION_PAGE_SIZE);
  });

  it('stops at a short page when the label is missing', async () => {
    const listPage = pages(filler(REVISION_PAGE_SIZE + 1));
    await expect(findNewestRevision(listPage, 'demo-golden')).resolves.toBe(
      null,
    );
    expect(listPage).toHaveBeenCalledTimes(2);
  });

  it('gives up after the page cap', async () => {
    const listPage = jest.fn((offset: number) =>
      Promise.resolve(filler(REVISION_PAGE_SIZE, offset)),
    );
    await expect(findNewestRevision(listPage, 'demo-golden')).resolves.toBe(
      null,
    );
    expect(listPage).toHaveBeenCalledTimes(REVISION_MAX_PAGES);
  });
});
