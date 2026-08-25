import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  debugReportPlugin,
  isSafeSegment,
  isTrustedRequest,
  prepareCaptures,
  writeBundle,
} from './report-endpoint';
import { parseBundle, parseDraftRequest, DRAFT_SCHEMA } from '../index';

const dir = () => mkdtempSync(path.join(tmpdir(), 'wb-debug-'));

const jpeg = `data:image/jpeg;base64,${Buffer.from('pretend jpeg').toString('base64')}`;

describe('isSafeSegment', () => {
  it('accepts a plain identifier', () => {
    expect(isSafeSegment('cap-1a2b')).toBe(true);
    expect(isSafeSegment('wb-abc123')).toBe(true);
  });

  it('rejects traversal, including the forms a character class alone allows', () => {
    // `/^[A-Za-z0-9._-]+$/` matches ".." — and `path.join(root, ".wb-reports",
    // "..")` IS the repository root, so a bundle could have written its JSON and
    // arbitrary image bytes straight into the checkout.
    expect(isSafeSegment('..')).toBe(false);
    expect(isSafeSegment('.')).toBe(false);
    expect(isSafeSegment('../../etc/passwd')).toBe(false);
    expect(isSafeSegment('a/b')).toBe(false);
    expect(isSafeSegment('')).toBe(false);
    expect(isSafeSegment(undefined)).toBe(false);
  });
});

describe('isTrustedRequest', () => {
  const req = (headers: Record<string, string | undefined>) => ({ headers });

  it('accepts a same-origin JSON request', () => {
    expect(
      isTrustedRequest(
        req({ 'content-type': 'application/json', origin: 'http://localhost:5173', host: 'localhost:5173' }),
      ).ok,
    ).toBe(true);
  });

  it('accepts a request with no Origin, which is a same-origin fetch or a tool', () => {
    expect(isTrustedRequest(req({ 'content-type': 'application/json; charset=utf-8' })).ok).toBe(true);
  });

  it('refuses a cross-origin request', () => {
    // These endpoints write into the repository and spend a model credential,
    // on a port every page the developer visits can reach.
    const answer = isTrustedRequest(
      req({ 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost:5173' }),
    );
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toMatch(/cross-origin/);
  });

  it('refuses a content type a cross-origin page could send without a preflight', () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', undefined]) {
      expect(isTrustedRequest(req({ 'content-type': type })).ok).toBe(false);
    }
  });

  it('refuses an unreadable Origin', () => {
    expect(
      isTrustedRequest(req({ 'content-type': 'application/json', origin: 'not a url', host: 'x' })).ok,
    ).toBe(false);
  });
});

