import {
  IconMessagePlus,
  IconCircleCheck,
} from "@tabler/icons-react";

import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import type { YorkieBoardStore } from "../yorkie-board-store";
import { useBoardCollab } from "./board-collab-hook";
import { useRitualToolState } from "./use-ritual-tool-state";
import { STAMP_KINDS } from "./stamps";
import { StampBadge, StampGlyph } from "./stamp-badge";
import { SplitToolChevron } from "../board-split-tool-button";
import type { BoardStampKind } from "./types";
import { useBoardVoting } from "./use-board-voting";
import { canVote, votesLeft } from "./voting";

/**
 * Toolbar block for the rituals: the Stamp tool (a Vote tool while a
 * session is open for you), its stamp-kind menu, and the Comment tool.
 * Starting a vote is a facilitation act, so it lives in the top bar's
 * Facilitate group (`BoardVoteControl`), not under the stamps. Renders
 * nothing without a `BoardCollabProvider` (the share-link route) or a
 * signed-in user.
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
              ) : state.mode === "stamp" ? (
                // Armed: the coloured sticker a click will place.
                <StampBadge kind={state.stampKind} />
              ) : (
                // Idle: a monochrome glyph, so the dock's one chromatic
                // signal stays syrup (DESIGN.md, The One Accent Rule).
                <StampGlyph kind={state.stampKind} />
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
          <SplitToolChevron label="Stamps" disabled={disabled || !store} />
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
                  <StampBadge kind={s.kind} size={16} />
                  <span className="ml-2">{s.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
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
    </>
  );
}
