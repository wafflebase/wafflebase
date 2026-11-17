import { Button } from "@/components/ui/button";
import type { RitualStore } from "./ritual-writes";
import {
  writeClearVoting,
  writeDone,
  writeEndVoting,
} from "./ritual-writes";
import type { BoardVoting } from "./types";
import {
  canEndVoting,
  participation,
  votesLeft,
  type TallyRow,
} from "./voting";

/** How many ranked rows the results card lists. */
const RESULT_ROWS = 10;

/**
 * The floating voting card over the canvas.
 *
 * Open session: the prompt, your votes left, Done, and (facilitator only)
 * End voting. Others' votes are never painted while it is open — the
 * canvas shows your own dots only. Ended: a ranked list with zoom-to, and
 * Clear results. A read-only viewer sees the status and the results but
 * no controls.
 */
export function BoardVotingPanel({
  store,
  voting,
  tally,
  userKey,
  readOnly,
  labelFor,
  onFocusElement,
}: {
  store: RitualStore;
  voting: BoardVoting;
  tally: TallyRow[];
  userKey: string | null;
  readOnly: boolean;
  labelFor: (elementId: string) => string;
  onFocusElement: (elementId: string) => void;
}) {
  const canAct = !readOnly && userKey !== null;
  const prompt = voting.prompt || "Vote";
  const { voters, done } = participation(voting);

  if (voting.status === "active") {
    const mine = userKey ? votesLeft(voting, userKey) : 0;
    const isDone = userKey ? voting.done?.[userKey] === true : false;
    return (
      <section
        aria-label="Voting"
        className="absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background px-3 py-2 text-sm shadow-md"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="font-medium">{prompt}</span>
        {canAct && !isDone && (
          <span className="tabular-nums text-muted-foreground">
            {mine} of {voting.perPerson} votes left
          </span>
        )}
        {canAct && isDone && (
          <span className="text-muted-foreground">You're done</span>
        )}
        <span className="text-xs text-muted-foreground">
          {voters} voting · {done} done
        </span>
        {canAct && userKey && (
          <Button
            size="sm"
            variant={isDone ? "ghost" : "outline"}
            className="h-7"
            onClick={() => writeDone(store, voting.id, userKey, !isDone)}
          >
            {isDone ? "Change my votes" : "Done"}
          </Button>
        )}
        {canAct && userKey && canEndVoting(voting, userKey) && (
          <Button
            size="sm"
            className="h-7"
            onClick={() => writeEndVoting(store, voting.id)}
          >
            End voting
          </Button>
        )}
        {!canAct && (
          <span className="text-xs text-muted-foreground">
            Voting in progress, run by {voting.startedByName}
          </span>
        )}
      </section>
    );
  }

  return (
    // Below the top-right row (Download button, find box), not over it.
    <section
      aria-label="Voting results"
      className="absolute right-3 top-12 z-20 flex max-h-[60%] w-72 max-w-[calc(100%-1.5rem)] flex-col rounded-lg border bg-background shadow-md"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Results: {prompt}</h2>
          <p className="text-xs text-muted-foreground">
            {voters} {voters === 1 ? "person" : "people"} voted
          </p>
        </div>
      </header>
      {tally.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          No votes were cast.
        </p>
      ) : (
        <ol className="overflow-y-auto py-1">
          {tally.slice(0, RESULT_ROWS).map((row, i) => (
            <li key={row.elementId}>
              <button
                type="button"
                className="focus-ring flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/60"
                onClick={() => onFocusElement(row.elementId)}
              >
                <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate">{labelFor(row.elementId)}</span>
                <span className="shrink-0 rounded-full bg-primary px-2 text-xs font-semibold tabular-nums text-primary-foreground">
                  {row.votes}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {canAct && (
        <footer className="border-t px-3 py-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full"
            onClick={() => writeClearVoting(store, voting.id)}
          >
            Clear results
          </Button>
        </footer>
      )}
    </section>
  );
}
