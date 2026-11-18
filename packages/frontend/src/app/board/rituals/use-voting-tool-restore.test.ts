import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createRitualTool } from "./ritual-tool";
import type { BoardVoting } from "./types";
import { useVotingToolRestore } from "./use-voting-tool-restore";

const session = (status: BoardVoting["status"], id = "v1"): BoardVoting => ({
  id,
  prompt: "",
  perPerson: 3,
  onlyStickies: true,
  startedBy: "u1",
  startedByName: "A",
  status,
  ballots: {},
  done: {},
});

function mount(tool = createRitualTool()) {
  const hook = renderHook(
    ({ voting }: { voting: BoardVoting | null }) => useVotingToolRestore(voting, tool),
    { initialProps: { voting: null as BoardVoting | null } },
  );
  return { tool, rerender: (voting: BoardVoting | null) => hook.rerender({ voting }) };
}

describe("useVotingToolRestore", () => {
  it("disarms the stamp the facilitator's start armed once the vote ends", () => {
    const { tool, rerender } = mount();
    // Start voting (board-ritual-controls' onStart), then the session lands.
    tool.beginVoting();
    tool.setMode("stamp");
    rerender(session("active"));
    expect(tool.get().mode).toBe("stamp");

    rerender(session("ended"));
    expect(tool.get().mode).toBe("none");
  });

  it("restores a participant's pre-vote tool when a peer ends the vote", () => {
    const { tool, rerender } = mount();
    tool.setMode("comment");
    rerender(session("active"));
    tool.setMode("stamp"); // arms the stamp to vote
    rerender(null); // the facilitator ended and cleared it remotely
    expect(tool.get().mode).toBe("comment");
  });

  it("leaves a tool picked during the vote alone", () => {
    const { tool, rerender } = mount();
    tool.beginVoting();
    tool.setMode("stamp");
    rerender(session("active"));
    tool.setMode("comment");
    rerender(session("ended"));
    expect(tool.get().mode).toBe("comment");
  });

  it("treats each session on its own", () => {
    const { tool, rerender } = mount();
    rerender(session("active", "v1"));
    tool.setMode("stamp");
    rerender(session("ended", "v1"));
    expect(tool.get().mode).toBe("none");
    tool.setMode("comment");
    rerender(session("active", "v2"));
    tool.setMode("stamp");
    rerender(session("ended", "v2"));
    expect(tool.get().mode).toBe("comment");
  });
});
