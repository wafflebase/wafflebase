import { describe, it, expect, vi } from 'vitest';
import {
  SIZE_STOPS,
  bumpSize,
} from '@/components/text-formatting/text-size-stepper-helpers';

describe('bumpSize', () => {
  it('bumps to the next stop above the current size', () => {
    const idx = SIZE_STOPS.indexOf(12);
    expect(bumpSize(12, +1)).toBe(SIZE_STOPS[idx + 1]);
  });

  it('clamps at the max stop', () => {
    const max = SIZE_STOPS[SIZE_STOPS.length - 1];
    expect(bumpSize(max, +1)).toBe(max);
  });

  it('drops to the next stop below the current size', () => {
    const idx = SIZE_STOPS.indexOf(12);
    expect(bumpSize(12, -1)).toBe(SIZE_STOPS[idx - 1]);
  });

  it('clamps at the min stop', () => {
    const min = SIZE_STOPS[0];
    expect(bumpSize(min, -1)).toBe(min);
  });

  it('treats undefined as the docs default 11', () => {
    // 11 is in SIZE_STOPS; +1 should land on 12.
    expect(bumpSize(undefined, +1)).toBe(12);
    expect(bumpSize(undefined, -1)).toBe(10.5);
  });

  it('snaps off-grid values up to the nearest higher stop', () => {
    expect(bumpSize(13, +1)).toBe(14);
    expect(bumpSize(13, -1)).toBe(12);
  });

  it('snaps off-grid values down to the nearest lower stop', () => {
    expect(bumpSize(15.5, -1)).toBe(14);
    expect(bumpSize(15.5, +1)).toBe(16);
  });

  it('handles half-step entries like 10.5 deterministically', () => {
    expect(bumpSize(10.5, +1)).toBe(11);
    expect(bumpSize(10.5, -1)).toBe(10);
  });
});

describe('TextSizeStepper handler shape', () => {
  /**
   * The component is now a thin wrapper around `bumpSize` and
   * `onPick(nextSize)`. These tests check the wiring the React
   * component does without bringing in @testing-library: bumpSize is
   * called with the current size and the dir, then `onPick` receives
   * the bumped value.
   */
  function makeHandlers(
    currentSize: number | undefined,
    onPick: (next: number) => void,
  ) {
    return {
      onDown: () => onPick(bumpSize(currentSize, -1)),
      onUp: () => onPick(bumpSize(currentSize, +1)),
    };
  }

  it('calls onPick with the bumped size for both directions', () => {
    const onPick = vi.fn();
    const { onUp, onDown } = makeHandlers(12, onPick);
    onUp();
    expect(onPick).toHaveBeenLastCalledWith(14);
    onDown();
    expect(onPick).toHaveBeenLastCalledWith(11);
  });

  it('falls back to the default size when current is undefined', () => {
    const onPick = vi.fn();
    const { onUp } = makeHandlers(undefined, onPick);
    onUp();
    expect(onPick).toHaveBeenLastCalledWith(12);
  });
});
