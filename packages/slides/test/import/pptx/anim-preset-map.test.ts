import { describe, it, expect } from 'vitest';
import { mapPreset } from '../../../src/import/pptx/anim-preset-map';

describe('mapPreset', () => {
  // --- Entrance ---

  it('maps Appear entrance (entr, 1)', () => {
    expect(mapPreset('entr', 1)).toEqual({ category: 'entrance', effect: 'appear' });
  });

  it('maps Fade entrance (entr, 10)', () => {
    expect(mapPreset('entr', 10)).toEqual({ category: 'entrance', effect: 'fadeIn' });
  });

  it('maps Zoom In entrance (entr, 23)', () => {
    expect(mapPreset('entr', 23)).toEqual({ category: 'entrance', effect: 'zoomIn' });
  });

  it('maps Spin entrance (entr, 8)', () => {
    expect(mapPreset('entr', 8)).toEqual({ category: 'entrance', effect: 'spin' });
  });

  // --- Fly In entrance with direction subtypes ---

  it('maps Fly In entrance (entr, 2) with subtype 4 (from bottom) → direction up', () => {
    const m = mapPreset('entr', 2, 4);
    expect(m?.effect).toBe('flyIn');
    expect(m?.category).toBe('entrance');
    expect(m?.direction).toBe('up');
  });

  it('maps Fly In entrance (entr, 2) with subtype 8 (from top) → direction down', () => {
    const m = mapPreset('entr', 2, 8);
    expect(m?.direction).toBe('down');
  });

  it('maps Fly In entrance (entr, 2) with subtype 1 (from left) → direction right', () => {
    const m = mapPreset('entr', 2, 1);
    expect(m?.direction).toBe('right');
  });

  it('maps Fly In entrance (entr, 2) with subtype 2 (from right) → direction left', () => {
    const m = mapPreset('entr', 2, 2);
    expect(m?.direction).toBe('left');
  });

  it('maps Fly In entrance (entr, 2) with unknown subtype → defaults to left', () => {
    const m = mapPreset('entr', 2, 99);
    expect(m?.effect).toBe('flyIn');
    expect(m?.direction).toBe('left');
  });

  it('maps Fly In entrance (entr, 2) with no subtype → defaults to left', () => {
    const m = mapPreset('entr', 2);
    expect(m?.effect).toBe('flyIn');
    expect(m?.direction).toBe('left');
  });

  it('maps Fly In blinds variant (entr, 3) to flyIn', () => {
    const m = mapPreset('entr', 3, 4);
    expect(m?.effect).toBe('flyIn');
    expect(m?.category).toBe('entrance');
    expect(m?.direction).toBe('up');
  });

  // --- Exit ---

  it('maps Disappear exit (exit, 1)', () => {
    expect(mapPreset('exit', 1)).toEqual({ category: 'exit', effect: 'disappear' });
  });

  it('maps Fade exit (exit, 10)', () => {
    expect(mapPreset('exit', 10)).toEqual({ category: 'exit', effect: 'fadeOut' });
  });

  it('maps Zoom Out exit (exit, 23)', () => {
    expect(mapPreset('exit', 23)).toEqual({ category: 'exit', effect: 'zoomOut' });
  });

  it('maps Fly Out exit (exit, 2) with subtype 4 (to top) → direction up', () => {
    const m = mapPreset('exit', 2, 4);
    expect(m?.effect).toBe('flyOut');
    expect(m?.direction).toBe('up');
  });

  // --- Emphasis ---

  it('maps Grow/Shrink emphasis (emph, 6) → grow', () => {
    expect(mapPreset('emph', 6)).toEqual({ category: 'emphasis', effect: 'grow' });
  });

  it('maps Pulse emphasis (emph, 18) → pulse', () => {
    expect(mapPreset('emph', 18)).toEqual({ category: 'emphasis', effect: 'pulse' });
  });

  // --- Unknown / unmapped ---

  it('returns null for unknown preset ID within known class (entr)', () => {
    expect(mapPreset('entr', 9999)).toBeNull();
  });

  it('returns null for unknown preset ID within known class (exit)', () => {
    expect(mapPreset('exit', 9999)).toBeNull();
  });

  it('returns null for unknown preset ID within known class (emph)', () => {
    expect(mapPreset('emph', 9999)).toBeNull();
  });

  it('returns null for path class (motion paths not mapped)', () => {
    expect(mapPreset('path', 1)).toBeNull();
  });

  it('returns null for mediacall class', () => {
    expect(mapPreset('mediacall', 1)).toBeNull();
  });

  it('returns null for verb class', () => {
    expect(mapPreset('verb', 1)).toBeNull();
  });

  it('returns null for completely unknown class', () => {
    expect(mapPreset('unknown', 1)).toBeNull();
  });
});
