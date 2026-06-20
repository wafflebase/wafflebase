import { describe, it, expect, vi } from 'vitest';
import { AnimationPlayer } from '../../src/anim/player';
import type { Step } from '../../src/anim/timeline';
import type { AnimState } from '../../src/anim/state';

/** Make a single-item step with a fadeIn on the given element id. */
const mkStep = (elementId: string, dur: number): Step => ({ items: [
  { anim: { id: elementId, elementId, category: 'entrance', effect: 'fadeIn', start: 'onClick', durationMs: dur }, startAtMs: 0, endAtMs: dur },
]});

/**
 * Legacy helper: both steps animate e1. Used only where the test does NOT
 * inspect per-element state after a multi-step composition.
 */
const mk = (dur: number): Step => mkStep('e1', dur);

const size = { w: 1920, h: 1080 };

describe('AnimationPlayer', () => {
  it('plays a step over time on advance', () => {
    // Use two steps on DIFFERENT elements so full-timeline composition
    // does not mix step-1-future opacity into step-0-current opacity.
    const frames: number[] = [];
    const steps = [mkStep('e1', 500), mkStep('e2', 500)];
    const p = new AnimationPlayer(steps, size, (s) => frames.push(s.get('e1')!.opacity));
    p.advance();          // start step 0 at t0
    p.tick(0); p.tick(250); p.tick(500);
    // step0: elapsed=500 >= duration → after, opacity=1. step1: future, but
    // step1 does NOT animate e1, so e1's composed opacity comes only from step0.
    expect(frames.at(-1)).toBeCloseTo(1);
    expect(p.isLastStep).toBe(false);
  });

  it('skip-to-end: advancing mid-step completes the current step', () => {
    // Two steps on different elements so that snap-to-end of step0 reflects
    // step0's final state without step1's future entrance hiding e1.
    const onFrame = vi.fn();
    const steps = [mkStep('e1', 500), mkStep('e2', 500)];
    const p = new AnimationPlayer(steps, size, onFrame);
    p.advance(); p.tick(0); p.tick(100);
    p.advance();          // mid-step → snap to end, do NOT start next
    const lastFrame: Map<string, AnimState> = onFrame.mock.calls.at(-1)![0];
    // e1 is in step0 (after snap → after phase → opacity=1).
    // e2 is in step1 (future → before → opacity=0, hidden=true) — but e2 is a
    // different element so it does not affect e1's composed state.
    expect(lastFrame.get('e1')?.opacity).toBeCloseTo(1);
    p.advance();          // now start step 1
    expect(p.isLastStep).toBe(true);
  });

  it('done after last step finishes', () => {
    const p = new AnimationPlayer([mk(100)], size, () => {});
    p.advance(); p.tick(0); p.tick(100);
    expect(p.isLastStep).toBe(true);
    expect(p.done).toBe(true);
  });

  it('restingState() before any advance hides the entrance element', () => {
    // Single-step player: index=-1 → step0 is future → e1 hidden.
    const p = new AnimationPlayer([mk(500)], size, () => {});
    const rs = p.restingState();
    expect(rs.get('e1')?.hidden).toBe(true);
  });

  it('restingState() after step 0 completes shows the entrance element as visible', () => {
    // Two steps on DIFFERENT elements so that after step0 settles:
    //   step0 (past): e1 after → opacity=1, hidden=false
    //   step1 (future): e2 before → opacity=0, hidden=true
    // e1 is NOT animated by step1, so e1's resting state has no step1 contribution.
    const steps = [mkStep('e1', 500), mkStep('e2', 500)];
    const p = new AnimationPlayer(steps, size, () => {});
    p.advance();         // start step 0 (index becomes 0)
    p.tick(0);
    p.tick(500);         // step 0 finishes (elapsed >= duration)
    const rs = p.restingState();
    // e1: step0 after → visible.
    expect(rs.get('e1')?.hidden).toBe(false);
    expect(rs.get('e1')?.opacity).toBeCloseTo(1);
    // e2: step1 future → still hidden.
    expect(rs.get('e2')?.hidden).toBe(true);
  });
});
