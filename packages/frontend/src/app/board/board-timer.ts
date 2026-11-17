import type { BoardTimerState } from "@/types/board-document";

/**
 * The shared facilitation timer's pure model.
 *
 * It lives in DOCUMENT state (`YorkieBoardRoot.timer`), not presence, so a
 * late joiner sees a countdown already running. The state stores an
 * absolute end time rather than a ticking value, so nothing writes while
 * it runs: every client derives the remaining time from its own clock.
 * The cost is clock skew between clients (usually well under a second on
 * NTP-synced machines), which a facilitation timer tolerates.
 */

export type TimerPhase = "idle" | "running" | "paused" | "done";

export const DEFAULT_TIMER_MS = 5 * 60 * 1000;
export const MAX_TIMER_MS = 99 * 60 * 1000;

/** A missing or malformed timer reads as idle at the default length. */
export function normalizeTimer(raw: unknown): BoardTimerState {
  const r = (raw ?? {}) as Partial<BoardTimerState>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const duration = num(r.durationMs);
  return {
    endsAt: num(r.endsAt),
    pausedRemaining: num(r.pausedRemaining),
    durationMs: duration !== null && duration > 0 ? duration : DEFAULT_TIMER_MS,
  };
}

export function timerRemaining(t: BoardTimerState, now: number): number {
  if (t.endsAt !== null) return Math.max(0, t.endsAt - now);
  if (t.pausedRemaining !== null) return Math.max(0, t.pausedRemaining);
  return t.durationMs;
}

export function timerPhase(t: BoardTimerState, now: number): TimerPhase {
  if (t.endsAt !== null) return t.endsAt - now > 0 ? "running" : "done";
  if (t.pausedRemaining !== null) return "paused";
  return "idle";
}

export function startTimer(t: BoardTimerState, now: number): BoardTimerState {
  const remaining =
    t.pausedRemaining !== null && t.pausedRemaining > 0
      ? t.pausedRemaining
      : t.durationMs;
  return { ...t, endsAt: now + remaining, pausedRemaining: null };
}

export function pauseTimer(t: BoardTimerState, now: number): BoardTimerState {
  if (t.endsAt === null) return t;
  return { ...t, endsAt: null, pausedRemaining: Math.max(0, t.endsAt - now) };
}

export function resetTimer(t: BoardTimerState): BoardTimerState {
  return { ...t, endsAt: null, pausedRemaining: null };
}

/** Set the length; only meaningful while idle, so it also resets. */
export function setTimerDuration(ms: number): BoardTimerState {
  const clamped = Math.min(MAX_TIMER_MS, Math.max(60_000, Math.round(ms)));
  return { endsAt: null, pausedRemaining: null, durationMs: clamped };
}

/**
 * +1 minute. Extends a running or paused countdown; a finished one
 * restarts with one minute on the clock; an idle one lengthens.
 */
export function addMinute(t: BoardTimerState, now: number): BoardTimerState {
  const phase = timerPhase(t, now);
  if (phase === "running") return { ...t, endsAt: (t.endsAt as number) + 60_000 };
  if (phase === "done") return { ...t, endsAt: now + 60_000 };
  if (phase === "paused") {
    return { ...t, pausedRemaining: (t.pausedRemaining as number) + 60_000 };
  }
  return { ...t, durationMs: Math.min(MAX_TIMER_MS, t.durationMs + 60_000) };
}

/** `m:ss`, rounding UP so a countdown shows 0:00 only when it is over. */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
