import { describe, it, expect } from 'vitest';
import { detectUnit, getGridConfig, snapToGrid } from '../../src/view/ruler.js';

describe('ruler units', () => {
  it('detectUnit returns inch for en-US', () => {
    expect(detectUnit('en-US')).toBe('inch');
  });

  it('detectUnit returns cm for ko-KR', () => {
    expect(detectUnit('ko-KR')).toBe('cm');
  });

  it('detectUnit returns cm for fr-FR', () => {
    expect(detectUnit('fr-FR')).toBe('cm');
  });

  it('detectUnit defaults to inch for undefined', () => {
    expect(detectUnit(undefined)).toBe('inch');
  });

  it('getGridConfig returns correct inch config', () => {
    const config = getGridConfig('inch');
    expect(config.majorStepPx).toBe(96);
    expect(config.subdivisions).toBe(8);
    expect(config.minorStepPx).toBe(12);
  });

  it('getGridConfig returns correct cm config', () => {
    const config = getGridConfig('cm');
    expect(config.majorStepPx).toBeCloseTo(37.795, 2);
    expect(config.subdivisions).toBe(10);
  });

  it('snapToGrid snaps to nearest minor step for inch', () => {
    const grid = getGridConfig('inch');
    expect(snapToGrid(13, grid.minorStepPx)).toBe(12);
    expect(snapToGrid(7, grid.minorStepPx)).toBe(12);
    expect(snapToGrid(0, grid.minorStepPx)).toBe(0);
    expect(snapToGrid(96, grid.minorStepPx)).toBe(96);
  });

  it('snapToGrid snaps to nearest minor step for cm', () => {
    const grid = getGridConfig('cm');
    expect(snapToGrid(4, grid.minorStepPx)).toBeCloseTo(grid.minorStepPx, 1);
  });
});
