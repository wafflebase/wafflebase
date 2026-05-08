import { describe, it, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCanvas } from 'canvas';
import { BUILT_IN_LAYOUTS } from './layout';
import { DEFAULT_MASTER } from './master';
import { renderSlideToPng } from '../test-utils/render-snapshot';
import { BUILT_IN_THEMES } from '../themes';
import type { Slide, SlidesDocument } from './presentation';
import type { Element } from './element';

// Mirror the OffscreenCanvas shim from `themes.visual.test.ts`. The
// docs text painter resolves a 2D context via `OffscreenCanvas` first,
// which Vitest's node environment doesn't provide; install a
// node-canvas-backed shim so `measureText` returns real widths.
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

const GOLDENS_DIR = join(
  __dirname,
  '..',
  '..',
  'test-fixtures',
  'visual',
  'goldens',
  'layouts',
);
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

if (!existsSync(GOLDENS_DIR)) mkdirSync(GOLDENS_DIR, { recursive: true });

describe('built-in layouts x default-light', () => {
  for (const layout of BUILT_IN_LAYOUTS) {
    it(`${layout.id}`, () => {
      const slide: Slide = {
        id: 's1',
        layoutId: layout.id,
        background: { fill: { kind: 'role', role: 'background' } },
        elements: layout.placeholders.map((p, i) => ({
          ...p,
          id: `e${i}`,
        })) as Element[],
        notes: [],
      };
      const doc: SlidesDocument = {
        meta: {
          title: 'Layouts',
          themeId: 'default-light',
          masterId: 'default',
        },
        themes: BUILT_IN_THEMES,
        masters: [DEFAULT_MASTER],
        layouts: BUILT_IN_LAYOUTS,
        slides: [slide],
      };
      const png = renderSlideToPng(slide, doc);
      const goldenPath = join(GOLDENS_DIR, `${layout.id}.png`);
      if (UPDATE || !existsSync(goldenPath)) {
        writeFileSync(goldenPath, png);
        return;
      }
      const golden = readFileSync(goldenPath);
      if (!png.equals(golden)) {
        throw new Error(
          `Visual diff for layout ${layout.id}.\n` +
            `If this change is intentional, re-run with UPDATE_SNAPSHOTS=1:\n` +
            `  UPDATE_SNAPSHOTS=1 pnpm --filter @wafflebase/slides test:visual`,
        );
      }
    });
  }
});
