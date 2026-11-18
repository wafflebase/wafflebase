import type { BoardCollabUser } from "./board-collab-hook";
import type { RitualTool } from "./ritual-tool";
import { writeStartVoting, type RitualStore } from "./ritual-writes";
import { createVoting } from "./voting";

export interface StartVotingInput {
  prompt: string;
  perPerson: number;
  onlyStickies: boolean;
}

/**
 * Open a session and hand the starter the vote tool. `beginVoting` first,
 * so ending the vote gives back the tool that was in hand before it.
 */
export function startVoting(
  store: RitualStore,
  tool: RitualTool,
  user: BoardCollabUser,
  input: StartVotingInput,
): void {
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
}
