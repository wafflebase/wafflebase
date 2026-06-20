import type { Step } from './timeline';
import { sampleTimeline, stepDurationMs } from './sample';
import type { AnimState } from './state';

export class AnimationPlayer {
  private index = -1;        // current step index, -1 = not started
  private startNow: number | null = null;
  private playing = false;
  private finishedCurrent = true;

  constructor(
    private readonly steps: Step[],
    private readonly size: { w: number; h: number },
    private readonly onFrame: (s: Map<string, AnimState>) => void,
  ) {}

  get isAnimating(): boolean { return this.playing; }
  get isLastStep(): boolean { return this.index >= this.steps.length - 1; }
  get done(): boolean { return this.index >= this.steps.length - 1 && this.finishedCurrent; }
  /** True when the slide has at least one animation step. */
  get hasSteps(): boolean { return this.steps.length > 0; }

  /** Next user input. Returns true if it consumed an animation step
   *  (so the caller should NOT also advance the slide). */
  advance(): boolean {
    if (this.playing && !this.finishedCurrent) {
      this.snapToEnd();                  // skip-to-end
      return true;
    }
    if (this.index >= this.steps.length - 1) return false; // nothing left
    this.index += 1;
    this.startNow = null;
    this.playing = true;
    this.finishedCurrent = false;
    return true;
  }

  tick(nowMs: number): void {
    if (!this.playing || this.index < 0) return;
    if (this.startNow === null) this.startNow = nowMs;
    const elapsed = nowMs - this.startNow;
    const step = this.steps[this.index];
    // Emit the full-timeline composed state so past steps remain settled and
    // future entrance elements stay hidden while the current step animates.
    this.onFrame(sampleTimeline(this.steps, this.index, elapsed, this.size));
    if (elapsed >= stepDurationMs(step)) { this.finishedCurrent = true; this.playing = false; }
  }

  private snapToEnd(): void {
    const step = this.steps[this.index];
    // Snap: sample full timeline with the current step at its end.
    this.onFrame(sampleTimeline(this.steps, this.index, stepDurationMs(step), this.size));
    this.finishedCurrent = true;
    this.playing = false;
  }

  /**
   * The "resting state" of the timeline at this moment — what should be
   * painted when no animation is actively ticking (slide entry, between
   * steps, resize, etc.).
   *
   * - Before any step has played (index === -1): every step is future →
   *   entrance elements are hidden.
   * - After step k settles: steps 0..k are done (after), steps k+1.. are
   *   future (before/hidden).
   *
   * The current step is sampled at its END so a freshly-settled step shows
   * elements at their fully-played position.
   */
  restingState(): Map<string, AnimState> {
    const endOfCurrent = this.index >= 0 ? stepDurationMs(this.steps[this.index]) : 0;
    return sampleTimeline(this.steps, this.index, endOfCurrent, this.size);
  }

  reset(): void {
    this.index = -1; this.startNow = null; this.playing = false; this.finishedCurrent = true;
  }
}
