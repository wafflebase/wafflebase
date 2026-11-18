import { useState } from "react";
import type { SlidesEditor } from "@wafflebase/slides";
import { IconChecklist, IconUsersGroup } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { BoardSpotlightToggle, BoardTimerControl } from "./board-collab-controls";
import { useSpotlighting } from "./use-spotlighting";
import { BoardLaserToggle } from "./board-drawing-controls";
import type { ToggleTool } from "./board-drawing-extras";
import type { BoardPresenceController } from "./board-presence";
import { useBoardTimer } from "./use-board-timer";
import { useToggleOn } from "./use-toggle-on";
import type { YorkieBoardStore } from "./yorkie-board-store";
import { useBoardCollab } from "./rituals/board-collab-hook";
import { useBoardVoting } from "./rituals/use-board-voting";
import { StartVotingDialog } from "./rituals/start-voting-dialog";
import { startVoting } from "./rituals/start-voting";
import { canVote } from "./rituals/voting";

/** A ghost icon Button at a sm Toggle's 32px, so the group lines up. */
const ICON_BUTTON = "h-8 min-w-8 px-1.5 has-[>svg]:px-1.5";

export interface BoardFacilitateControlsProps {
  store: YorkieBoardStore | null;
  editor: SlidesEditor | null;
  presence: BoardPresenceController | null;
  /** The laser pointer toggle, shared with Shift+K. */
  laser: ToggleTool | null;
  /** No workspace yet: the vote, a document write, waits for one. */
  disabled?: boolean;
}

/**
 * The top bar's Facilitate group: the tools for running a session rather
 * than making content, in one place.
 *
 * ```text
 * [Timer][Vote][Spotlight][Laser]
 * ```
 *
 * Vote is the session (start one, see one is open); casting stays the
 * dock's Stamp tool, which turns into Vote with your votes left. On a
 * phone the group folds into one Facilitate trigger, washed while any of
 * its tools is live, so the idle row still fits ~393px.
 *
 * The toolbar is not mounted for viewers. Vote also renders nothing
 * without a `BoardCollabProvider` or a signed-in user, as the dock's
 * ritual tools do.
 */
export function BoardFacilitateControls({
  store,
  editor,
  presence,
  laser,
  disabled,
}: BoardFacilitateControlsProps) {
  const isMobile = useIsMobile();
  const collab = useBoardCollab();
  const voting = useBoardVoting();
  const [startOpen, setStartOpen] = useState(false);
  const [foldOpen, setFoldOpen] = useState(false);
  const laserOn = useToggleOn(laser);
  const spotlighting = useSpotlighting(presence);
  const { phase } = useBoardTimer(store);

  const canStart = !!collab?.user && !collab.readOnly;
  const voteActive = voting?.status === "active";

  const controls = (
    <>
      <BoardTimerControl store={store} disabled={!editor} />
      {canStart && (
        <BoardVoteControl
          active={voteActive}
          canCast={!!collab?.user && canVote(voting ?? undefined, collab.user.key)}
          disabled={disabled || !store}
          onStart={() => setStartOpen(true)}
          onPickUp={() => collab?.tool.setMode("stamp")}
        />
      )}
      <BoardSpotlightToggle presence={presence} />
      <BoardLaserToggle tool={laser} disabled={!editor} />
    </>
  );

  // Outside the fold, so closing the fold does not unmount the form.
  const dialog = canStart && store && collab?.user && (
    <StartVotingDialog
      open={startOpen}
      onOpenChange={setStartOpen}
      onStart={(input) => {
        if (!collab.user) return;
        startVoting(store, collab.tool, collab.user, input);
        setStartOpen(false);
      }}
    />
  );

  if (!isMobile) {
    return (
      <>
        <div role="group" aria-label="Facilitate" className="flex items-center gap-0.5">
          {controls}
        </div>
        {dialog}
      </>
    );
  }

  const live = laserOn || spotlighting || voteActive || phase !== "idle";
  return (
    <>
      {/* Non-modal like the timer's own popover: a modal layer swallows
          the canvas click that dismisses it (#882). */}
      <Popover modal={false} open={foldOpen} onOpenChange={setFoldOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Facilitate"
                // A folded tool that is live says so on the trigger, the
                // only part of the group on screen (as the dock's More).
                className={cn(ICON_BUTTON, live && "bg-selected text-selected-foreground")}
              >
                <IconUsersGroup size={16} />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Facilitate</TooltipContent>
        </Tooltip>
        <PopoverContent
          align="end"
          data-canvas-toolbar=""
          aria-label="Facilitate"
          className="flex w-auto items-center gap-0.5 p-1"
          // A tool picked here closes the fold so the canvas is free for
          // it; the Timer opens a popover of its own and keeps it open.
          // React bubbles events along the component tree, so a press inside
          // that nested popover (Start, Pause, +1m — portalled elsewhere in
          // the DOM) reaches this handler too: only buttons that are really
          // inside the fold count.
          onClick={(e) => {
            if (!e.currentTarget.contains(e.target as Node)) return;
            const button = (e.target as Element).closest("button");
            if (button && !button.hasAttribute("aria-haspopup")) setFoldOpen(false);
          }}
        >
          {controls}
        </PopoverContent>
      </Popover>
      {dialog}
    </>
  );
}

/**
 * Vote: idle, it opens the Start voting form; while a session is open it
 * wears the selected wash and picks the vote tool back up. Votes left are
 * the dock's to show (on its Vote tool) and the voting card's, not this.
 */
export function BoardVoteControl({
  active,
  canCast,
  disabled,
  onStart,
  onPickUp,
}: {
  active: boolean;
  canCast: boolean;
  disabled?: boolean;
  onStart: () => void;
  onPickUp: () => void;
}) {
  const label = active ? "Voting in progress" : "Start voting";
  const tip = !active
    ? "Start voting…"
    : canCast
      ? "Voting in progress: click to pick up the vote tool"
      : "Voting in progress";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={label}
          className={cn(ICON_BUTTON, active && "bg-selected text-selected-foreground")}
          disabled={disabled}
          onClick={() => {
            if (!active) onStart();
            else if (canCast) onPickUp();
          }}
        >
          <IconChecklist size={16} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
