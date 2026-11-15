import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShareLinkService } from '../share-link/share-link.service';
import { YorkieService } from '../yorkie/yorkie.service';
import { DemoResetService } from './demo-reset.service';

const DOCS: Record<string, { id: string; type: string }> = {
  'tok-sheet': { id: 'd-sheet', type: 'sheet' },
  'tok-doc': { id: 'd-doc', type: 'doc' },
  'tok-slides': { id: 'd-slides', type: 'slides' },
};

const AT = new Date(Date.UTC(2026, 10, 15));

function setup(
  values: Record<string, string>,
  revisions: Record<string, Array<{ id: string; label: string }>> = {},
) {
  const configService = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  const shareLinkService = {
    findByToken: jest.fn((token: string) => {
      const document = DOCS[token];
      return document
        ? Promise.resolve({ document })
        : Promise.reject(new NotFoundException('Share link not found'));
    }),
  };
  const restoreRevision = jest.fn<Promise<void>, [string, string]>(() =>
    Promise.resolve(),
  );
  const listRevisions = jest.fn((id: string, offset: number) =>
    Promise.resolve(
      offset === 0
        ? (revisions[id] ?? []).map((r) => ({ ...r, createdAt: AT }))
        : [],
    ),
  );
  const withDocument = jest.fn(
    (id: string, cb: (doc: unknown, client: unknown) => unknown) => {
      const client = {
        listRevisions: (_doc: unknown, { offset }: { offset: number }) =>
          listRevisions(id, offset),
        restoreRevision: (_doc: unknown, revisionId: string) =>
          restoreRevision(id, revisionId),
      };
      return Promise.resolve(cb({}, client));
    },
  );
  const service = new DemoResetService(
    configService,
    shareLinkService as unknown as ShareLinkService,
    { withDocument } as unknown as YorkieService,
  );
  return { service, restoreRevision, listRevisions, withDocument };
}

describe('DemoResetService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('restores each document to its pinned revision', async () => {
    const { service, restoreRevision, listRevisions, withDocument } = setup({
      WAFFLEBASE_DEMO_RESET_TARGETS: 'tok-sheet:r-sheet,tok-slides:r-slides',
    });

    await expect(service.resetAll()).resolves.toEqual(['restored', 'restored']);
    expect(restoreRevision.mock.calls).toEqual([
      ['d-sheet', 'r-sheet'],
      ['d-slides', 'r-slides'],
    ]);
    // The pin is the whole decision: no label search at reset time.
    expect(listRevisions).not.toHaveBeenCalled();
    expect(withDocument).toHaveBeenNthCalledWith(
      2,
      'd-slides',
      expect.any(Function),
      { syncMode: 'readonly', docKeyPrefix: 'slides-' },
    );
  });

  it('ignores a newer revision carrying the label', async () => {
    // Anyone holding the editor link can name a revision "demo-golden".
    const { service, restoreRevision } = setup(
      { WAFFLEBASE_DEMO_RESET_TARGETS: 'tok-sheet:pinned' },
      { 'd-sheet': [{ id: 'attacker', label: 'demo-golden' }] },
    );
    await service.resetAll();
    expect(restoreRevision).toHaveBeenCalledWith('d-sheet', 'pinned');
  });

  it('isolates a missing link and skips an unpinned entry', async () => {
    const { service, restoreRevision } = setup({
      WAFFLEBASE_DEMO_RESET_TARGETS: 'gone:r,tok-doc,tok-sheet:r-sheet',
    });

    await expect(service.resetAll()).resolves.toEqual([
      'failed',
      'unpinned',
      'restored',
    ]);
    expect(restoreRevision).toHaveBeenCalledTimes(1);
  });

  it('logs candidate revision ids for an unpinned entry', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { service, restoreRevision } = setup(
      { WAFFLEBASE_DEMO_RESET_TARGETS: 'tok-doc' },
      {
        'd-doc': [
          { id: 'auto', label: '' },
          { id: 'g1', label: 'demo-golden' },
        ],
      },
    );
    await service.logCandidates();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`g1 (${AT.toISOString()})`),
    );
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('auto'));
    expect(restoreRevision).not.toHaveBeenCalled();
  });

  it('arms no timer when nothing is configured or pinned', () => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    setup({}).service.onApplicationBootstrap();
    setup({
      WAFFLEBASE_DEMO_RESET_TARGETS: 'tok-doc',
    }).service.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not re-arm when shut down mid-run', async () => {
    jest.useFakeTimers({ now: new Date(Date.UTC(2026, 10, 15, 14)) });
    const { service, restoreRevision } = setup({
      WAFFLEBASE_DEMO_RESET_TARGETS: 'tok-sheet:r',
    });
    let release!: () => void;
    restoreRevision.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(restoreRevision).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    release();
    await jest.advanceTimersByTimeAsync(0);

    expect(jest.getTimerCount()).toBe(0);
  });

  it('runs at the configured hour, then again a day later', async () => {
    jest.useFakeTimers({ now: new Date(Date.UTC(2026, 10, 15, 14)) });
    const { service, restoreRevision } = setup({
      WAFFLEBASE_DEMO_RESET_TARGETS: 'tok-sheet:r',
      WAFFLEBASE_DEMO_RESET_HOUR_UTC: '15',
    });
    service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(59 * 60 * 1000);
    expect(restoreRevision).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(restoreRevision).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(restoreRevision).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });
});
