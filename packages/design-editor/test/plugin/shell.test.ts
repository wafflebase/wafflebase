import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shellServer } from '../../src/plugin/shell.ts';
import { BASE } from '../../src/base.ts';

/**
 * The scene document's script src cannot be baked into the prebuilt shell.
 *
 * Measured against a live Vite 6.4.3 + @vitejs/plugin-react 4.3.4: a virtual module
 * is not transformed even with a `.tsx` id — the JSX reaches `vite:import-analysis`
 * verbatim and the frame 500s on its own entry — so the entry has to be a real file,
 * and its path depends on the consumer's package manager. `shellServer` therefore
 * substitutes it at request time, and this is the only shell asset that is read and
 * rewritten rather than streamed.
 *
 * Driven through the middleware rather than by calling a helper, because the
 * substitution and the 500 that guards it are both branches of the request path.
 */

let dist: string;
type Handler = (req: { url?: string }, res: FakeRes, next: () => void) => void;
let handler: Handler;

/**
 * A real writable stream, because the asset path is `createReadStream(...).pipe(res)`
 * and a plain object fails on `dest.once`. Extending `PassThrough` rather than
 * stubbing `pipe` keeps the two response paths — piped assets and the scene
 * document's `end()` — going through the same fake.
 */
class FakeRes extends PassThrough {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];

  constructor() {
    super();
    this.on('data', (c: Buffer) => this.chunks.push(Buffer.from(c)));
  }

  setHeader(k: string, v: string) {
    this.headers[k.toLowerCase()] = v;
  }

  get body(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/** Drive one request through the middleware; resolves once the response has ended. */
async function get(url: string): Promise<{ res: FakeRes; nexted: boolean }> {
  const r = new FakeRes();
  let nexted = false;
  const done = new Promise<void>((resolve) => r.on('end', () => resolve()));
  handler({ url }, r, () => {
    nexted = true;
    r.end();
  });
  await done;
  return { res: r, nexted };
}

beforeAll(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-shell-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<div id="wb-root"></div>');
  fs.writeFileSync(
    path.join(dist, 'scene.html'),
    '<!-- __WB_SCENE_ENTRY__ --><script src="__WB_SCENE_ENTRY__"></script>',
  );

  const plugin = shellServer({ distDir: dist, sceneEntryUrl: '/@fs/pkg/src/scenes/scene-entry.tsx' });
  // `configureServer` is the only hook this plugin has; capture what it mounts.
  const middlewares = {
    use(mount: string, fn: Handler) {
      expect(mount).toBe(BASE);
      handler = fn;
    },
  };
  const cfg = { logger: { error() {} } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a two-field stand-in
  // for ViteDevServer; typing it fully would assert nothing this test reads.
  (plugin.configureServer as any).call(null, { middlewares, config: cfg });
});

afterAll(() => fs.rmSync(dist, { recursive: true, force: true }));

describe('the scene document', () => {
  it('substitutes every occurrence of the entry placeholder', async () => {
    const { res: r } = await get('/scene');
    expect(r.statusCode).toBe(200);
    // Every one, not just the first: the shipped document mentions the token in a
    // comment as well as the script, and a `replace` without a global would leave
    // one behind for a reader to trust.
    expect(r.body).not.toContain('__WB_SCENE_ENTRY__');
    expect([...r.body.matchAll(/scene-entry\.tsx/g)]).toHaveLength(2);
  });

  it('serves it as HTML, uncached', async () => {
    const { res: r } = await get('/scene');
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    // A stale shell is indistinguishable from a broken one.
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('refuses a document whose placeholder is gone, rather than serving it', async () => {
    // A shipped `scene.html` without the token would load `__WB_SCENE_ENTRY__` as a
    // relative URL, 404 inside the frame, and read as a scene that renders nothing.
    fs.writeFileSync(path.join(dist, 'scene.html'), '<script src="./main.js"></script>');
    const { res: r } = await get('/scene');
    expect(r.statusCode).toBe(500);
    expect(r.body).toContain('__WB_SCENE_ENTRY__ missing');
    fs.writeFileSync(
      path.join(dist, 'scene.html'),
      '<!-- __WB_SCENE_ENTRY__ --><script src="__WB_SCENE_ENTRY__"></script>',
    );
  });
});

describe('the rest of the shell', () => {
  it('serves the chrome document at the mount point', async () => {
    for (const url of ['/', '']) {
      const { res: r } = await get(url);
      expect(r.statusCode, url).toBe(200);
    }
  });

  it('leaves the bridge’s own routes alone', async () => {
    // The bridge registers its middleware under the same base; anything it owns must
    // fall through rather than be served as a missing asset.
    const { nexted } = await get('/api/health');
    expect(nexted).toBe(true);
  });

  it('reports a missing asset as a build problem', async () => {
    const { res: r } = await get('/assets/nope.js');
    expect(r.statusCode).toBe(404);
    expect(r.body).toContain('was the package built?');
  });

  it('refuses a path that climbs out of dist', async () => {
    const { res: r } = await get('/../../../etc/passwd');
    expect(r.statusCode).toBe(403);
  });
});
