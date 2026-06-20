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

/**
 * Compose the full-timeline AnimState for every element at a given moment.
 *
 * - Steps before `currentIndex` are sampled at their END (phase = after).
 * - Step `currentIndex` (if 0 <= currentIndex < steps.length) is sampled at
 *   `elapsedInCurrentMs` — the live animating step.
 * - Steps after `currentIndex` are sampled at BEFORE (elapsedMs = -1,
 *   progress = 0, phase = before) so entrance elements remain hidden.
 *
 * An element can appear in multiple steps (e.g. entrance in step 0, exit in
 * step 3). Per-step results are merged via `composeAnimStates` so both
 * contributions accumulate correctly.
 *
 * `currentIndex = -1` means nothing has been played yet — every step is
 * treated as "future" (before/hidden).
 */
export function sampleTimeline(
  steps: Step[],
  currentIndex: number,
  elapsedInCurrentMs: number,
  slide: { w: number; h: number },
): Map<string, AnimState> {
  const byEl = new Map<string, AnimState[]>();

  for (let i = 0; i < steps.length; i++) {
    let stepMap: Map<string, AnimState>;
    if (i < currentIndex) {
      // Played step — sample at its end.
      stepMap = sampleStep(steps[i], stepDurationMs(steps[i]), slide);
    } else if (i === currentIndex) {
      // Current (animating) step.
      stepMap = sampleStep(steps[i], elapsedInCurrentMs, slide);
    } else {
      // Future step — sample at before (elapsedMs = -1 keeps every item in
      // phase='before', so entrance effects report hidden=true).
      stepMap = sampleStep(steps[i], -1, slide);
    }

    for (const [id, state] of stepMap) {
      const arr = byEl.get(id) ?? [];
      arr.push(state);
      byEl.set(id, arr);
    }
  }

  const out = new Map<string, AnimState>();
  for (const [id, arr] of byEl) out.set(id, composeAnimStates(arr));
  return out;
}
