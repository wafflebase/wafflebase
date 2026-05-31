// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importPptx } from '../../../src/import/pptx/index';
import { buildMinimalPptx } from './__fixtures__/build-minimal-pptx';

describe('importPptx', () => {
  it('imports a minimal deck — theme/master/layout/slide all wired', async () => {
    const buffer = await buildMinimalPptx();
    const { document, report } = await importPptx(buffer);
    expect(document.meta.themeId).toMatch(/^imported-/);
    expect(document.meta.masterId).toMatch(/^imported-/);
    // Imported "Office" theme + 5 built-ins.
    expect(document.themes.length).toBeGreaterThanOrEqual(6);
    const imported = document.themes.find((t) => t.id === document.meta.themeId);
    expect(imported?.colors.accent1).toBe('#4472C4');
    expect(document.masters).toHaveLength(1);
    expect(document.masters[0].themeId).toBe(document.meta.themeId);
    // Built-in layouts + imported (blank) collapsed via dedupe.
    expect(document.layouts.length).toBeGreaterThanOrEqual(11);
    // Minimal fixture ships one blank slide.
    expect(document.slides).toHaveLength(1);
    expect(document.slides[0].layoutId).toBe('blank');
    expect(document.slides[0].elements).toHaveLength(0);
    expect(report.summary()).toContain('no fallbacks');
  });

  it('records `meta.pxPerPt` from <p:sldSz> — 13.333" widescreen ≈ 2 px/pt', async () => {
    const buffer = await buildMinimalPptx(); // default sldSz = 13.333×7.5 widescreen
    const { document } = await importPptx(buffer);
    // 1920 px / (13.333 in × 72 pt/in) = 2
    expect(document.meta.pxPerPt).toBeCloseTo(2, 6);
  });

  it('records `meta.pxPerPt` from a non-default <p:sldSz> — 10" deck ≈ 2.667 px/pt', async () => {
    // 10"×5.625" — Google Slides' historical default 16:9 size.
    const buffer = await buildMinimalPptx({ sldSz: { cx: 9_144_000, cy: 5_143_500 } });
    const { document } = await importPptx(buffer);
    // 1920 px / (10 in × 72 pt/in) ≈ 2.6667
    expect(document.meta.pxPerPt).toBeCloseTo(2.6667, 3);
  });

  it('throws on a buffer without presentation.xml', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    await expect(importPptx(buffer)).rejects.toThrow(/presentation\.xml/);
  });

  it('reports image upload progress via onProgress', async () => {
    const buffer = await buildMinimalPptx({ imageCount: 2 });
    const calls: Array<[number, number]> = [];
    await importPptx(buffer, {
      uploadImage: async () => 'https://cdn/img.png',
      onProgress: (done, total) => calls.push([done, total]),
    });
    // First tick is the up-front (0, total); then one per upload.
    expect(calls[0]).toEqual([0, 2]);
    expect(calls).toHaveLength(3);
    expect(calls.every(([, total]) => total === 2)).toBe(true);
    expect(calls.map(([done]) => done).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('advances progress even when uploadImage throws', async () => {
    const buffer = await buildMinimalPptx({ imageCount: 2 });
    const calls: Array<[number, number]> = [];
    await importPptx(buffer, {
      uploadImage: async () => {
        throw new Error('network down');
      },
      onProgress: (done, total) => calls.push([done, total]),
    });
    // Both uploads soft-fail, but the `finally` still advances the bar.
    expect(calls[0]).toEqual([0, 2]);
    expect(calls).toHaveLength(3);
    expect(calls.map(([done]) => done).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('reports (0, 0) for a deck with no images', async () => {
    const buffer = await buildMinimalPptx();
    const calls: Array<[number, number]> = [];
    await importPptx(buffer, { onProgress: (d, t) => calls.push([d, t]) });
    expect(calls).toEqual([[0, 0]]);
  });
});
