import { describe, expect, it } from "vitest";
import {
  canEndVoting,
  canVote,
  castVote,
  clampVotesPerPerson,
  createVoting,
  participation,
  retractVote,
  tallyVotes,
  votesLeft,
} from "./voting";
import type { BoardVoting } from "./types";

function session(over: Partial<BoardVoting> = {}): BoardVoting {
  return {
    ...createVoting({
      id: "s1",
      prompt: "  Pick one  ",
      perPerson: 2,
      onlyStickies: false,
      userKey: "u1",
      userName: "alice",
    }),
    ...over,
  };
}

describe("createVoting", () => {
  it("trims the prompt and clamps votes per person to 1..10", () => {
    expect(session().prompt).toBe("Pick one");
    expect(clampVotesPerPerson(0)).toBe(1);
    expect(clampVotesPerPerson(99)).toBe(10);
    expect(clampVotesPerPerson(Number.NaN)).toBe(3);
  });
});

describe("castVote", () => {
  it("adds votes up to the per-person limit, repeats allowed", () => {
    let v = session();
    const first = castVote(v, "u2", "e1", false)!;
    v = { ...v, ballots: { u2: first } };
    const second = castVote(v, "u2", "e1", false)!;
    expect(second).toEqual(["e1", "e1"]);
    v = { ...v, ballots: { u2: second } };
    expect(votesLeft(v, "u2")).toBe(0);
    expect(castVote(v, "u2", "e2", false)).toBeNull();
  });

  it("refuses non-stickies in an only-stickies session", () => {
    const v = session({ onlyStickies: true });
    expect(castVote(v, "u2", "e1", false)).toBeNull();
    expect(castVote(v, "u2", "e1", true)).toEqual(["e1"]);
  });

  it("refuses after Done and after the session ends", () => {
    expect(castVote(session({ done: { u2: true } }), "u2", "e1", false)).toBeNull();
    expect(canVote(session({ status: "ended" }), "u2")).toBe(false);
    expect(castVote(undefined, "u2", "e1", false)).toBeNull();
  });
});

describe("retractVote", () => {
  it("takes back one vote on that element", () => {
    const v = session({ ballots: { u2: ["e1", "e2", "e1"] } });
    expect(retractVote(v, "u2", "e1")).toEqual(["e1", "e2"]);
    expect(retractVote(v, "u2", "e9")).toBeNull();
  });
});

describe("tallyVotes", () => {
  const v = session({
    status: "ended",
    ballots: { u1: ["b", "a"], u2: ["a", "a"], u3: ["c", "gone"] },
  });

  it("ranks by count, ties by id, so every client agrees", () => {
    expect(tallyVotes(v)).toEqual([
      { elementId: "a", votes: 3 },
      { elementId: "b", votes: 1 },
      { elementId: "c", votes: 1 },
      { elementId: "gone", votes: 1 },
    ]);
  });

  it("drops votes on deleted elements", () => {
    expect(tallyVotes(v, new Set(["a", "b", "c"])).map((r) => r.elementId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("counts participation", () => {
    expect(participation(session({ ballots: { u1: ["a"], u2: [] }, done: { u1: true } }))).toEqual({
      voters: 1,
      done: 1,
    });
  });
});

describe("canEndVoting", () => {
  it("is the facilitator's alone, and only while open", () => {
    expect(canEndVoting(session(), "u1")).toBe(true);
    expect(canEndVoting(session(), "u2")).toBe(false);
    expect(canEndVoting(session({ status: "ended" }), "u1")).toBe(false);
  });
});
