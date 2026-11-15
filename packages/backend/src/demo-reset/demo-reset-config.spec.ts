import {
  DEFAULT_DEMO_RESET_HOUR_UTC,
  DEFAULT_DEMO_RESET_LABEL,
  findCandidateRevisions,
  MAX_CANDIDATES,
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
      targets: [],
      label: DEFAULT_DEMO_RESET_LABEL,
      hourUtc: DEFAULT_DEMO_RESET_HOUR_UTC,
    });
  });

  it('reads token:revision pairs, trimming and skipping empties', () => {
    const config = parseDemoResetConfig(
      env({ WAFFLEBASE_DEMO_RESET_TARGETS: ' a : r1 , ,b,c:, ' }),
    );
    expect(config.targets).toEqual([
      { token: 'a', revisionId: 'r1' },
      { token: 'b', revisionId: undefined },
      { token: 'c', revisionId: undefined },
    ]);
  });

  it('keeps the last entry for a repeated token', () => {
    const config = parseDemoResetConfig(
      env({ WAFFLEBASE_DEMO_RESET_TARGETS: 'a:r1,a:r2' }),
    );
    expect(config.targets).toEqual([{ token: 'a', revisionId: 'r2' }]);
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

describe('findCandidateRevisions', () => {
  const at = new Date(Date.UTC(2026, 10, 15));

  function rev(id: string, label: string): RevisionRef {
    return { id, label, createdAt: at };
  }

  function filler(n: number, from = 0): RevisionRef[] {
    return Array.from({ length: n }, (_, i) =>
      rev(`auto-${from + i}`, `snapshot-${from + i}`),
    );
  }

  function pages(all: RevisionRef[]) {
    return jest.fn((offset: number) =>
      Promise.resolve(all.slice(offset, offset + REVISION_PAGE_SIZE)),
    );
  }

  it('returns labelled revisions newest first', async () => {
    const listPage = pages([
      ...filler(3),
      rev('new', 'demo-golden'),
      rev('old', ' demo-golden '),
    ]);
    const found = await findCandidateRevisions(listPage, 'demo-golden');
    expect(found.map((r) => r.id)).toEqual(['new', 'old']);
    expect(listPage).toHaveBeenCalledTimes(1);
  });

  it('pages past the first page and dedupes a shifted boundary', async () => {
    const boundary = rev('b', 'demo-golden');
    const first = [...filler(REVISION_PAGE_SIZE - 1), boundary];
    const second = [boundary, rev('deeper', 'demo-golden')];
    const listPage = jest.fn((offset: number) =>
      Promise.resolve(offset === 0 ? first : second),
    );
    const found = await findCandidateRevisions(listPage, 'demo-golden');
    expect(found.map((r) => r.id)).toEqual(['b', 'deeper']);
    expect(listPage).toHaveBeenNthCalledWith(2, REVISION_PAGE_SIZE);
  });

  it('stops at MAX_CANDIDATES', async () => {
    const listPage = pages(
      Array.from({ length: MAX_CANDIDATES + 3 }, (_, i) =>
        rev(`g${i}`, 'demo-golden'),
      ),
    );
    const found = await findCandidateRevisions(listPage, 'demo-golden');
    expect(found).toHaveLength(MAX_CANDIDATES);
  });

  it('gives up after the page cap', async () => {
    const listPage = jest.fn((offset: number) =>
      Promise.resolve(filler(REVISION_PAGE_SIZE, offset)),
    );
    await expect(
      findCandidateRevisions(listPage, 'demo-golden'),
    ).resolves.toEqual([]);
    expect(listPage).toHaveBeenCalledTimes(REVISION_MAX_PAGES);
  });
});