describe('prepareCaptures', () => {
  it('decodes each image under its own filename, and writes nothing', () => {
    const out = dir();
    const { prepared, refused } = prepareCaptures([
      { id: 'cap-1', dataUrl: jpeg },
      { id: 'cap-2', dataUrl: `data:image/png;base64,${Buffer.from('png').toString('base64')}` },
    ]);
    expect(prepared.map((c) => c.name)).toEqual(['cap-1.jpg', 'cap-2.png']);
    expect(prepared[0].bytes.toString()).toBe('pretend jpeg');
    expect(refused).toEqual([]);
    // Decoding and writing are separate so the handover can be all or nothing.
    expect(readdirSync(out)).toEqual([]);
  });

  it('refuses an id that is not a plain filename, and says which', () => {
    const { prepared, refused } = prepareCaptures([
      { id: '../escape', dataUrl: jpeg },
      { id: 'cap-ok', dataUrl: jpeg },
    ]);
    expect(prepared.map((c) => c.name)).toEqual(['cap-ok.jpg']);
    expect(refused).toEqual(['../escape']);
  });

  it('refuses a data URL that is not an image', () => {
    const { prepared, refused } = prepareCaptures([
      { id: 'cap-1', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
      { id: 'cap-2', dataUrl: 'not a data url' },
    ]);
    expect(prepared).toEqual([]);
    expect(refused).toEqual(['cap-1', 'cap-2']);
  });

  it('tolerates a missing or malformed capture list', () => {
    expect(prepareCaptures(undefined)).toEqual({ prepared: [], refused: [] });
    expect(prepareCaptures('nope')).toEqual({ prepared: [], refused: [] });
    expect(prepareCaptures([null]).refused).toEqual(['<unnamed>']);
  });
});

describe('writeBundle', () => {
  it('never overwrites an earlier handover from the same session', () => {
    // `sessionId` IS A PER-PAGE-LOAD SINGLETON. Collect three, send, collect
    // three more, send: the second write used to land on `bundle.json` and
    // destroy the first batch, after the reporter had been told it was sent.
    const d = dir();
    expect(writeBundle(d, { n: 1 })).toBe('bundle.json');
    expect(writeBundle(d, { n: 2 })).toBe('bundle-2.json');
    expect(writeBundle(d, { n: 3 })).toBe('bundle-3.json');
    expect(readdirSync(d).sort()).toEqual(['bundle-2.json', 'bundle-3.json', 'bundle.json']);
    expect(JSON.parse(readFileSync(path.join(d, 'bundle.json'), 'utf8'))).toEqual({ n: 1 });
    expect(JSON.parse(readFileSync(path.join(d, 'bundle-3.json'), 'utf8'))).toEqual({ n: 3 });
  });

  it('steps over a name something else already took', () => {
    const d = dir();
    writeFileSync(path.join(d, 'bundle.json'), 'not ours');
    writeFileSync(path.join(d, 'bundle-2.json'), 'not ours either');
    expect(writeBundle(d, { n: 9 })).toBe('bundle-3.json');
    expect(readFileSync(path.join(d, 'bundle.json'), 'utf8')).toBe('not ours');
  });
});

/**
 * The two request handlers.
 *
 * They were the untested half of this file: the helpers above had tests, the
 * middleware wiring them together did not — including the injected `draft` seam
 * that exists for no other reason. What is faked here is the dev server, not the
 * endpoints; `parseBundle` and `parseDraftRequest` are the real ones, because
 * the point of `loadCore` is that the boundary check is the SAME parser the
 * intake runner will run.
 */
type Handler = (
  req: unknown,
  res: unknown,
  next: () => void,
) => void;

const bundleOf = (over: Record<string, unknown> = {}) => ({
  schema: 1,
  sessionId: 'wb-1',
  createdAt: 1_700_000_000_000,
  env: {
    route: '/s/:id',
    viewport: { w: 1280, h: 800 },
    dpr: 2,
    theme: 'light',
    userAgent: 'vitest',
  },
  items: [
    {
      id: 'i1',
      createdAt: 1_700_000_000_000,
      note: 'the toolbar is cramped',
      target: {
        kind: 'dom',
        tag: 'button',
        selector: 'button.bold',
        rect: { x: 0, y: 0, w: 32, h: 32 },
      },
      disposition: 'verify',
      agentCandidate: false,
    },
  ],
  ...over,
});

/** A dev server whose `ssrLoadModule` hands back the real core. */
function serverFor(repoRoot: string) {
  const handlers = new Map<string, Handler>();
  const info = vi.fn();
  const server = {
    middlewares: {
      use: (route: string, handler: Handler) => void handlers.set(route, handler),
    },
    ssrLoadModule: async () => ({ parseBundle, parseDraftRequest, DRAFT_SCHEMA }),
    config: { logger: { info } },
  };
  return { server, handlers, info, repoRoot };
}

/** Drive one handler and resolve with what it answered. */
function call(
  handler: Handler,
  body: unknown,
  opts: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown>; nexted: boolean }> {
  return new Promise((resolve) => {
    let nexted = false;
    const chunks =
      typeof body === 'string' ? [body] : [JSON.stringify(body)];
    const req = {
      method: opts.method ?? 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:5173', ...opts.headers },
      on(event: string, cb: (arg?: unknown) => void) {
        if (event === 'data') for (const c of chunks) cb(Buffer.from(c));
        if (event === 'end') cb();
        return this;
      },
      resume() {},
    };
    const res = {
      statusCode: 0,
      setHeader() {},
      end(payload?: string) {
        resolve({
          status: this.statusCode,
          body: payload ? (JSON.parse(payload) as Record<string, unknown>) : {},
          nexted,
        });
      },
    };
    handler(req, res, () => {
      nexted = true;
      resolve({ status: 0, body: {}, nexted });
    });
  });
}

function mount(over: Partial<Parameters<typeof debugReportPlugin>[0]> = {}) {
  const repoRoot = dir();
  const ctx = serverFor(repoRoot);
  const plugin = debugReportPlugin({ repoRoot, ...over });
  (plugin.configureServer as (s: unknown) => void).call(plugin, ctx.server);
  return {
    ...ctx,
    report: ctx.handlers.get('/__wb_debug_report')!,
    draftRoute: ctx.handlers.get('/__wb_debug_draft')!,
  };
}

describe('POST /__wb_debug_report', () => {
  it('writes the bundle and the images, and says where', async () => {
    const m = mount();
    const answer = await call(m.report, {
      bundle: bundleOf(),
      captures: [{ id: 'cap-1', dataUrl: jpeg }],
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      ref: path.join('.wb-reports', 'wb-1', 'bundle.json'),
      bundle: 'bundle.json',
      captures: ['cap-1.jpg'],
    });
    const written = readdirSync(path.join(m.repoRoot, '.wb-reports', 'wb-1')).sort();
    expect(written).toEqual(['bundle.json', 'cap-1.jpg']);
  });

  it('gives a second handover its own file', async () => {
    const m = mount();
    await call(m.report, { bundle: bundleOf(), captures: [] });
    const second = await call(m.report, { bundle: bundleOf(), captures: [] });
    expect(second.body).toMatchObject({ bundle: 'bundle-2.json' });
  });

  it('refuses an invalid bundle and writes NOTHING', async () => {
    // Writing an unparseable bundle would mean the reporter is told it was sent,
    // the session is emptied, and intake rejects it — the report destroyed with
    // a success message.
    const m = mount();
    const answer = await call(m.report, { bundle: bundleOf({ items: [] }) });
    expect(answer.status).toBe(400);
    expect(answer.body.error).toMatch(/not valid/);
    expect(() => readdirSync(path.join(m.repoRoot, '.wb-reports'))).toThrow();
  });

  it('refuses a sessionId that is not a plain path segment', async () => {
    const m = mount();
    const answer = await call(m.report, { bundle: bundleOf({ sessionId: '..' }) });
    expect(answer.status).toBe(400);
    expect(answer.body.error).toMatch(/plain identifier/);
  });

  it('refuses the whole handover when one capture is refused', async () => {
    const m = mount();
    const answer = await call(m.report, {
      bundle: bundleOf(),
      captures: [{ id: 'cap-1', dataUrl: jpeg }, { id: '../evil', dataUrl: jpeg }],
    });
    expect(answer.status).toBe(400);
    expect(answer.body.error).toMatch(/refused 1 capture/);
    // ALL OR NOTHING: not even the acceptable image is on disk, because a
    // bundle that lands beside a refused capture would reference a file
    // nobody wrote.
    expect(() => readdirSync(path.join(m.repoRoot, '.wb-reports'))).toThrow();
  });

  it('refuses a cross-origin request before reading the body', async () => {
    const m = mount();
    const answer = await call(m.report, { bundle: bundleOf() }, {
      headers: { origin: 'https://evil.example' },
    });
    expect(answer.status).toBe(403);
  });

  it('passes anything that is not a POST to the next middleware', async () => {
    const m = mount();
    expect((await call(m.report, {}, { method: 'GET' })).nexted).toBe(true);
  });

  it('answers a malformed body rather than throwing', async () => {
    const m = mount();
    const answer = await call(m.report, '{ not json');
    expect(answer.status).toBe(400);
  });
});

describe('POST /__wb_debug_draft', () => {
  it('hands the validated request to the drafting seam and returns its answer', async () => {
    // Typed with both parameters so the assertion below can read the second:
    // `schema` is the whole reason `loadCore` exists.
    const draft = vi.fn(
      async (_bundle: unknown, _opts: { schema: Record<string, unknown> }) => ({
        ok: true as const,
        result: { drafts: [], proposedGroups: [] },
      }),
    );
    const m = mount({ draft });
    const answer = await call(m.draftRoute, { bundle: { items: bundleOf().items, env: bundleOf().env } });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ drafts: [], proposedGroups: [] });
    // The SCHEMA is the core's, not a second copy: `loadCore` exists so the
    // answer is held to the same one the client validates against.
    expect(draft.mock.calls[0][1]).toMatchObject({ schema: DRAFT_SCHEMA });
  });

  it('spends NO credential on a request that does not validate', async () => {
    // This endpoint can be reached by any page the developer visits, and
    // answering it costs tokens. Validation has to come first.
    const draft = vi.fn();
    const m = mount({ draft: draft as never });
    const answer = await call(m.draftRoute, { bundle: { items: 'nope' } });
    expect(answer.status).toBe(400);
    expect(answer.body.error).toMatch(/not valid/);
    expect(draft).not.toHaveBeenCalled();
  });

  it('spends NO credential on more items than one batch could ever send', async () => {
    const draft = vi.fn();
    const base = bundleOf();
    const items = Array.from({ length: 41 }, (_, i) => ({
      ...base.items[0],
      id: `i${i}`,
    }));
    const m = mount({ draft: draft as never });
    const answer = await call(m.draftRoute, { bundle: { items, env: base.env } });
    expect(answer.status).toBe(400);
    expect(String(answer.body.detail)).toMatch(/exceeds the 40/);
    expect(draft).not.toHaveBeenCalled();
  });

  it('answers 503 when drafting is unavailable, which the panel degrades from', async () => {
    const m = mount({
      draft: (async () => ({ ok: false as const, reason: 'not-configured' as const, detail: 'no key' })) as never,
    });
    const answer = await call(m.draftRoute, { bundle: { items: bundleOf().items, env: bundleOf().env } });
    expect(answer.status).toBe(503);
    expect(answer.body).toMatchObject({ error: 'not-configured' });
  });

  it('refuses a content type a cross-origin page could send without a preflight', async () => {
    const m = mount({ draft: vi.fn() as never });
    const answer = await call(m.draftRoute, { bundle: {} }, {
      headers: { 'content-type': 'text/plain' },
    });
    expect(answer.status).toBe(403);
  });
});
