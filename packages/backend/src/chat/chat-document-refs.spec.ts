import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  ChatDocumentRefService,
  extractDocumentLinks,
  frontendOrigin,
  MAX_REFS_PER_MESSAGE,
  parseCursor,
  toRefDtos,
} from './chat-document-refs';

const ID = '0b6f3c2e-8a4d-4f1e-9c7b-2d5e6f708192';
const ID2 = '1c7a4d3f-9b5e-4a2f-8d6c-3e4f5a607182';
const BASE = 'https://app.wafflebase.test';

function at(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('frontendOrigin', () => {
  it('keeps the origin only', () => {
    expect(frontendOrigin('https://x.test/app/')).toBe('https://x.test');
    expect(frontendOrigin('http://localhost:5173')).toBe(
      'http://localhost:5173',
    );
  });

  it('refuses unset and non-http values', () => {
    expect(frontendOrigin(undefined)).toBeUndefined();
    expect(frontendOrigin('ftp://x.test')).toBeUndefined();
    expect(frontendOrigin('not a url')).toBeUndefined();
  });
});

describe('extractDocumentLinks', () => {
  it('reads an absolute URL on this frontend, for every editor route', () => {
    for (const p of ['s', 'd', 'p', 'n', 'b', 'f']) {
      expect(extractDocumentLinks(`see ${BASE}/${p}/${ID}`, BASE)).toEqual([
        { documentId: ID, at: null },
      ]);
    }
  });

  it('reads a root-relative path standing on its own', () => {
    expect(extractDocumentLinks(`/s/${ID}`, BASE)).toEqual([
      { documentId: ID, at: null },
    ]);
    expect(extractDocumentLinks(`(see /d/${ID})`, undefined)).toEqual([
      { documentId: ID, at: null },
    ]);
  });

  it('ignores another origin, and a path glued to other text', () => {
    expect(extractDocumentLinks(`https://evil.test/s/${ID}`, BASE)).toEqual([]);
    expect(extractDocumentLinks(`x/s/${ID}`, BASE)).toEqual([]);
    expect(
      extractDocumentLinks(`https://evil.test/${BASE}/s/${ID}`, BASE),
    ).toEqual([]);
    expect(extractDocumentLinks(`${BASE}.evil.test/s/${ID}`, BASE)).toEqual([]);
  });

  it('ignores an unknown route or a non-uuid id', () => {
    expect(extractDocumentLinks(`${BASE}/x/${ID}`, BASE)).toEqual([]);
    expect(extractDocumentLinks(`${BASE}/s/abc`, BASE)).toEqual([]);
    expect(extractDocumentLinks(`${BASE}/s/${ID}x`, BASE)).toEqual([]);
  });

  it('reads a link under any router basename on this origin', () => {
    // `FRONTEND_URL` is origin-only (CORS compares it to `Origin`), so the
    // basename the frontend writes into its links is not known here.
    const a = at({ slideId: 'x' });
    expect(extractDocumentLinks(`${BASE}/app/p/${ID}?at=${a}`, BASE)).toEqual([
      { documentId: ID, at: a },
    ]);
    expect(extractDocumentLinks(`${BASE}/a/b-c/s/${ID}`, BASE)).toEqual([
      { documentId: ID, at: null },
    ]);
    expect(extractDocumentLinks(`${BASE}:8443/app/s/${ID}`, BASE)).toEqual([]);
    expect(extractDocumentLinks(`${BASE}@evil.test/s/${ID}`, BASE)).toEqual([]);
    expect(extractDocumentLinks(`${BASE}.evil.test/app/s/${ID}`, BASE)).toEqual(
      [],
    );
    expect(extractDocumentLinks(`${BASE}/app/x/${ID}`, BASE)).toEqual([]);
  });

  it('takes ?at=, dropping trailing punctuation, and dedupes by document', () => {
    const a = at({ slideId: 'x' });
    expect(
      extractDocumentLinks(
        `${BASE}/p/${ID}?chat=c1&at=${a}. and ${BASE}/p/${ID} and /s/${ID2}`,
        BASE,
      ),
    ).toEqual([
      { documentId: ID, at: a },
      { documentId: ID2, at: null },
    ]);
  });

  it('lowercases ids and caps the count', () => {
    expect(extractDocumentLinks(`/s/${ID.toUpperCase()}`, BASE)).toEqual([
      { documentId: ID, at: null },
    ]);
    const many = Array.from(
      { length: MAX_REFS_PER_MESSAGE + 5 },
      (_, i) => `/s/${ID.slice(0, -4)}${String(1000 + i)}`,
    ).join(' ');
    expect(extractDocumentLinks(many, BASE)).toHaveLength(MAX_REFS_PER_MESSAGE);
  });
});

describe('toRefDtos', () => {
  it('drops a document that has moved to another workspace', () => {
    const row = (workspaceId: string) => ({
      documentId: ID,
      anchor: null,
      document: { type: 'sheet', title: 'Q4', workspaceId },
    });
    expect(toRefDtos([row('w1'), row('w2')], 'w1')).toEqual([
      { documentId: ID, type: 'sheet', title: 'Q4', anchor: null },
    ]);
    expect(toRefDtos(undefined, 'w1')).toEqual([]);
  });
});

describe('ChatDocumentRefService.sharedIn', () => {
  function service(rows: { channelId: string; sharedAt: Date }[]) {
    const queryRaw = jest.fn().mockResolvedValue(rows);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const config = { get: () => undefined } as unknown as ConfigService;
    return { svc: new ChatDocumentRefService(prisma, config), queryRaw };
  }

  it('scopes the query to the caller, workspace and document', async () => {
    const { svc, queryRaw } = service([]);
    await svc.sharedIn(7, 'ws-1', ID);
    const [strings, ...values] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join('?');
    expect(sql).toContain('cm."userId" = ?');
    expect(sql).toContain('c."archivedAt" IS NULL');
    expect(sql).toContain('m."deletedAt" IS NULL');
    expect(sql).toContain('d."deletedAt" IS NULL');
    expect(sql).toContain('m."channelId" = r."channelId"');
    expect(values).toEqual(expect.arrayContaining([7, 'ws-1', ID]));
  });

  it('answers ISO times in the order the query gives', async () => {
    const { svc } = service([
      { channelId: 'b', sharedAt: new Date('2026-11-25T10:00:00Z') },
      { channelId: 'a', sharedAt: new Date('2026-11-24T10:00:00Z') },
    ]);
    await expect(svc.sharedIn(1, 'ws', ID)).resolves.toEqual([
      { channelId: 'b', sharedAt: '2026-11-25T10:00:00.000Z' },
      { channelId: 'a', sharedAt: '2026-11-24T10:00:00.000Z' },
    ]);
  });
});

describe('ChatDocumentRefService.sync', () => {
  const channel = { id: 'ch-1', workspaceId: 'ws-1' };
  const excerpt = 'quarterly numbers nobody outside the workspace should see';

  function service(transaction: jest.Mock) {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: ID, type: 'doc', title: 'Plan' }]);
    const deleteMany = jest.fn((args: unknown) => ({ op: 'deleteMany', args }));
    const upsert = jest.fn((args: unknown) => ({ op: 'upsert', args }));
    const prisma = {
      document: { findMany },
      chatDocumentRef: { deleteMany, upsert },
      $transaction: transaction,
    } as unknown as PrismaService;
    const config = { get: () => BASE } as unknown as ConfigService;
    return {
      svc: new ChatDocumentRefService(prisma, config),
      findMany,
      deleteMany,
      upsert,
    };
  }

  afterEach(() => jest.restoreAllMocks());

  it('stores the live documents a body names, with their decoded anchors', async () => {
    const transaction = jest.fn().mockResolvedValue([]);
    const { svc, findMany, deleteMany, upsert } = service(transaction);
    const body = `see ${BASE}/d/${ID}?at=${at({ blockId: 'b', excerpt })} and /s/${ID2}`;
    await expect(svc.sync('m-1', channel, body)).resolves.toEqual([
      {
        documentId: ID,
        type: 'doc',
        title: 'Plan',
        anchor: { blockId: 'b', excerpt },
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [ID, ID2] },
          workspaceId: 'ws-1',
          deletedAt: null,
        },
      }),
    );
    // Refs the body no longer names are dropped; the kept one is upserted.
    expect(deleteMany).toHaveBeenCalledWith({
      where: { messageId: 'm-1', documentId: { notIn: [ID] } },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect((transaction.mock.calls[0] as unknown[][])[0]).toHaveLength(2);
  });

  it('keeps a document-level card for an anchor of the wrong shape', async () => {
    const { svc } = service(jest.fn().mockResolvedValue([]));
    const refs = await svc.sync(
      'm-1',
      channel,
      `${BASE}/d/${ID}?at=${at({ slideId: 's' })}`,
    );
    expect(refs).toEqual([
      { documentId: ID, type: 'doc', title: 'Plan', anchor: null },
    ]);
  });

  it('clears every ref when the body names none, without a lookup', async () => {
    const { svc, findMany, deleteMany } = service(
      jest.fn().mockResolvedValue([]),
    );
    await expect(svc.sync('m-1', channel, 'no links')).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    // No `notIn: []`: the filter is left out rather than trusted to match
    // everything.
    expect(deleteMany).toHaveBeenCalledWith({ where: { messageId: 'm-1' } });
  });

  it('clears every ref when no named document is live here', async () => {
    const { svc, findMany, deleteMany } = service(
      jest.fn().mockResolvedValue([]),
    );
    findMany.mockResolvedValue([]);
    await expect(svc.sync('m-1', channel, `/s/${ID2}`)).resolves.toEqual([]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { messageId: 'm-1' } });
  });

  it('clears the stored refs after a failure, so they match the answer', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc, deleteMany } = service(
      jest.fn().mockRejectedValue(new Error('boom')),
    );
    await expect(svc.sync('m-1', channel, `/d/${ID}`)).resolves.toEqual([]);
    // Once inside the failed transaction, once more on its own.
    expect(deleteMany).toHaveBeenLastCalledWith({
      where: { messageId: 'm-1' },
    });
  });

  it('swallows a failure and logs no document content', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    // A Prisma validation error renders the arguments it was handed.
    const err = Object.assign(
      new Error(`Invalid upsert({ anchor: { excerpt: "${excerpt}" } })`),
      { name: 'PrismaClientValidationError' },
    );
    const { svc } = service(jest.fn().mockRejectedValue(err));
    await expect(
      svc.sync(
        'm-1',
        channel,
        `${BASE}/d/${ID}?at=${at({ blockId: 'b', excerpt })}`,
      ),
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('m-1');
    expect(line).toContain('PrismaClientValidationError');
    expect(line).not.toContain(excerpt);
  });

  it("logs a known request error's code", async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const err = Object.assign(new Error('details'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2003',
    });
    const { svc } = service(jest.fn().mockRejectedValue(err));
    await svc.sync('m-2', channel, `/d/${ID}`);
    expect(String(warn.mock.calls[0][0])).toBe(
      'chat refs sync failed for m-2: PrismaClientKnownRequestError P2003',
    );
  });
});

