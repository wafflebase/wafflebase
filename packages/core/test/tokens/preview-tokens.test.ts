import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * `preview-tokens.mts` is the long-lived worker the design-editor bridge keeps
 * warm to render `tokens.css` variables from PATCHED token sources.
 *
 * It is covered here as a real process rather than by unit-testing `handle()`,
 * because the property that makes it correct — that a second request does NOT
 * return values cached from the first — only exists across requests in one
 * living ESM registry. Calling the function directly would never exercise it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '../..');
const WORKER = join(PKG, 'scripts/preview-tokens.mts');
const TSX = join(PKG, 'node_modules/.bin/tsx');

const NAMES = ['palette', 'semantic', 'radius', 'typography'] as const;
type Files = Record<(typeof NAMES)[number], string>;

/** The four token modules' real source text, as the bridge would send them. */
function sources(): Files {
  return Object.fromEntries(
    NAMES.map((n) => [n, readFileSync(join(PKG, `src/tokens/${n}.ts`), 'utf8')]),
  ) as Files;
}

interface Response {
  id?: number;
  ok: boolean;
  error?: string;
  light?: Record<string, string>;
  dark?: Record<string, string>;
}

/** Line-delimited JSON client for one worker process. */
function startWorker() {
  const child: ChildProcessWithoutNullStreams = spawn(TSX, [WORKER], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map<number, (r: Response) => void>();
  let buf = '';

  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
    for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as Response;
      const resolve = pending.get(msg.id!);
      if (resolve) {
        pending.delete(msg.id!);
        resolve(msg);
      }
    }
  });

  let seq = 0;
  return {
    send(files: Partial<Files>): Promise<Response> {
      const id = ++seq;
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`worker timed out on #${id}`)), 30_000);
        pending.set(id, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
        child.stdin.write(`${JSON.stringify({ id, files })}\n`);
      });
    },
    stop: () => child.kill(),
  };
}

const worker = startWorker();
afterAll(() => worker.stop());

/** Swap a hex literal in the palette SOURCE, the way a staged edit would. */
function patchSyrup(files: Files, hex: string): Files {
  const patched = files.palette.replace(/(syrup:\s*')#B8651A(')/, `$1${hex}$2`);
  expect(patched, 'palette source should contain the syrup literal').not.toBe(files.palette);
  return { ...files, palette: patched };
}

describe('preview-tokens worker', () => {
  it(
    'renders the unpatched sources to the same values the emitter produces',
    async () => {
      const res = await worker.send(sources());
      expect(res.ok).toBe(true);
      expect(res.light?.['--wb-syrup']).toBe('#B8651A');
      expect(res.light?.['--primary']).toBe('#B8651A');
      expect(res.dark?.['--background']).toMatch(/^oklch\(0\.141/);
    },
    60_000,
  );

  it(
    're-resolves semantic roles from patched palette SOURCE',
    async () => {
      // The complement to build-css.test.ts's "does NOT re-resolve from a
      // patched palette OBJECT". Object substitution cannot move `--primary`,
      // because `semantic.ts` bound it at module eval. Re-importing the patched
      // source re-runs that binding — which is the entire reason this worker
      // takes text and writes a scratch directory.
      const res = await worker.send(patchSyrup(sources(), '#0000FF'));
      expect(res.ok).toBe(true);
      expect(res.light?.['--wb-syrup']).toBe('#0000FF');
      expect(res.light?.['--primary']).toBe('#0000FF');
      // Untouched tokens stay put.
      expect(res.light?.['--wb-butter']).toBe('#F4C95D');
    },
    60_000,
  );

  it(
    'does not serve stale values from a previous request',
    async () => {
      // THE REGRESSION THIS FILE EXISTS FOR. A fresh scratch directory per
      // request is what busts the ESM cache. Bust `semantic.ts` alone (or reuse
      // the directory) and this request returns the PREVIOUS request's colours
      // while reporting ok — a silent wrong-preview, the worst failure mode for
      // a "what you see is what you save" feature.
      await worker.send(patchSyrup(sources(), '#0000FF'));
      const back = await worker.send(sources());

      expect(back.ok).toBe(true);
      expect(back.light?.['--wb-syrup']).toBe('#B8651A');
      expect(back.light?.['--primary']).toBe('#B8651A');
    },
    60_000,
  );

  it(
    'reports missing files instead of rendering a partial stylesheet',
    async () => {
      const { palette } = sources();
      const res = await worker.send({ palette });

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/semantic/);
      expect(res.error).toMatch(/radius/);
      expect(res.error).toMatch(/typography/);
    },
    60_000,
  );

  it(
    'survives a bad request and keeps serving the next one',
    async () => {
      // The bridge holds ONE worker for the session; a malformed edit must not
      // take the preview down until the dev server restarts.
      const bad = await worker.send({ palette: 'export const palette = (' });
      expect(bad.ok).toBe(false);

      const good = await worker.send(sources());
      expect(good.ok).toBe(true);
      expect(good.light?.['--wb-syrup']).toBe('#B8651A');
    },
    60_000,
  );
});
