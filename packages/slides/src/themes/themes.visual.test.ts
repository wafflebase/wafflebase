import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCanvas } from 'canvas';
import { BUILT_IN_THEMES } from './index';
import { renderDeckThumbStrip } from '../test-utils/render-snapshot';
import { loadDeckFixture } from '../test-utils/load-fixture';
import { DEFAULT_MASTER } from '../model/master';
import { BUILT_IN_LAYOUTS } from '../model/layout';

// `CanvasTextMeasurer` (used by the docs text painter) tries to acquire
// a 2D context via `OffscreenCanvas` first, then `document.createElement`.
// Vitest's default node environment exposes neither, so we install a
// node-canvas-backed `OffscreenCanvas` shim that returns a real 2D
// context — this gives us actual `measureText` widths so the rendered
// PNG matches a browser baseline rather than a stubbed-width baseline.
class NodeOffscreenCanvas {
  private canvas: ReturnType<typeof createCanvas>;
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = createCanvas(width, height);
  }
  getContext(type: string): unknown {
    if (type !== '2d') return null;
    return this.canvas.getContext('2d');
  }
}

beforeAll(() => {
  if (
    typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas ===
    'undefined'
  ) {
    (
      globalThis as unknown as { OffscreenCanvas: typeof NodeOffscreenCanvas }
    ).OffscreenCanvas = NodeOffscreenCanvas;
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES = ['empty', 'title-only', 'three-slides'] as const;
const GOLDENS_DIR = join(
  __dirname,
  '..',
  '..',
  'test-fixtures',
  'visual',
  'goldens',
);
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

if (!existsSync(GOLDENS_DIR)) mkdirSync(GOLDENS_DIR, { recursive: true });

describe('built-in themes x reference decks', () => {
  for (const themeId of BUILT_IN_THEMES.map((t) => t.id)) {
    for (const fixture of FIXTURES) {
      it(`${themeId} x ${fixture}`, () => {
        const doc = loadDeckFixture(fixture);
        // Inject the live theme/master/layout registries so the fixture
        // file stays small (~30 lines instead of ~400). The fixture
        // only owns the slide-specific bits (slides, meta, notes); the
        // renderer needs a populated theme/master/layout set to
        // resolve role colors.
        doc.meta.themeId = themeId;
        doc.themes = BUILT_IN_THEMES;
        doc.masters = [DEFAULT_MASTER];
        doc.layouts = BUILT_IN_LAYOUTS;
        const png = renderDeckThumbStrip(doc);
        const goldenPath = join(GOLDENS_DIR, `${themeId}__${fixture}.png`);
        if (UPDATE || !existsSync(goldenPath)) {
          writeFileSync(goldenPath, png);
          return;
        }
        const golden = readFileSync(goldenPath);
        expect(png.equals(golden)).toBe(true);
      });
    }
  }
});
