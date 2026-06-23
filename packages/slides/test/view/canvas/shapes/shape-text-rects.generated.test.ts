import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GENERATED_SHAPE_TEXT_RECTS } from '../../../../src/view/canvas/shapes/shape-text-rects.generated';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', '..', '..', '..', 'scripts', 'gen-shape-text-rects.mjs');

describe('GENERATED_SHAPE_TEXT_RECTS', () => {
  it('resolves the cloud preset rect to the known OOXML fractions', () => {
    const cloud = GENERATED_SHAPE_TEXT_RECTS.cloud;
    expect(cloud).toBeDefined();
    // OOXML cloud <rect>: il=2977/21600, it=3262/21600, ir=17087/21600, ib=17337/21600.
    expect(cloud!.l).toBeCloseTo(2977 / 21600, 5);
    expect(cloud!.t).toBeCloseTo(3262 / 21600, 5);
    expect(cloud!.r).toBeCloseTo(17087 / 21600, 5);
    expect(cloud!.b).toBeCloseTo(17337 / 21600, 5);
  });

  it('spot-checks a few well-known preset rects', () => {
    // roundRect default corner (adj 16667/100000 ≈ 0.16667 of ss): rect inset
    // by ss·(1−√½)/... ≈ 0.0488 per corner. diamond text rect is the centred
    // quarter square. hexagon insets by 1/6 horizontally.
    expect(GENERATED_SHAPE_TEXT_RECTS.diamond).toEqual({ l: 0.25, t: 0.25, r: 0.75, b: 0.75 });
    expect(GENERATED_SHAPE_TEXT_RECTS.hexagon?.l).toBeCloseTo(1 / 6, 4);
    expect(GENERATED_SHAPE_TEXT_RECTS.roundRect?.l).toBeCloseTo(0.048816, 4);
  });

  it('omits full-frame and degenerate-rect shapes', () => {
    // `rect` is the full frame → no entry; `pie`'s rect is angle-dependent and
    // collapses at the default adjustment → skipped, not a 0-wide box.
    expect(GENERATED_SHAPE_TEXT_RECTS.rect).toBeUndefined();
    expect(GENERATED_SHAPE_TEXT_RECTS.pie).toBeUndefined();
  });

  it('every entry is a valid non-degenerate rect within [0, 1]', () => {
    for (const [kind, r] of Object.entries(GENERATED_SHAPE_TEXT_RECTS)) {
      expect(r, kind).toBeDefined();
      expect(r!.l, kind).toBeGreaterThanOrEqual(0);
      expect(r!.t, kind).toBeGreaterThanOrEqual(0);
      expect(r!.r, kind).toBeLessThanOrEqual(1);
      expect(r!.b, kind).toBeLessThanOrEqual(1);
      expect(r!.r - r!.l, kind).toBeGreaterThan(0);
      expect(r!.b - r!.t, kind).toBeGreaterThan(0);
    }
  });

  it('the committed table is in sync with the preset source (no drift)', () => {
    // Runs the generator in --check mode; non-zero exit ⇒ stale checkout.
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});
