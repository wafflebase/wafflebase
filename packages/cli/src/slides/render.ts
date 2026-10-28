import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CliConfig } from '../config/config.js';

/**
 * `wafflebase slides render` — per-slide, full-resolution PNGs produced by
 * the product's own renderer.
 *
 * Every renderer lives in the browser, so this drives a real headless
 * Chromium to the deck's editor route (`/p/:id`) — the same approach as the
 * backend's `register:templates` — and asks the mounted editor, through the
 * `window.__wafflebaseSlideRender` hook (frontend
 * `app/slides/slide-render-hook.ts`), for each slide. The hook paints with
 * `renderThumbnail` at the deck's logical size (1920 px wide), so the PNG is
 * the editor's own pixels, not a downscaled thumbnail and not a substitute
 * renderer such as soffice.
 *
 * Playwright is optional: it is imported lazily so every other command works
 * without it, and its absence is an actionable error.
 */

export const PLAYWRIGHT_INSTALL_HINT =
  'slides render drives a real browser and needs Playwright + Chromium:\n' +
  '  npm install playwright   (or: pnpm add -D playwright)\n' +
  '  npx playwright install chromium';

export class PlaywrightUnavailableError extends Error {
  constructor(detail?: string) {
    super(
      PLAYWRIGHT_INSTALL_HINT + (detail ? `\n(${detail})` : ''),
    );
    this.name = 'PlaywrightUnavailableError';
  }
}

// Minimal structural types so the CLI needs no compile-time playwright dep.
interface PwPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForFunction(fn: string, arg?: unknown, opts?: { timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: string): Promise<T>;
}
interface PwContext {
  addCookies(c: Array<Record<string, unknown>>): Promise<void>;
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(opts?: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}
export interface PlaywrightLike {
  chromium: { launch(opts?: Record<string, unknown>): Promise<PwBrowser> };
}

/**
 * Lazily import playwright; throws {@link PlaywrightUnavailableError}.
 *
 * Tried from the CLI's own location first, then from `cwd`: with a global
 * CLI (`npm install -g`) the install hint puts Playwright in the user's
 * project, which the CLI's own resolution cannot see.
 */
export async function loadPlaywright(
  importer: (name: string) => Promise<unknown> = (n) => import(n),
  fallback: (name: string) => Promise<unknown> = importFrom(process.cwd()),
): Promise<PlaywrightLike> {
  let mod: unknown;
  try {
    mod = await importer('playwright');
  } catch (e) {
    try {
      mod = await fallback('playwright');
    } catch {
      throw new PlaywrightUnavailableError(
        e instanceof Error ? e.message.split('\n')[0] : undefined,
      );
    }
  }
  const pw = mod as Partial<PlaywrightLike> | undefined;
  if (!pw?.chromium) throw new PlaywrightUnavailableError('no chromium export');
  return pw as PlaywrightLike;
}

/** An importer that resolves a package as if required from `dir`. */
export function importFrom(dir: string): (name: string) => Promise<unknown> {
  return async (name) => {
    const path = createRequire(join(dir, 'package.json')).resolve(name);
    const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    // Resolved through the `require` condition, a CommonJS package whose
    // exports the ESM loader cannot see statically arrives as `default` only.
    return 'chromium' in mod || !mod.default ? mod : mod.default;
  };
}

/** Whether `--slide` was valid: a positive 1-based integer. */
export function parseSlideNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`--slide must be a positive integer (1-based), got "${raw}"`);
  }
  return Number(raw);
}

/** `slide-1.png`, `slide-2.png`, … (1-based, matching `--slide`). */
export function slideFileName(slideNumber: number): string {
  return `slide-${slideNumber}.png`;
}

/** 1-based slide numbers to render. Throws if `only` is out of range. */
export function slidesToRender(count: number, only?: number): number[] {
  if (count <= 0) throw new Error('The deck has no slides to render.');
  if (only !== undefined) {
    if (only > count) {
      throw new Error(`--slide ${only} is out of range: the deck has ${count} slide(s).`);
    }
    return [only];
  }
  return Array.from({ length: count }, (_, i) => i + 1);
}

/**
 * Where the editor lives. Explicit `--frontend` / env wins; otherwise a
 * loopback API implies the Vite dev server and an `api.` host implies its
 * parent domain. Anything else needs to be said.
 */
export function resolveFrontendUrl(
  explicit: string | undefined,
  server: string,
): string {
  const chosen = explicit ?? process.env.WAFFLEBASE_FRONTEND_URL;
  let url: URL;
  if (chosen) {
    try {
      url = new URL(chosen);
    } catch {
      throw new Error(`--frontend is not a URL: ${chosen}`);
    }
  } else {
    const api = new URL(server);
    if (isLoopback(api.hostname)) {
      url = new URL('http://localhost:5173');
    } else if (api.hostname.startsWith('api.')) {
      url = new URL(`${api.protocol}//${api.hostname.slice(4)}`);
    } else {
      throw new Error(
        `Cannot infer the web app URL from server ${server}. Pass --frontend <url> or set WAFFLEBASE_FRONTEND_URL.`,
      );
    }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`--frontend must be http(s): ${url.href}`);
  }
  assertTokenSafeOrigin(url);
  return url.origin;
}

/**
 * The session token is installed as a cookie on every origin the editor
 * talks to — never over cleartext to a non-loopback host. Applied to the API
 * origin as well as the web app: `--server` is user input too.
 */
