import { describe, it, expect } from 'vitest';
import { accessSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  PlaywrightUnavailableError,
  decodePngDataUrl,
  loadPlaywright,
  parseSlideNumber,
  renderSlides,
  resolveFrontendUrl,
  slideFileName,
  slidesToRender,
  type PlaywrightLike,
} from '../src/slides/render.js';
import type { CliConfig } from '../src/config/config.js';

describe('slides render: pure parts', () => {
  it('parses --slide as a positive 1-based integer', () => {
    expect(parseSlideNumber(undefined)).toBeUndefined();
    expect(parseSlideNumber('3')).toBe(3);
    for (const bad of ['0', '-1', 'x', '1.5', '']) {
      expect(() => parseSlideNumber(bad)).toThrow(/--slide/);
    }
  });

  it('names outputs slide-<N>.png', () => {
    expect(slideFileName(1)).toBe('slide-1.png');
    expect(slideFileName(12)).toBe('slide-12.png');
  });

  it('selects all slides, or only the requested one', () => {
    expect(slidesToRender(3)).toEqual([1, 2, 3]);
    expect(slidesToRender(3, 2)).toEqual([2]);
    expect(() => slidesToRender(3, 4)).toThrow(/out of range/);
    expect(() => slidesToRender(0)).toThrow(/no slides/);
  });

  it('resolves the frontend URL', () => {
    expect(resolveFrontendUrl(undefined, 'http://localhost:3000')).toBe(
      'http://localhost:5173',
    );
    expect(resolveFrontendUrl(undefined, 'https://api.wafflebase.io')).toBe(
      'https://wafflebase.io',
    );
    expect(resolveFrontendUrl('https://x.test/p', 'https://api.y.io')).toBe(
      'https://x.test',
    );
    expect(() => resolveFrontendUrl(undefined, 'https://other.io')).toThrow(
      /--frontend/,
    );
    expect(() => resolveFrontendUrl('http://evil.test', 'x')).toThrow(
      /neither https nor loopback/,
    );
    expect(() => resolveFrontendUrl('ftp://a', 'x')).toThrow(/http/);
  });

  it('decodes a PNG data URL and rejects anything else', () => {
    const bytes = decodePngDataUrl('data:image/png;base64,iVBORw0KGgo=');
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(() => decodePngDataUrl('data:image/webp;base64,AAAA')).toThrow(/PNG/);
  });
});

describe('slides render: degrade without Playwright', () => {
  it('throws an actionable error when playwright cannot be imported', async () => {
    const err = await loadPlaywright(async () => {
      throw new Error("Cannot find package 'playwright'");
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PlaywrightUnavailableError);
    expect(err.message).toMatch(/playwright install chromium/);
  });

  it('refuses API-key auth before touching the browser', async () => {
    const config: CliConfig = {
      server: 'http://localhost:3000',
      apiKey: 'wfb_x',
      workspace: 'w',
      authMode: 'api-key',
    };
    await expect(
      renderSlides({ docId: 'd', outDir: tmpdir(), config }),
    ).rejects.toThrow(/wafflebase login/);
  });
});

/** Playwright is not a CLI dependency; borrow the frontend's, as the repo's
 *  browser lanes do (`scripts/verify-browser-lanes.mjs`). */
function loadRepoPlaywright(): PlaywrightLike | null {
  try {
    const req = createRequire(
      resolve(__dirname, '../../frontend/package.json'),
    );
    const pw = req('playwright');
    accessSync(pw.chromium.executablePath());
    return pw as PlaywrightLike;
  } catch {
    return null;
  }
}

const repoPlaywright = loadRepoPlaywright();

// Skips cleanly (offline / CI without Chromium). Exercises the real
// Playwright path against a stub page that installs the same
// `window.__wafflebaseSlideRender` hook the editor installs.
describe.skipIf(!repoPlaywright)('slides render: browser', () => {
  it('writes one PNG per slide, or just --slide N', async () => {
    const html = `<!doctype html><script>
      const colors = ['#c00', '#0a0', '#00c'];
      window.__wafflebaseSlideRender = {
        count: () => colors.length,
        render: async (i) => {
          const c = document.createElement('canvas');
          c.width = 1920; c.height = 1080;
          const x = c.getContext('2d');
          x.fillStyle = colors[i]; x.fillRect(0, 0, 1920, 1080);
          return c.toDataURL('image/png');
        },
      };
    </script>`;
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(html);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const config: CliConfig = {
      server: `http://127.0.0.1:${port}`,
      apiKey: '',
      workspace: 'w',
      authMode: 'jwt',
      accessToken: 'tok',
    };
    try {
      const all = mkdtempSync(join(tmpdir(), 'wb-render-'));
      await renderSlides({
        docId: 'doc-1',
        outDir: all,
        frontend: `http://127.0.0.1:${port}`,
        config,
        playwright: repoPlaywright!,
        quiet: true,
      });
      expect(readdirSync(all).sort()).toEqual([
        'slide-1.png',
        'slide-2.png',
        'slide-3.png',
      ]);
      const png = readFileSync(join(all, 'slide-2.png'));
      expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      // IHDR width/height at native 1920x1080.
      expect(png.readUInt32BE(16)).toBe(1920);
      expect(png.readUInt32BE(20)).toBe(1080);

      const one = mkdtempSync(join(tmpdir(), 'wb-render-'));
      await renderSlides({
        docId: 'doc-1',
        outDir: one,
        slide: 3,
        frontend: `http://127.0.0.1:${port}`,
        config,
        playwright: repoPlaywright!,
        quiet: true,
      });
      expect(readdirSync(one)).toEqual(['slide-3.png']);
    } finally {
      server.close();
    }
  }, 60_000);
});
