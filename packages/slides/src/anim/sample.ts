import type { Step } from './timeline';
import { applyEasing } from './easing';
import { sampleEffect } from './effects';
import { composeAnimStates, type AnimState } from './state';

export function stepDurationMs(step: Step): number {
  return step.items.reduce((m, it) => Math.max(m, it.endAtMs), 0);
}

export function sampleStep(step: Step, elapsedMs: number, slide: { w: number; h: number }): Map<string, AnimState> {
  const byEl = new Map<string, AnimState[]>();
  for (const it of step.items) {
    const dur = it.endAtMs - it.startAtMs;
    let phase: 'before' | 'active' | 'after';
    let progress: number;
    if (elapsedMs < it.startAtMs) { phase = 'before'; progress = 0; }
    else if (elapsedMs >= it.endAtMs) { phase = 'after'; progress = 1; }
    else { phase = 'active'; progress = dur > 0 ? (elapsedMs - it.startAtMs) / dur : 1; }
    const eased = applyEasing(it.anim.easing, progress);
    const s = sampleEffect(it.anim.effect, {
      progress: eased, phase, direction: it.anim.direction, slideW: slide.w, slideH: slide.h,
    });
    const arr = byEl.get(it.anim.elementId) ?? [];
    arr.push(s);
    byEl.set(it.anim.elementId, arr);
  }
  const out = new Map<string, AnimState>();
  for (const [id, arr] of byEl) out.set(id, composeAnimStates(arr));
  return out;
}
