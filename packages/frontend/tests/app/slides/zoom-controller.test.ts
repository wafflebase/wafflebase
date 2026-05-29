import { describe, it, expect, vi } from 'vitest';
import {
  createZoomController,
  FIT_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_PRESETS,
  pickNextPreset,
} from '@/app/slides/zoom-controller';

describe('createZoomController', () => {
  it('defaults to Fit (FIT_ZOOM = 0)', () => {
    expect(createZoomController().get()).toBe(FIT_ZOOM);
    expect(FIT_ZOOM).toBe(0);
  });

  it('initialises to a provided absolute zoom', () => {
    expect(createZoomController(0.75).get()).toBe(0.75);
  });

  it('preserves FIT_ZOOM on initialisation (not clamped to MIN_ZOOM)', () => {
    expect(createZoomController(FIT_ZOOM).get()).toBe(FIT_ZOOM);
  });

  it('clamps absolute zoom into [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(createZoomController(10).get()).toBe(MAX_ZOOM);
    expect(createZoomController(0.1).get()).toBe(MIN_ZOOM);
  });

  it('preserves FIT_ZOOM through set()', () => {
    const c = createZoomController(1.0);
    c.set(FIT_ZOOM);
    expect(c.get()).toBe(FIT_ZOOM);
  });

  it('clamps set() absolute zooms but not FIT_ZOOM', () => {
    const c = createZoomController(1.0);
    c.set(99);
    expect(c.get()).toBe(MAX_ZOOM);
    c.set(FIT_ZOOM);
    expect(c.get()).toBe(FIT_ZOOM);
  });

  it('notifies subscribers on every change including Fit ↔ absolute', () => {
    const c = createZoomController();
    const cb = vi.fn();
    const off = c.subscribe(cb);
    c.set(1.5);
    expect(cb).toHaveBeenCalledTimes(1);
    c.set(FIT_ZOOM);
    expect(cb).toHaveBeenCalledTimes(2);
    c.set(FIT_ZOOM); // no-op
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    c.set(2.0);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('supports multiple subscribers and unsubscribe', () => {
    const c = createZoomController();
    const a = vi.fn();
    const b = vi.fn();
    const offA = c.subscribe(a);
    c.subscribe(b);
    c.set(0.5);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    c.set(1.0);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});

describe('pickNextPreset', () => {
  it('picks the next higher preset', () => {
    expect(pickNextPreset(1.0, +1)).toBe(1.5);
  });
  it('picks the next lower preset', () => {
    expect(pickNextPreset(1.0, -1)).toBe(0.75);
  });
  it('treats FIT_ZOOM as 100 % for stepping', () => {
    expect(pickNextPreset(FIT_ZOOM, +1)).toBe(1.5);
    expect(pickNextPreset(FIT_ZOOM, -1)).toBe(0.75);
  });
  it('clamps at the highest preset going up', () => {
    expect(pickNextPreset(2.0, +1)).toBe(2.0);
  });
  it('clamps at the lowest preset going down', () => {
    expect(pickNextPreset(0.5, -1)).toBe(0.5);
  });
  it('snaps off-preset values up to the nearest higher preset', () => {
    expect(pickNextPreset(0.6, +1)).toBe(0.75);
  });
  it('snaps off-preset values down to the nearest lower preset', () => {
    expect(pickNextPreset(1.7, -1)).toBe(1.5);
  });
  it('ZOOM_PRESETS no longer contains a Fit sentinel — only absolute values', () => {
    expect(ZOOM_PRESETS).toEqual([0.5, 0.75, 1.0, 1.5, 2.0]);
    expect(ZOOM_PRESETS).not.toContain(FIT_ZOOM);
  });
});
