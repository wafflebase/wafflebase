import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMER_MS,
  addMinute,
  formatTimer,
  normalizeTimer,
  pauseTimer,
  resetTimer,
  setTimerDuration,
  startTimer,
  timerPhase,
  timerRemaining,
} from "./board-timer";

const idle = normalizeTimer(undefined);

describe("board timer model", () => {
  it("reads a missing timer as idle at the default length", () => {
    expect(idle).toEqual({ endsAt: null, pausedRemaining: null, durationMs: DEFAULT_TIMER_MS });
    expect(timerPhase(idle, 0)).toBe("idle");
    expect(timerRemaining(idle, 0)).toBe(DEFAULT_TIMER_MS);
  });

  it("ignores malformed fields rather than crashing", () => {
    expect(normalizeTimer({ endsAt: "x", durationMs: -1 })).toEqual(idle);
  });

  it("runs, pauses and resumes from an absolute end time", () => {
    const running = startTimer(idle, 1000);
    expect(running.endsAt).toBe(1000 + DEFAULT_TIMER_MS);
    expect(timerPhase(running, 2000)).toBe("running");
    expect(timerRemaining(running, 61_000)).toBe(DEFAULT_TIMER_MS - 60_000);

    const paused = pauseTimer(running, 61_000);
    expect(timerPhase(paused, 999_999)).toBe("paused");
    expect(timerRemaining(paused, 999_999)).toBe(DEFAULT_TIMER_MS - 60_000);

    const resumed = startTimer(paused, 100_000);
    expect(resumed.endsAt).toBe(100_000 + DEFAULT_TIMER_MS - 60_000);
  });

  it("is done at zero, and +1m restarts a finished timer", () => {
    const running = startTimer(setTimerDuration(60_000), 0);
    expect(timerPhase(running, 60_000)).toBe("done");
    expect(timerRemaining(running, 70_000)).toBe(0);
    const more = addMinute(running, 70_000);
    expect(timerPhase(more, 70_001)).toBe("running");
    expect(timerRemaining(more, 70_000)).toBe(60_000);
  });

  it("+1m extends a running, paused or idle timer", () => {
    const running = startTimer(idle, 0);
    expect(addMinute(running, 10).endsAt).toBe((running.endsAt as number) + 60_000);
    const paused = pauseTimer(running, 1000);
    expect(addMinute(paused, 0).pausedRemaining).toBe((paused.pausedRemaining as number) + 60_000);
    expect(addMinute(idle, 0).durationMs).toBe(DEFAULT_TIMER_MS + 60_000);
  });

  it("reset returns to idle and keeps the length", () => {
    const r = resetTimer(startTimer(setTimerDuration(3 * 60_000), 0));
    expect(timerPhase(r, 0)).toBe("idle");
    expect(r.durationMs).toBe(3 * 60_000);
  });

  it("clamps the length to 1–99 minutes", () => {
    expect(setTimerDuration(0).durationMs).toBe(60_000);
    expect(setTimerDuration(1e9).durationMs).toBe(99 * 60_000);
  });

  it("formats m:ss rounding up", () => {
    expect(formatTimer(0)).toBe("0:00");
    expect(formatTimer(1)).toBe("0:01");
    expect(formatTimer(61_000)).toBe("1:01");
    expect(formatTimer(5 * 60_000)).toBe("5:00");
  });
});
