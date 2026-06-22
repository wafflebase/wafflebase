import { describe, it, expect } from 'vitest';
import { freeformToCustGeom } from '../../../src/export/pptx/freeform.js';

describe('freeformToCustGeom', () => {
  it('emits a path with moveTo/lnTo/close', () => {
    const xml = freeformToCustGeom({ commands: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 0.5 }, { c: 'Z' }] }, { x: 0, y: 0, w: 100, h: 100, rotation: 0 });
    expect(xml).toContain('<a:custGeom>');
    expect(xml).toContain('<a:moveTo>');
    expect(xml).toContain('<a:lnTo>');
    expect(xml).toContain('<a:close/>');
  });
  it('emits quadBezTo for Q commands', () => {
    const xml = freeformToCustGeom({ commands: [
      { c: 'M', x: 0, y: 0 },
      { c: 'Q', x1: 0.5, y1: 0, x: 1, y: 0 },
    ] }, { x: 0, y: 0, w: 100, h: 100, rotation: 0 });
    expect(xml).toContain('<a:quadBezTo>');
  });
  it('emits cubicBezTo for C commands', () => {
    const xml = freeformToCustGeom({ commands: [
      { c: 'M', x: 0, y: 0 },
      { c: 'C', x1: 0.25, y1: 0, x2: 0.75, y2: 0, x: 1, y: 0 },
    ] }, { x: 0, y: 0, w: 100, h: 100, rotation: 0 });
    expect(xml).toContain('<a:cubicBezTo>');
  });
  it('emits arcTo for A commands with correct OOXML angle encoding', () => {
    // A command stores start/sweep in radians; OOXML expects 60000ths of degrees.
    // Math.PI/2 radians = 90 degrees = 5400000 in OOXML 60k units.
    const xml = freeformToCustGeom({ commands: [
      { c: 'M', x: 0, y: 0 },
      { c: 'A', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5, start: Math.PI / 2, sweep: Math.PI / 2 },
    ] }, { x: 0, y: 0, w: 100, h: 100, rotation: 0 });
    expect(xml).toContain('<a:arcTo');
    expect(xml).toContain('stAng="5400000"');
    expect(xml).toContain('swAng="5400000"');
  });
  it('emits correct path width/height (GUIDE=100000)', () => {
    const xml = freeformToCustGeom({ commands: [{ c: 'M', x: 0, y: 0 }] }, { x: 0, y: 0, w: 200, h: 100, rotation: 0 });
    expect(xml).toContain('w="100000"');
    expect(xml).toContain('h="100000"');
  });
  it('normalizes [0,1] coordinates to GUIDE space', () => {
    const xml = freeformToCustGeom({ commands: [
      { c: 'M', x: 0.5, y: 0.25 },
    ] }, { x: 0, y: 0, w: 100, h: 100, rotation: 0 });
    expect(xml).toContain('x="50000"');
    expect(xml).toContain('y="25000"');
  });
});
