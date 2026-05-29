import { describe, it, expect, vi } from 'vitest';
import {
  createZoomController,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_PRESETS,
  pickNextPreset,
} from '@/app/slides/zoom-controller';

describe('createZoomController', () => {
  it('initialises to the provided value (default 1.0)', () => {
    expect(createZoomController().get()).toBe(1.0);
    expect(createZoomController(0.75).get()).toBe(0.75);
  });

  it('clamps the initial value into [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(createZoomController(10).get()).toBe(MAX_ZOOM);
    expect(createZoomController(0).get()).toBe(MIN_ZOOM);
  });

  it('clamps set() into [MIN_ZOOM, MAX_ZOOM]', () => {
    const c = createZoomController(1.0);
    c.set(99);
    expect(c.get()).toBe(MAX_ZOOM);
    c.set(-5);
    expect(c.get()).toBe(MIN_ZOOM);
  });

  it('notifies subscribers when the value changes', () => {
    const c = createZoomController(1.0);
    const cb = vi.fn();
    const off = c.subscribe(cb);
    c.set(1.5);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(c.get()).toBe(1.5);
    c.set(1.5);
    // No-op when next === current.
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    c.set(2.0);
    expect(cb).toHaveBeenCalledTimes(1);
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
  it('ZOOM_PRESETS contains 1.0 as the Fit baseline', () => {
    expect(ZOOM_PRESETS).toContain(1.0);
  });
});
