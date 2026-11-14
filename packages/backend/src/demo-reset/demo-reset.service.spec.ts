import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShareLinkService } from '../share-link/share-link.service';
import { YorkieService } from '../yorkie/yorkie.service';
import { DemoResetService } from './demo-reset.service';

const DOCS: Record<string, { id: string; type: string }> = {
  'tok-sheet': { id: 'd-sheet', type: 'sheet' },
  'tok-doc': { id: 'd-doc', type: 'doc' },
  'tok-slides': { id: 'd-slides', type: 'slides' },
};

function setup(
  values: Record<string, string>,
  revisions: Record<string, Array<{ id: string; label: string }>>,
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
  const withDocument = jest.fn(
    (id: string, cb: (doc: unknown, client: unknown) => unknown) => {
      const client = {
        listRevisions: (_doc: unknown, { offset }: { offset: number }) =>
          Promise.resolve(offset === 0 ? (revisions[id] ?? []) : []),
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
  return { service, restoreRevision, withDocument };
}

describe('DemoResetService', () => {
  afterEach(() => jest.useRealTimers());

  it('restores each document to its newest labelled revision', async () => {
    const { service, restoreRevision, withDocument } = setup(
      { WAFFLEBASE_DEMO_RESET_TOKENS: 'tok-sheet,tok-slides' },
      {
        'd-sheet': [
          { id: 'auto', label: '' },
          { id: 'g2', label: 'demo-golden' },
          { id: 'g1', label: 'demo-golden' },
        ],
        'd-slides': [{ id: 's1', label: 'demo-golden' }],
      },
    );

    await expect(service.resetAll()).resolves.toEqual(['restored', 'restored']);
    expect(restoreRevision.mock.calls).toEqual([
      ['d-sheet', 'g2'],
      ['d-slides', 's1'],
    ]);
    expect(withDocument).toHaveBeenNthCalledWith(
      2,
      'd-slides',
      expect.any(Function),
      { syncMode: 'readonly', docKeyPrefix: 'slides-' },
    );
  });

  it('isolates a missing link and a missing revision', async () => {
    const { service, restoreRevision } = setup(
      { WAFFLEBASE_DEMO_RESET_TOKENS: 'gone,tok-doc,tok-sheet' },
      { 'd-sheet': [{ id: 'g', label: 'demo-golden' }] },
    );

    await expect(service.resetAll()).resolves.toEqual([
      'failed',
      'no-revision',
      'restored',
    ]);
    expect(restoreRevision).toHaveBeenCalledTimes(1);
  });

  it('honors a custom label', async () => {
    const { service, restoreRevision } = setup(
      {
        WAFFLEBASE_DEMO_RESET_TOKENS: 'tok-sheet',
        WAFFLEBASE_DEMO_RESET_LABEL: 'clean',
      },
      {
        'd-sheet': [
          { id: 'g', label: 'demo-golden' },
          { id: 'c', label: 'clean' },
        ],
      },
    );
    await service.resetAll();
    expect(restoreRevision).toHaveBeenCalledWith('d-sheet', 'c');
  });

  it('arms no timer when no token is configured', () => {
    jest.useFakeTimers();
    const { service } = setup({}, {});
    service.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('runs at the configured hour, then again a day later', async () => {
    jest.useFakeTimers({ now: new Date(Date.UTC(2026, 10, 15, 14)) });
    const { service, restoreRevision } = setup(
      {
        WAFFLEBASE_DEMO_RESET_TOKENS: 'tok-sheet',
        WAFFLEBASE_DEMO_RESET_HOUR_UTC: '15',
      },
      { 'd-sheet': [{ id: 'g', label: 'demo-golden' }] },
    );
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
