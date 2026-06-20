import type { AnimEasing } from '../model/element';

export function applyEasing(easing: AnimEasing | undefined, p: number): number {
  const t = Math.max(0, Math.min(1, p));
  switch (easing ?? 'easeInOut') {
    case 'linear': return t;
    case 'easeIn': return t * t;
    case 'easeOut': return t * (2 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
}
