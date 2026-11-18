import { useEffect, useState } from "react";
import { useBoardTimer, type TimerStore } from "./use-board-timer";
import {
  IconFocus2,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconStopwatch,
} from "@tabler/icons-react";
import type { BoardTimerState } from "@/types/board-document";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  addMinute,
  formatTimer,
  normalizeTimer,
  pauseTimer,
  resetTimer,
  setTimerDuration,
  startTimer,
} from "./board-timer";
import type { BoardPresenceController } from "./board-presence";
import { useSpotlighting } from "./use-spotlighting";

const PULSE_CSS = `
@keyframes wfb-board-timer-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
.wfb-board-timer-done { animation: wfb-board-timer-pulse 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .wfb-board-timer-done { animation: none; } }
`;

/**
 * The countdown everyone sees — editors and viewers alike — over the
 * canvas's top-left corner: the top-right one holds the Download button
 * and the find box, which the chip used to sit under. Hidden while the timer is idle. At zero it
 * turns to "Time's up" with a gentle pulse (none under reduced motion).
 */
export function BoardTimerChip({ store }: { store: TimerStore | null }) {
  const { phase, remaining } = useBoardTimer(store);
  if (phase === "idle") return null;
  const done = phase === "done";
  return (
    <div
      role="timer"
      aria-live={done ? "assertive" : "off"}
      aria-label={done ? "Timer: time's up" : `Timer: ${formatTimer(remaining)}`}
      className={
        "pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium tabular-nums shadow-sm " +
        (done
          ? "wfb-board-timer-done border-transparent bg-primary text-primary-foreground"
          : "bg-popover text-popover-foreground")
      }
    >
      <style>{PULSE_CSS}</style>
      <IconStopwatch size={14} aria-hidden="true" />
      {done ? "Time's up" : formatTimer(remaining)}
      {phase === "paused" && <span className="text-muted-foreground"> paused</span>}
    </div>
  );
}

/**
 * The toolbar's timer control (editors only — the toolbar is not mounted
 * for viewers). Non-modal on purpose: a modal Radix layer swallows the
 * first click on the canvas that dismisses it (see the report on issue
 * #882's follow-up in `board-toolbar-dismiss.test.tsx`).
 */
export function BoardTimerControl({
  store,
  disabled,
}: {
  store: TimerStore | null;
  disabled?: boolean;
}) {
  const { timer, phase, remaining } = useBoardTimer(store);
  const [minutes, setMinutes] = useState(String(Math.round(timer.durationMs / 60_000)));
  useEffect(() => {
    if (phase === "idle") setMinutes(String(Math.round(timer.durationMs / 60_000)));
  }, [phase, timer.durationMs]);

  const write = (fn: (t: BoardTimerState, now: number) => BoardTimerState) => {
    if (!store) return;
    store.writeTimer(fn(normalizeTimer(store.readTimer()), Date.now()));
  };
  const start = () =>
    write((t, now) => {
      if (phase === "idle") {
        const m = Number(minutes);
        const sized = Number.isFinite(m) && m > 0 ? setTimerDuration(m * 60_000) : t;
        return startTimer(sized, now);
      }
      return startTimer(t, now);
    });

  const label = phase === "idle" ? "Timer" : `Timer ${formatTimer(remaining)}`;
  return (
    <Popover modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 min-w-8 gap-1 px-1.5 tabular-nums has-[>svg]:px-1.5"
              aria-label={label}
              disabled={disabled || !store}
            >
              <IconStopwatch size={16} />
              {phase !== "idle" && (
                <span className="text-xs">
                  {phase === "done" ? "0:00" : formatTimer(remaining)}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Timer</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-60 p-3">
        <div className="flex flex-col gap-3">
          <div className="text-center text-2xl font-semibold tabular-nums">
            {phase === "done" ? "Time's up" : formatTimer(remaining)}
          </div>
          {phase === "idle" && (
            <label className="flex items-center justify-between gap-2 text-sm">
              Minutes
              <input
                type="number"
                min={1}
                max={99}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") start();
                }}
                className="h-8 w-16 rounded-md border bg-background px-2 text-right"
                aria-label="Timer minutes"
              />
            </label>
          )}
          <div className="flex gap-1.5">
            {phase === "running" ? (
              <Button size="sm" className="flex-1" onClick={() => write(pauseTimer)}>
                <IconPlayerPause size={14} /> Pause
              </Button>
            ) : (
              <Button size="sm" className="flex-1" onClick={start}>
                <IconPlayerPlay size={14} /> {phase === "paused" ? "Resume" : "Start"}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => write(addMinute)}
              aria-label="Add one minute"
            >
              +1m
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => write((t) => resetTimer(t))}
              disabled={phase === "idle"}
              aria-label="Reset timer"
            >
              <IconRefresh size={14} />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Spotlight me": every other client follows this user's view until they
 * stop it or the spotlighter turns it off.
 */
export function BoardSpotlightToggle({
  presence,
}: {
  presence: BoardPresenceController | null;
}) {
  const on = useSpotlighting(presence);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={on}
          onPressedChange={(pressed) => presence?.setSpotlight(pressed)}
          aria-label="Spotlight me"
          disabled={!presence}
        >
          <IconFocus2 size={16} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>
        {on ? "Stop spotlighting" : "Spotlight me (everyone follows your view)"}
      </TooltipContent>
    </Tooltip>
  );
}
