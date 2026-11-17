import { useEffect, useState } from "react";
import type { BoardTimerState } from "@/types/board-document";
import {
  normalizeTimer,
  timerPhase,
  timerRemaining,
  type TimerPhase,
} from "./board-timer";

/** What the timer UI needs from `YorkieBoardStore`. */
export interface TimerStore {
  readTimer(): BoardTimerState | undefined;
  writeTimer(next: BoardTimerState): void;
  onChange(cb: () => void): () => void;
}

/**
 * The live timer, re-read on every document change and re-rendered four
 * times a second while it runs (the state holds an end time, so nothing
 * else would tick it).
 */
export function useBoardTimer(store: TimerStore | null): {
  timer: BoardTimerState;
  phase: TimerPhase;
  remaining: number;
} {
  const [timer, setTimer] = useState(() => normalizeTimer(store?.readTimer()));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!store) return;
    const read = () => setTimer(normalizeTimer(store.readTimer()));
    read();
    return store.onChange(read);
  }, [store]);
  const running = timer.endsAt !== null;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  return { timer, phase: timerPhase(timer, now), remaining: timerRemaining(timer, now) };
}

