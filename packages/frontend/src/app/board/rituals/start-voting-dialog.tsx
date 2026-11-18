import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StartVotingInput } from "./start-voting";
import {
  MAX_VOTES_PER_PERSON,
  MIN_VOTES_PER_PERSON,
  clampVotesPerPerson,
} from "./voting";

/** The "Start voting" form: prompt, votes per person, only stickies. */
export function StartVotingDialog({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (input: StartVotingInput) => void;
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
