import * as http from 'http';
import type { AddressInfo } from 'net';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImageService } from '../image/image.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { MiroController } from './miro.controller';
import { MiroService } from './miro.service';
import type { MiroImportEvent } from './miro.types';
import type { AuthenticatedRequest } from '../auth/auth.types';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** An `express.Response` double exposing only what the controller touches. */
function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  let ended = false;
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    flushHeaders: jest.fn(),
    socket: { setNoDelay: jest.fn() },
    write: jest.fn((chunk: string) => {
      if (ended) throw new Error('write after end');
      chunks.push(chunk);
      return true;
    }),
    end: jest.fn(() => {
      ended = true;
    }),
  };
  return {
    res: res as unknown as Response,
    chunks,
    headers,
    get body() {
      return chunks.join('');
    },
    events(): MiroImportEvent[] {
      return chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as MiroImportEvent);
    },
  };
}

function makeController(imageUpload = jest.fn()) {
  const imageService = { upload: imageUpload };
  const miroService = new MiroService(imageService as unknown as ImageService);
  const workspaceService = {
    resolveId: jest.fn().mockResolvedValue('ws-1'),
    assertMember: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new MiroController(
    miroService,
    workspaceService as unknown as WorkspaceService,
  );
  return { controller, miroService, imageService, workspaceService };
}

const req = { user: { id: 1 } } as unknown as AuthenticatedRequest;

describe('MiroController streaming', () => {
  afterEach(() => jest.restoreAllMocks());

  /** A board with two item pages, one connector page and two images. */
  function routeBoard(opts: { imageCount?: number } = {}) {
    const imageCount = opts.imageCount ?? 2;
    return jest.fn().mockImplementation((url: unknown) => {
      const target = String(url);
      if (target.includes('/items')) {
        if (!target.includes('cursor=')) {
          return Promise.resolve(
            jsonResponse({
              data: [{ id: 's1', type: 'shape' }],
              cursor: 'PAGE2',
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            data: Array.from({ length: imageCount }, (_, i) => ({
              id: `img${i}`,
              type: 'image',
              data: {
                imageUrl: `https://api.miro.com/v2/boards/B/resources/r${i}`,
              },
            })),
          }),
        );
      }
      if (target.includes('/connectors')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'c1' }] }));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h === 'content-type' ? 'image/png' : null),
        },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response);
    });
  }

  it('streams a progress line for every stage and exactly one result', async () => {
    global.fetch = routeBoard() as unknown as typeof fetch;
    const { controller } = makeController(
      jest.fn().mockResolvedValue({ id: 'up-1', url: '/images/x' }),
    );
    const sink = makeRes();

    await controller.importBoard(
      'ws-1',
      req,
      { token: 'SECRET-TOKEN', boardUrl: 'B=' },
      sink.res,
    );

    const events = sink.events();
    const stages = events
      .filter((e) => e.type === 'progress')
      .map((e) => (e as { stage: string }).stage);
    expect(new Set(stages)).toEqual(new Set(['items', 'connectors', 'images']));

    // Exactly one terminal line, and it is last.
    const results = events.filter((e) => e.type === 'result');
    expect(results).toHaveLength(1);
    expect(events[events.length - 1].type).toBe('result');
    expect(events.some((e) => e.type === 'error')).toBe(false);

    // The result carries the same shape the non-streaming call returned.
    const result = results[0] as unknown as {
      items: { id: string }[];
      connectors: { id: string }[];
      notes: unknown[];
    };
    expect(result.items.map((i) => i.id)).toEqual(['s1', 'img0', 'img1']);
    expect(result.connectors.map((c) => c.id)).toEqual(['c1']);
    expect(result.notes).toEqual([]);

    // Progress is monotonic within a stage — a UI can render `done` directly.
    for (const stage of ['items', 'connectors', 'images'] as const) {
      const counts = events
        .filter(
          (e): e is Extract<MiroImportEvent, { type: 'progress' }> =>
            e.type === 'progress' && e.stage === stage,
        )
        .map((e) => e.done);
      expect(counts.length).toBeGreaterThan(0);
      expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    }
    // The images stage knows its size up front, so it reports a total.
    const lastImage = events
      .filter(
        (e): e is Extract<MiroImportEvent, { type: 'progress' }> =>
          e.type === 'progress' && e.stage === 'images',
      )
      .pop()!;
    expect(lastImage).toMatchObject({ done: 2, total: 2 });
  });

  it('announces the images stage even for a board with no images', async () => {
    global.fetch = routeBoard({ imageCount: 0 }) as unknown as typeof fetch;
    const { controller } = makeController();
    const sink = makeRes();

    await controller.importBoard(
      'ws-1',
      req,
      { token: 'tok', boardUrl: 'B=' },
      sink.res,
    );

    expect(sink.events()).toContainEqual({
      type: 'progress',
      stage: 'images',
      done: 0,
      total: 0,
    });
  });

  it('sends NDJSON headers that defeat proxy buffering', async () => {
    global.fetch = routeBoard({ imageCount: 0 }) as unknown as typeof fetch;
    const { controller } = makeController();
    const sink = makeRes();

    await controller.importBoard(
      'ws-1',
      req,
      { token: 'tok', boardUrl: 'B=' },
      sink.res,
    );

    expect(sink.headers['Content-Type']).toMatch(/application\/x-ndjson/);
    expect(sink.headers['Cache-Control']).toContain('no-transform');
    expect(sink.headers['X-Accel-Buffering']).toBe('no');
    expect(
      (sink.res as unknown as { flushHeaders: jest.Mock }).flushHeaders,
    ).toHaveBeenCalled();
    // Every line is written on its own — never accumulated and flushed at the
    // end, which would make the stream indistinguishable from a plain 200.
    expect(sink.chunks.length).toBeGreaterThan(1);
    for (const chunk of sink.chunks) expect(chunk.endsWith('\n')).toBe(true);
  });

  describe('the pre-stream / in-stream error boundary', () => {
    it('fails with a real HTTP status when the FIRST Miro call is rejected', async () => {
      // A rejected token surfaces on the first authenticated call, which runs
      // BEFORE any byte is written — so it must still be a 401, not a 200
      // carrying an error line.
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: 'nope' }, 401),
        ) as unknown as typeof fetch;
      const { controller } = makeController();
      const sink = makeRes();

      const err = await controller
        .importBoard('ws-1', req, { token: 'bad', boardUrl: 'B=' }, sink.res)
        .catch((e: unknown) => e);

      expect((err as { getStatus?: () => number }).getStatus?.()).toBe(401);
      expect((err as Error).message).toMatch(/token/i);
      // Nothing was written, so Nest's exception filter can still set a status.
      expect(sink.chunks).toEqual([]);
      expect(
        (sink.res as unknown as { end: jest.Mock }).end,
      ).not.toHaveBeenCalled();
    });

    it('rejects an unparseable board URL with a 400 before streaming', async () => {
      global.fetch = jest.fn() as unknown as typeof fetch;
      const { controller } = makeController();
      const sink = makeRes();

      const err = await controller
        .importBoard(
          'ws-1',
          req,
          { token: 'tok', boardUrl: 'https://evil.com/miro.com/app/board/X' },
          sink.res,
        )
        .catch((e: unknown) => e);

      expect((err as { getStatus?: () => number }).getStatus?.()).toBe(400);
      expect(sink.chunks).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports a failure AFTER streaming began as an in-band error line', async () => {
      // The second items page fails. The status is already committed to 200,
      // so the only honest channel left is the stream itself.
      const fetchMock = jest.fn().mockImplementation((url: unknown) => {
        const target = String(url);
        if (target.includes('cursor=')) {
          return Promise.resolve(jsonResponse({ message: 'gone' }, 404));
        }
        return Promise.resolve(
          jsonResponse({ data: [{ id: 's1', type: 'shape' }], cursor: 'P2' }),
        );
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const { controller } = makeController();
      const sink = makeRes();

      // Resolves — the handler does NOT throw once it owns the response.
      await controller.importBoard(
        'ws-1',
        req,
        { token: 'tok', boardUrl: 'B=' },
        sink.res,
      );

      const events = sink.events();
      expect(events.some((e) => e.type === 'progress')).toBe(true);
      expect(events[events.length - 1]).toEqual({
        type: 'error',
        message: expect.stringMatching(/not found|no access/i) as unknown,
      });
      expect(events.some((e) => e.type === 'result')).toBe(false);
      expect(
        (sink.res as unknown as { end: jest.Mock }).end,
      ).toHaveBeenCalled();
    });

    it('never lets the token escape through an in-band error message', async () => {
      // The service's own exceptions are written to be token-free, so the
      // dangerous case is an error raised BELOW it (a driver, an SDK) whose
      // message this module does not control. Simulated here at the seam.
      global.fetch = routeBoard() as unknown as typeof fetch;
      const { controller, miroService } = makeController();
      jest
        .spyOn(miroService, 'runImport')
        .mockRejectedValue(new Error('connect ECONNREFUSED SECRET-TOKEN'));
      const sink = makeRes();

      await controller.importBoard(
        'ws-1',
        req,
        { token: 'SECRET-TOKEN', boardUrl: 'B=' },
        sink.res,
      );

      const last = sink.events().pop();
      expect(last).toEqual({
        type: 'error',
        message: 'The Miro import failed',
      });
      // Dropped wholesale, not masked: a partially-redacted credential still
      // leaks its length and shape.
      expect(sink.body).not.toContain('SECRET-TOKEN');
    });

    it('does not censor its own messages just because they share a substring with the token', async () => {
      // The rejected design was `message.includes(token) -> generic`. With the
      // (perfectly legal) token "tok" it would have blanked this module's own
      // 404 text, because the word "token" contains it. The allowlist has no
      // such failure mode.
      const fetchMock = jest.fn().mockImplementation((url: unknown) => {
        if (String(url).includes('cursor=')) {
          return Promise.resolve(jsonResponse({ message: 'gone' }, 404));
        }
        return Promise.resolve(
          jsonResponse({ data: [{ id: 's1', type: 'shape' }], cursor: 'P2' }),
        );
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const { controller } = makeController();
      const sink = makeRes();

      await controller.importBoard(
        'ws-1',
        req,
        { token: 'tok', boardUrl: 'B=' },
        sink.res,
      );

      expect(sink.events().pop()).toEqual({
        type: 'error',
        message: 'Miro board not found, or the token has no access to it',
      });
    });
  });

  it('never writes the token into any streamed byte', async () => {
    global.fetch = routeBoard() as unknown as typeof fetch;
    const { controller } = makeController(
      jest.fn().mockResolvedValue({ id: 'up-1', url: '/images/x' }),
    );
    const sink = makeRes();

    await controller.importBoard(
      'ws-1',
      req,
      { token: 'SECRET-TOKEN', boardUrl: 'B=' },
      sink.res,
    );

    // The whole wire payload, not just the parsed result — progress lines and
    // the terminal line included.
    expect(sink.body).not.toContain('SECRET-TOKEN');
    expect(sink.body.length).toBeGreaterThan(0);
  });
});

