import type { Step } from './timeline';
import { sampleStep, stepDurationMs } from './sample';
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

  get isLastStep(): boolean { return this.index >= this.steps.length - 1; }
  get done(): boolean { return this.index >= this.steps.length - 1 && this.finishedCurrent; }

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
    this.onFrame(sampleStep(step, elapsed, this.size));
    if (elapsed >= stepDurationMs(step)) { this.finishedCurrent = true; this.playing = false; }
  }

  private snapToEnd(): void {
    const step = this.steps[this.index];
    this.onFrame(sampleStep(step, stepDurationMs(step), this.size));
    this.finishedCurrent = true;
    this.playing = false;
  }

  reset(): void {
    this.index = -1; this.startNow = null; this.playing = false; this.finishedCurrent = true;
  }
}
