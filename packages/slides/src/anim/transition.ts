import type { SlideTransition } from '../model/presentation';

export type CrossPaint = {
  prevAlpha: number;
  nextAlpha: number;
  prevDx: number;
  nextDx: number;
  prevDy: number;
  nextDy: number;
  clipNext?: { x: number; y: number; w: number; h: number };
};

export function sampleTransition(
  t: SlideTransition,
  progress: number,
  size: { w: number; h: number }
): CrossPaint {
  const p = Math.max(0, Math.min(1, progress));
  const base: CrossPaint = {
    prevAlpha: 1,
    nextAlpha: 1,
    prevDx: 0,
    nextDx: 0,
    prevDy: 0,
    nextDy: 0,
  };

  switch (t.type) {
    case 'none':
      return { ...base, prevAlpha: 1 - p, nextAlpha: 1 };
    case 'fade':
    case 'dissolve':
    case 'flip': // approximated as fade
    case 'cube': // approximated as fade
      return { ...base, prevAlpha: 1 - p, nextAlpha: p };
    case 'push':
    case 'slide': {
      const sign = t.direction === 'left' ? -1 : 1; // default: from right
      return {
        ...base,
        prevDx: -sign * size.w * p,
        nextDx: sign * size.w * (1 - p),
      };
    }
    case 'wipe':
      return {
        ...base,
        clipNext: { x: 0, y: 0, w: size.w * p, h: size.h },
      };
  }
}
