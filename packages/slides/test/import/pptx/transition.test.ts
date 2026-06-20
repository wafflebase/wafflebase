// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseTransition } from '../../../src/import/pptx/transition-map';
import { ImportReport } from '../../../src/import/pptx/report';
import { child, parseXml } from '../../../src/import/pptx/xml';

/** Build a document from XML and pull the first `<p:transition>` element. */
function parseTransitionEl(xml: string): Element | undefined {
  const doc = parseXml(xml);
  return child(doc.documentElement, 'transition') ?? undefined;
}

const P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

describe('parseTransition', () => {
  it('returns undefined when transitionEl is undefined', () => {
    const report = new ImportReport();
    expect(parseTransition(undefined, report)).toBeUndefined();
    expect(report.transitionsApproximated).toBe(0);
  });

  it('maps <p:fade> with spd="slow" → { type: "fade", durationMs: 1000 }', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition spd="slow"><p:fade/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result).toEqual({ type: 'fade', durationMs: 1000 });
    expect(report.transitionsApproximated).toBe(0);
  });

  it('maps <p:fade> with no spd → durationMs 500 (default med)', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:fade/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result).toEqual({ type: 'fade', durationMs: 500 });
  });

  it('maps <p:fade> with spd="fast" → durationMs 250', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition spd="fast"><p:fade/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result).toEqual({ type: 'fade', durationMs: 250 });
  });

  it('maps <p:push dir="r"> → type "push" with direction "right"', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:push dir="r"/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result?.type).toBe('push');
    expect(result?.direction).toBe('right');
    expect(report.transitionsApproximated).toBe(0);
  });

  it('maps <p:push dir="l"> → direction "left"', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:push dir="l"/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result?.type).toBe('push');
    expect(result?.direction).toBe('left');
  });

  it('maps <p:wipe dir="u"> → type "wipe" with direction "up"', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:wipe dir="u"/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result?.type).toBe('wipe');
    expect(result?.direction).toBe('up');
  });

  it('maps <p:cut> → type "none"', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:cut/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result?.type).toBe('none');
    expect(report.transitionsApproximated).toBe(0);
  });

  it('maps <p:dissolve> → type "dissolve"', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:dissolve/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result?.type).toBe('dissolve');
  });

  it('maps <p:flip> → type "flip"', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:flip/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result?.type).toBe('flip');
  });

  it('maps <p:cube> → type "cube"', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:cube/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result?.type).toBe('cube');
  });

  it('approximates exotic <p:wheel> → type "fade" and bumps transitionsApproximated', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:wheel/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result?.type).toBe('fade');
    expect(report.transitionsApproximated).toBe(1);
  });

  it('approximates <p:blinds> → type "fade" and bumps transitionsApproximated', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:blinds/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result?.type).toBe('fade');
    expect(report.transitionsApproximated).toBe(1);
  });

  it('accumulates multiple approximations across calls', () => {
    const report = new ImportReport();
    const xml = `<p:sld ${P_NS}><p:transition><p:wheel/></p:transition></p:sld>`;
    parseTransition(parseTransitionEl(xml), report);
    parseTransition(parseTransitionEl(xml), report);
    expect(report.transitionsApproximated).toBe(2);
  });

  it('treats <p:transition> with no child elements → type "none"', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition spd="med"/></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result).toEqual({ type: 'none', durationMs: 500 });
    expect(report.transitionsApproximated).toBe(0);
  });

  it('does not set direction for fade (non-directional) types', () => {
    const el = parseTransitionEl(
      `<p:sld ${P_NS}><p:transition><p:fade/></p:transition></p:sld>`,
    );
    const report = new ImportReport();
    const result = parseTransition(el, report);
    expect(result?.direction).toBeUndefined();
  });
});