describe('parseCursor', () => {
  it('reads a cursor the server issued', () => {
    expect(parseCursor(`2026-11-25T10:00:00.000Z_${ID}`)).toEqual({
      at: new Date('2026-11-25T10:00:00.000Z'),
      documentId: ID,
    });
  });

  it('refuses a malformed one', () => {
    expect(parseCursor(undefined)).toBeUndefined();
    expect(parseCursor('')).toBeUndefined();
    expect(parseCursor(ID)).toBeUndefined(); // no separator
    expect(parseCursor(`_${ID}`)).toBeUndefined(); // no time
    expect(parseCursor(`yesterday_${ID}`)).toBeUndefined();
    expect(parseCursor('2026-11-25T10:00:00.000Z_')).toBeUndefined();
    expect(parseCursor('2026-11-25T10:00:00.000Z_not-a-uuid')).toBeUndefined();
    expect(
      parseCursor(`2026-11-25T10:00:00.000Z_${'a'.repeat(200)}`),
    ).toBeUndefined();
    // JS-valid but outside Postgres's timestamp range, or not the shape the
    // server issues.
    expect(parseCursor(`-271821-04-20_${ID}`)).toBeUndefined();
    expect(parseCursor(`+275760-09-13T00:00:00.000Z_${ID}`)).toBeUndefined();
    expect(parseCursor(`1700000000000_${ID}`)).toBeUndefined();
  });
});