/**
 * The one test that goes over a real socket.
 *
 * Every assertion above sees `res.write` calls, which proves the controller
 * PRODUCES lines incrementally but not that they ARRIVE incrementally — a
 * buffering layer (Express compression, Nest's serializer, Nagle) would be
 * invisible to it. This one boots a real Nest HTTP server, makes a real
 * request, and timestamps each chunk as the kernel hands it over.
 */
describe('MiroController over a real socket', () => {
  let app: INestApplication;
  let port: number;

  const IMAGE_DELAY_MS = 150;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MiroController],
      providers: [
        MiroService,
        {
          provide: ImageService,
          useValue: {
            upload: jest
              .fn()
              .mockResolvedValue({ id: 'up-1', url: '/images/x' }),
          },
        },
        {
          provide: WorkspaceService,
          useValue: {
            resolveId: jest.fn().mockResolvedValue('ws-1'),
            assertMember: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => { user?: unknown } };
        }) => {
          ctx.switchToHttp().getRequest().user = { id: 1 };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => jest.restoreAllMocks());

  /** POST the import and record when each raw chunk lands. */
  function streamImport(body: unknown): Promise<{
    status: number;
    chunks: { at: number; text: string }[];
    contentType?: string;
  }> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/workspaces/ws-1/miro/import',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: { at: number; text: string }[] = [];
          res.setEncoding('utf8');
          res.on('data', (text: string) =>
            chunks.push({ at: Date.now(), text }),
          );
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              chunks,
              contentType: res.headers['content-type'],
            }),
          );
        },
      );
      request.on('error', reject);
      request.end(payload);
    });
  }

  it('delivers progress lines while the import is still running', async () => {
    // Four images, each taking IMAGE_DELAY_MS. With a pool of 6 they run in
    // one wave, so the images stage alone spans ~150ms — long enough that a
    // buffered response would deliver everything in a single late chunk.
    global.fetch = jest.fn().mockImplementation((url: unknown) => {
      const target = String(url);
      if (target.includes('/items')) {
        return Promise.resolve(
          jsonResponse({
            data: Array.from({ length: 4 }, (_, i) => ({
              id: `img${i}`,
              type: 'image',
              data: {
                imageUrl: `https://api.miro.com/v2/boards/B/resources/r${i}`,
              },
            })),
          }),
        );
      }
      if (target.includes('/connectors')) {
        return Promise.resolve(jsonResponse({ data: [] }));
      }
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: true,
              status: 200,
              headers: {
                get: (h: string) => (h === 'content-type' ? 'image/png' : null),
              },
              arrayBuffer: async () => new Uint8Array([1]).buffer,
            } as unknown as Response),
          IMAGE_DELAY_MS,
        ),
      );
    }) as unknown as typeof fetch;

    const { status, chunks, contentType } = await streamImport({
      token: 'SECRET-TOKEN',
      boardUrl: 'B=',
    });

    expect(status).toBe(200);
    expect(contentType).toMatch(/application\/x-ndjson/);

    // THE POINT: bytes landed before the response finished. The first chunk
    // must precede the last by roughly the image phase's duration; a fully
    // buffered response collapses that gap to ~0.
    expect(chunks.length).toBeGreaterThan(1);
    if (process.env.MIRO_STREAM_TRACE) {
      const t0 = chunks[0].at;
      for (const c of chunks) {
        // eslint-disable-next-line no-console
        console.log(`+${c.at - t0}ms  ${JSON.stringify(c.text)}`);
      }
    }
    const span = chunks[chunks.length - 1].at - chunks[0].at;
    expect(span).toBeGreaterThanOrEqual(IMAGE_DELAY_MS * 0.5);

    const body = chunks.map((c) => c.text).join('');
    expect(body).not.toContain('SECRET-TOKEN');
    const events = body
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MiroImportEvent);
    expect(events[events.length - 1].type).toBe('result');
    // The first chunk must be a PROGRESS line — proof it left the server long
    // before the result existed.
    const first = JSON.parse(chunks[0].text.split('\n')[0]) as MiroImportEvent;
    expect(first.type).toBe('progress');
  }, 15_000);

  it('still answers a rejected token with a 401 JSON body, not a stream', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: 'nope' }, 401),
      ) as unknown as typeof fetch;

    const { status, chunks, contentType } = await streamImport({
      token: 'bad',
      boardUrl: 'B=',
    });

    expect(status).toBe(401);
    expect(contentType).toMatch(/application\/json/);
    const body = JSON.parse(chunks.map((c) => c.text).join('')) as {
      message: string;
    };
    expect(body.message).toMatch(/token/i);
  });
});