function assertTokenSafeOrigin(url: URL): void {
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new Error(
      `Refusing to send a session token to ${url.origin}: it is neither https nor loopback.`,
    );
  }
}

/** The backend's session cookie: `__Host-`-prefixed when it mints Secure cookies. */
const SESSION_COOKIE = 'wafflebase_session';

/**
 * Cookies that sign the headless browser in on the web app and the API.
 *
 * Which name the backend reads is a server setting (`COOKIE_SECURE`, else the
 * OAuth callback scheme, else `NODE_ENV`; `sessionCookieName()` in the
 * backend) that the URL does not reveal — an https deployment can run with
 * `COOKIE_SECURE=false` and read the unprefixed name. So an https origin gets
 * both names; the backend reads its own and ignores the other. Plain http
 * (loopback only) can carry only the unprefixed one: browsers refuse a
 * `__Host-` cookie without `Secure`.
 */
export function sessionCookies(
  origins: readonly string[],
  token: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const origin of new Set(origins)) {
    const url = new URL(origin);
    assertTokenSafeOrigin(url);
    const secure = url.protocol === 'https:';
    const base = { value: token, url: url.origin, httpOnly: true, sameSite: 'Lax' };
    if (secure) {
      out.push({ ...base, name: `__Host-${SESSION_COOKIE}`, secure: true });
      out.push({ ...base, name: SESSION_COOKIE, secure: true });
    } else {
      out.push({ ...base, name: SESSION_COOKIE });
    }
  }
  return out;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/** Decode a `data:image/png;base64,...` URL to bytes. */
export function decodePngDataUrl(dataUrl: string): Uint8Array {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Renderer did not return a PNG data URL.');
  return Uint8Array.from(Buffer.from(m[1], 'base64'));
}

export interface RenderSlidesOptions {
  docId: string;
  outDir: string;
  slide?: number;
  frontend?: string;
  force?: boolean;
  config: CliConfig;
  quiet?: boolean;
  /** Test seam. */
  playwright?: PlaywrightLike;
  log?: (line: string) => void;
}

/** Render and write the PNGs; returns the written absolute paths. */
export async function renderSlides(opts: RenderSlidesOptions): Promise<string[]> {
  const { config } = opts;
  if (config.authMode !== 'jwt' || !config.accessToken) {
    throw new Error(
      'slides render opens the deck in a browser and needs a login session. ' +
        'Run `wafflebase login` (API keys cannot sign a browser in).',
    );
  }
  // `-` means stdout everywhere else in this CLI (and to the plugin guard,
  // which therefore does not ask about it); render writes a directory of PNGs.
  if (opts.outDir.trim() === '-') {
    throw new Error('--out must be a directory: slides render writes slide-N.png files, not stdout.');
  }
  const frontend = resolveFrontendUrl(opts.frontend, config.server);
  const log = opts.log ?? ((l: string) => console.error(l));
  const pw = opts.playwright ?? (await loadPlaywright());
  const outDir = resolve(opts.outDir);

  const browser = await pw.chromium.launch();
  const written: string[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    // Host-only on the web app and on the API origin, since the editor calls
    // the API with credentials. See `sessionCookies` for the names.
    const api = new URL(config.server);
    await context.addCookies(
      sessionCookies([frontend, api.origin], config.accessToken),
    );

    const page = await context.newPage();
    // NOT `networkidle`: the editor holds a Yorkie connection open.
    await page.goto(`${frontend}/p/${encodeURIComponent(opts.docId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    try {
      await page.waitForFunction(
        '(window.__wafflebaseSlideRender?.count() ?? 0) > 0',
        undefined,
        { timeout: 60_000 },
      );
    } catch {
      // A signed-out browser is the likeliest cause and otherwise looks the
      // same as a wrong id, so ask the API what it thinks of the session.
      const status = await page
        .evaluate<number>(
          `fetch(${JSON.stringify(`${api.origin}/auth/me`)}, { credentials: 'include' })` +
            '.then((r) => r.status, () => 0)',
        )
        .catch(() => 0);
      if (status === 401 || status === 403) {
        throw new Error(
          `The browser is not signed in to ${api.origin} (GET /auth/me → ${status}). ` +
            'Run `wafflebase login` again, or check --server.',
        );
      }
      throw new Error(
        `The deck did not load in the browser within 60s (${frontend}/p/${opts.docId}). ` +
          'Check the document id, that you can open it, and that --frontend points at the web app.',
      );
    }
    const count = await page.evaluate<number>('window.__wafflebaseSlideRender.count()');
    const numbers = slidesToRender(count, opts.slide);

    mkdirSync(outDir, { recursive: true });
    for (const n of numbers) {
      const target = join(outDir, slideFileName(n));
      if (existsSync(target) && !opts.force) {
        throw new Error(`${target} already exists. Pass --force to overwrite.`);
      }
    }
    for (const n of numbers) {
      const dataUrl = await page.evaluate<string | null>(
        `window.__wafflebaseSlideRender.render(${n - 1})`,
      );
      if (!dataUrl) {
        throw new Error(
          `Slide ${n} could not be rendered: a third-party image tainted the canvas, or an image did not finish loading within 20s.`,
        );
      }
      const target = join(outDir, slideFileName(n));
      writeFileSync(target, decodePngDataUrl(dataUrl));
      written.push(target);
      if (!opts.quiet) log(`Wrote ${target}`);
    }
  } finally {
    await browser.close();
  }
  return written;
}
