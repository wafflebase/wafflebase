import type { Slide, SlideAnimation } from '../model/presentation';

export type ScheduledAnim = { anim: SlideAnimation; startAtMs: number; endAtMs: number };
export type Step = { items: ScheduledAnim[] };

export function compileTimeline(
  slide: Slide,
  opts?: { existingElementIds?: Set<string>; paragraphCounts?: Map<string, number> },
): Step[] {
  const raw = (slide.animations ?? []).filter(
    (a) => !opts?.existingElementIds || opts.existingElementIds.has(a.elementId),
  );
  // Expand by-paragraph into one afterPrev-chained effect per paragraph.
  const seq: SlideAnimation[] = [];
  for (const a of raw) {
    const n = a.byParagraph ? (opts?.paragraphCounts?.get(a.elementId) ?? 1) : 1;
    for (let i = 0; i < n; i++) {
      seq.push(i === 0 ? a : { ...a, id: `${a.id}#${i}`, start: 'afterPrev' });
    }
  }

  const steps: Step[] = [];
  let cur: ScheduledAnim[] | null = null;
  let prev: ScheduledAnim | null = null;

  for (const anim of seq) {
    const dur = anim.durationMs;
    const delay = anim.delayMs ?? 0;
    let sa: ScheduledAnim;
    if (anim.start === 'onClick' || cur === null) {
      cur = [];
      steps.push({ items: cur });
      const startAtMs: number = delay;
      sa = { anim, startAtMs, endAtMs: startAtMs + dur };
      cur.push(sa); prev = sa;
    } else if (anim.start === 'withPrev') {
      const startAtMs: number = (prev?.startAtMs ?? 0) + delay;
      sa = { anim, startAtMs, endAtMs: startAtMs + dur };
      cur.push(sa); prev = sa;
    } else { // afterPrev
      const startAtMs: number = (prev?.endAtMs ?? 0) + delay;
      sa = { anim, startAtMs, endAtMs: startAtMs + dur };
      cur.push(sa); prev = sa;
    }
  }
  return steps;
}
