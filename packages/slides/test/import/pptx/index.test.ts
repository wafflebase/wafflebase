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

  it('throws on a buffer without presentation.xml', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    await expect(importPptx(buffer)).rejects.toThrow(/presentation\.xml/);
  });
});
