import type { AnimEffect, AnimDirection } from '../model/element';
import { type AnimState, IDENTITY } from './state';

type Opts = {
  progress: number;
  phase: 'before' | 'active' | 'after';
  direction?: AnimDirection;
  slideW: number;
  slideH: number;
};

function offset(
  dir: AnimDirection | undefined,
  w: number,
  h: number,
): { dx: number; dy: number } {
  switch (dir ?? 'left') {
    case 'left':
      return { dx: -w, dy: 0 };
    case 'right':
      return { dx: w, dy: 0 };
    case 'up':
      return { dx: 0, dy: -h };
    case 'down':
      return { dx: 0, dy: h };
  }
}

export function sampleEffect(effect: AnimEffect, o: Opts): AnimState {
  const p = o.progress;
  switch (effect) {
    case 'appear':
      return { ...IDENTITY, hidden: o.phase === 'before' };
    case 'disappear':
      return { ...IDENTITY, hidden: o.phase === 'after' };
    case 'fadeIn':
      return { ...IDENTITY, opacity: p, hidden: o.phase === 'before' };
    case 'fadeOut':
      return { ...IDENTITY, opacity: 1 - p, hidden: o.phase === 'after' };
    case 'flyIn': {
      const { dx, dy } = offset(o.direction, o.slideW, o.slideH);
      return {
        ...IDENTITY,
        dx: dx * (1 - p),
        dy: dy * (1 - p),
        opacity: p,
        hidden: o.phase === 'before',
      };
    }
    case 'flyOut': {
      const { dx, dy } = offset(o.direction, o.slideW, o.slideH);
      return {
        ...IDENTITY,
        dx: dx * p,
        dy: dy * p,
        opacity: 1 - p,
        hidden: o.phase === 'after',
      };
    }
    case 'zoomIn':
      return {
        ...IDENTITY,
        scale: 0.3 + 0.7 * p,
        opacity: p,
        hidden: o.phase === 'before',
      };
    case 'zoomOut':
      return {
        ...IDENTITY,
        scale: 1 - 0.7 * p,
        opacity: 1 - p,
        hidden: o.phase === 'after',
      };
    case 'spin':
      return {
        ...IDENTITY,
        rotation: p * 2 * Math.PI,
        hidden: o.phase === 'before',
      };
    case 'pulse':
      return { ...IDENTITY, scale: 1 + 0.2 * Math.sin(p * Math.PI) };
    case 'grow':
      return { ...IDENTITY, scale: 1 + 0.3 * p };
  }
}
