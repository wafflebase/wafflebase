import { useState } from "react";
import {
  IconChevronDown,
  IconMessagePlus,
  IconThumbUp,
  IconCircleCheck,
} from "@tabler/icons-react";

import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { YorkieBoardStore } from "../yorkie-board-store";
import { useBoardCollab } from "./board-collab-hook";
import { useRitualToolState } from "./use-ritual-tool-state";
import { writeStartVoting } from "./ritual-writes";
import { STAMP_KINDS, stampGlyph } from "./stamps";
import type { BoardStampKind } from "./types";
import { useBoardVoting } from "./use-board-voting";
import {
  MAX_VOTES_PER_PERSON,
  MIN_VOTES_PER_PERSON,
  canVote,
  clampVotesPerPerson,
  createVoting,
  votesLeft,
} from "./voting";

/**
 * Toolbar block for the rituals: the Stamp tool (a Vote tool while a
 * session is open for you), its stamp-kind / Start voting menu, and the
 * Comment tool. Renders nothing without a `BoardCollabProvider` (the
 * share-link route) or a signed-in user.
 */
export function BoardRitualTools({
  store,
  disabled,
}: {
  store: YorkieBoardStore | null;
  disabled?: boolean;
}) {
  const collab = useBoardCollab();
  const state = useRitualToolState();
  const voting = useBoardVoting();
  const [startOpen, setStartOpen] = useState(false);
  if (!collab || !state || !collab.user || collab.readOnly) return null;
  const { tool, user } = collab;
  const voteMode = canVote(voting ?? undefined, user.key);
  const left = voteMode ? votesLeft(voting ?? undefined, user.key) : 0;
  const stampLabel = voteMode
    ? `Vote (${left} left)`
    : `Stamp ${STAMP_KINDS.find((s) => s.kind === state.stampKind)?.label ?? ""}`;

  return (
    <>
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={state.mode === "stamp"}
              onPressedChange={(pressed) => tool.setMode(pressed ? "stamp" : "none")}
              aria-label={voteMode ? "Vote" : "Stamp"}
              disabled={disabled || !store}
              className={voteMode ? "gap-1 px-2" : undefined}
            >
              {voteMode ? (
                <>
                  <IconCircleCheck size={16} />
                  <span className="text-xs tabular-nums">{left}</span>
                </>
              ) : (
                <span className="text-base leading-none" aria-hidden="true">
                  {stampGlyph(state.stampKind)}
                </span>
              )}
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>
            {voteMode
              ? `${stampLabel} — click an object to vote, click your dot to take it back`
              : `${stampLabel} — click an object to stamp it, click your stamp to remove it`}
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-5 px-0"
              aria-label="Stamps and voting"
              disabled={disabled || !store}
            >
              <IconChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={state.stampKind}
              onValueChange={(value) => {
                tool.setStampKind(value as BoardStampKind);
                tool.setMode("stamp");
              }}
            >
              {STAMP_KINDS.map((s) => (
                <DropdownMenuRadioItem key={s.kind} value={s.kind}>
                  <span className="mr-2" aria-hidden="true">
                    {s.glyph}
                  </span>
                  {s.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={voting?.status === "active"}
              onSelect={() => setStartOpen(true)}
            >
              <IconThumbUp size={14} className="mr-2" />
              Start voting…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={state.mode === "comment"}
            onPressedChange={(pressed) => tool.setMode(pressed ? "comment" : "none")}
            aria-label="Comment"
            disabled={disabled}
          >
            <IconMessagePlus size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Comment (Mod+Alt+M) — click to drop a pin</TooltipContent>
      </Tooltip>
      {store && (
        <StartVotingDialog
          open={startOpen}
          onOpenChange={setStartOpen}
          onStart={(input) => {
            writeStartVoting(
              store,
              createVoting({
                id: Math.random().toString(36).slice(2, 10),
                prompt: input.prompt,
                perPerson: input.perPerson,
                onlyStickies: input.onlyStickies,
                userKey: user.key,
                userName: user.name,
              }),
            );
            tool.beginVoting();
            tool.setMode("stamp");
            setStartOpen(false);
          }}
        />
      )}
    </>
  );
}

function StartVotingDialog({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (input: { prompt: string; perPerson: number; onlyStickies: boolean }) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [perPerson, setPerPerson] = useState("3");
  const [onlyStickies, setOnlyStickies] = useState(true);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onStart({
              prompt,
              perPerson: clampVotesPerPerson(Number(perPerson)),
              onlyStickies,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Start voting</DialogTitle>
            <DialogDescription>
              Everyone with edit access gets the same number of votes. Votes
              stay hidden until you end the session. They are hidden in the
              app only: anyone attached to the board can read them from the
              document data.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="board-vote-prompt">What are we voting on?</Label>
              <Input
                id="board-vote-prompt"
                value={prompt}
                placeholder="e.g. Which idea should we build first?"
                onChange={(e) => setPrompt(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="board-vote-count">Votes per person</Label>
              <Input
                id="board-vote-count"
                type="number"
                min={MIN_VOTES_PER_PERSON}
                max={MAX_VOTES_PER_PERSON}
                value={perPerson}
                onChange={(e) => setPerPerson(e.target.value)}
                className="w-24"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={onlyStickies}
                onCheckedChange={(v) => setOnlyStickies(v === true)}
              />
              Only sticky notes
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Start</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