describe('ChatDocumentRefService.files', () => {
  function service() {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const userFindMany = jest.fn();
    const prisma = {
      $queryRaw: queryRaw,
      user: { findMany: userFindMany },
    } as unknown as PrismaService;
    const config = { get: () => undefined } as unknown as ConfigService;
    return {
      svc: new ChatDocumentRefService(prisma, config),
      queryRaw,
      userFindMany,
    };
  }

  /** The `LIMIT` the query was sent: the page size plus one lookahead row. */
  function sentLimit(queryRaw: jest.Mock): unknown {
    const values = (queryRaw.mock.calls[0] as unknown[]).slice(1);
    return values[values.length - 1];
  }

  it.each([
    [undefined, 51],
    [0, 2],
    [-5, 2],
    [1, 2],
    [100, 101],
    [1000, 101],
  ])('clamps limit %p into [1, 100]', async (limit, sent) => {
    const { svc, queryRaw, userFindMany } = service();
    await expect(
      svc.files({ id: 'ch', workspaceId: 'ws' }, { limit }),
    ).resolves.toEqual({ files: [], cursor: null });
    expect(sentLimit(queryRaw)).toBe(sent);
    expect(userFindMany).not.toHaveBeenCalled();
  });

  /** The fragment sent in the cursor's slot, between workspace and limit. */
  function sentCursor(queryRaw: jest.Mock): unknown {
    const values = (queryRaw.mock.calls[0] as unknown[]).slice(1);
    return values[values.length - 2];
  }

  it.each([
    'garbage',
    `-271821-04-20_${ID}`,
    `+275760-09-13T00:00:00.000Z_${ID}`,
    `2026-11-25_${ID}`,
  ])('pages from the start on a malformed cursor %p', async (before) => {
    const { svc, queryRaw } = service();
    await svc.files({ id: 'ch', workspaceId: 'ws' }, { before });
    expect(sentCursor(queryRaw)).toBe(Prisma.empty);
  });

  it('pages after a well-formed cursor', async () => {
    const { svc, queryRaw } = service();
    await svc.files(
      { id: 'ch', workspaceId: 'ws' },
      { before: `2026-11-25T10:00:00.000Z_${ID}` },
    );
    const sql = sentCursor(queryRaw) as Prisma.Sql;
    expect(sql).not.toBe(Prisma.empty);
    expect(sql.sql).toContain('x."createdAt", x."documentId") <');
    expect(sql.values).toEqual([new Date('2026-11-25T10:00:00.000Z'), ID]);
  });

  it("authorizes on the message's channel as well as the ref's", async () => {
    const { svc, queryRaw } = service();
    await svc.files({ id: 'ch', workspaceId: 'ws' }, {});
    const [strings] = queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(strings.join('?')).toContain('m."channelId" = r."channelId"');
  });
});
