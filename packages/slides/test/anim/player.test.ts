import { describe, it, expect, vi } from 'vitest';
import { AnimationPlayer } from '../../src/anim/player';
import type { Step } from '../../src/anim/timeline';

const mk = (dur: number): Step => ({ items: [
  { anim: { id:'1', elementId:'e1', category:'entrance', effect:'fadeIn', start:'onClick', durationMs:dur }, startAtMs:0, endAtMs:dur },
]});
const size = { w: 1920, h: 1080 };

describe('AnimationPlayer', () => {
  it('plays a step over time on advance', () => {
    const frames: number[] = [];
    const p = new AnimationPlayer([mk(500), mk(500)], size, (s) => frames.push(s.get('e1')!.opacity));
    p.advance();          // start step 0 at t0
    p.tick(0); p.tick(250); p.tick(500);
    expect(frames.at(-1)).toBeCloseTo(1);
    expect(p.isLastStep).toBe(false);
  });
  it('skip-to-end: advancing mid-step completes the current step', () => {
    const onFrame = vi.fn();
    const p = new AnimationPlayer([mk(500), mk(500)], size, onFrame);
    p.advance(); p.tick(0); p.tick(100);
    p.advance();          // mid-step → snap to end, do NOT start next
    const lastBefore = onFrame.mock.calls.at(-1)![0].get('e1').opacity;
    expect(lastBefore).toBeCloseTo(1);
    p.advance();          // now start step 1
    expect(p.isLastStep).toBe(true);
  });
  it('done after last step finishes', () => {
    const p = new AnimationPlayer([mk(100)], size, () => {});
    p.advance(); p.tick(0); p.tick(100);
    expect(p.isLastStep).toBe(true);
    expect(p.done).toBe(true);
  });
});
