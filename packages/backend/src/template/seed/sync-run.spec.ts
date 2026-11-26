import {
  acquireSyncLock,
  parseSyncArgs,
  releaseSyncLock,
  selectSeeds,
  SYNC_LOCK_KEY,
  syncSeeds,
  type LockClient,
} from './sync-run';
import type { SeedThumbnail } from './template-sync';
import type { TemplateSeed } from './types';

const ENV = { INIT_CWD: '/work' };

describe('parseSyncArgs', () => {
  it('reads every option and resolves the directory where the operator ran it', () => {
    expect(
      parseSyncArgs(
        [
          '--author',
          '3',
          '--thumbnails',
          'thumbs',
          '--workspace',
          'ws-1',
          '--event-timeout',
          '5',
          'a',
          'b',
        ],
        ENV,
      ),
    ).toEqual({
      authorId: 3,
      thumbnails: '/work/thumbs',
      workspaceId: 'ws-1',
      eventTimeoutMs: 5_000,
      slugs: ['a', 'b'],
    });
  });

  it('defaults the event timeout to 30 seconds', () => {
    expect(
      parseSyncArgs(['--author', '3', '--thumbnails', '/t'], ENV)
        .eventTimeoutMs,
    ).toBe(30_000);
  });

  it.each([
    [['--thumbnails', '/t'], /--author/],
    [['--author', '0', '--thumbnails', '/t'], /--author/],
    [['--author', 'x', '--thumbnails', '/t'], /--author/],
    [['--author', '3'], /--thumbnails is required/],
    [['--author', '3', '--thumbnails'], /needs a value/],
    [['--author', '--thumbnails', '/t'], /needs a value/],
    [
      ['--author', '3', '--thumbnails', '/t', '--event-timeout', '0'],
      /timeout/,
    ],
    [['--author', '3', '--thumbnails', '/t', '--reset', 'x'], /Unknown option/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseSyncArgs(argv, ENV)).toThrow(message);
  });
});

describe('selectSeeds', () => {
  const catalog = [{ slug: 'a' }, { slug: 'b' }] as TemplateSeed[];

  it('selects all, or the named slugs', () => {
    expect(selectSeeds(catalog, [])).toBe(catalog);
    expect(selectSeeds(catalog, ['b'])).toEqual([{ slug: 'b' }]);
  });

  it('refuses an unknown slug', () => {
    expect(() => selectSeeds(catalog, ['zz'])).toThrow(/zz/);
  });
});

describe('the single-run lock', () => {
  function client(locked: boolean) {
    const c = {
      connect: jest.fn(() => Promise.resolve()),
      query: jest.fn(() => Promise.resolve({ rows: [{ locked }] })),
      end: jest.fn(() => Promise.resolve()),
    };
    return c as typeof c & LockClient;
  }

  it('takes the advisory lock on its own connection', async () => {
    const c = client(true);
    await acquireSyncLock(c);
    expect(c.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [SYNC_LOCK_KEY],
    );
    expect(c.end).not.toHaveBeenCalled();

    await releaseSyncLock(c);
    expect(c.query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock($1)', [
      SYNC_LOCK_KEY,
    ]);
    expect(c.end).toHaveBeenCalled();
  });

  it('refuses a second run while the lock is held, and closes its connection', async () => {
    const c = client(false);
    await expect(acquireSyncLock(c)).rejects.toThrow(/holds the lock/);
    expect(c.end).toHaveBeenCalled();
  });
});

describe('syncSeeds', () => {
  const seeds = [
    { slug: 'deck' },
    { slug: 'sheet' },
    { slug: 'broken' },
  ] as TemplateSeed[];
  const thumb = { sha256: 'x' } as SeedThumbnail;

  it('hands only seeds with a thumbnail to the state machine', async () => {
    const syncOne = jest.fn((seed: TemplateSeed) =>
      Promise.resolve({
        slug: seed.slug,
        result: 'published' as const,
        detail: 'ok',
      }),
    );
    const lookups = {
      deck: { kind: 'ok' as const, thumbnail: thumb },
      sheet: { kind: 'skipped' as const, reason: 'no renderer yet' },
      broken: { kind: 'failed' as const, reason: 'render threw' },
    };
    const report = jest.fn();

    const outcomes = await syncSeeds(
      seeds,
      { get: (slug) => Promise.resolve(lookups[slug as keyof typeof lookups]) },
      { syncOne },
      report,
    );

    expect(syncOne).toHaveBeenCalledTimes(1);
    expect(syncOne).toHaveBeenCalledWith(seeds[0], thumb);
    expect(outcomes).toEqual([
      { slug: 'deck', result: 'published', detail: 'ok' },
      {
        slug: 'sheet',
        result: 'skipped',
        detail: 'no thumbnail: no renderer yet',
      },
      {
        slug: 'broken',
        result: 'failed',
        detail: 'no thumbnail: render threw',
      },
    ]);
    expect(report).toHaveBeenCalledTimes(3);
  });
});
