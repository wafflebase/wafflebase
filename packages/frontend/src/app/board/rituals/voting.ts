import type { BoardVoting } from "./types";

export const MIN_VOTES_PER_PERSON = 1;
export const MAX_VOTES_PER_PERSON = 10;

export function clampVotesPerPerson(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.min(MAX_VOTES_PER_PERSON, Math.max(MIN_VOTES_PER_PERSON, Math.round(n)));
}

export function createVoting(input: {
  id: string;
  prompt: string;
  perPerson: number;
  onlyStickies: boolean;
  userKey: string;
  userName: string;
}): BoardVoting {
  return {
    id: input.id,
    prompt: input.prompt.trim(),
    perPerson: clampVotesPerPerson(input.perPerson),
    onlyStickies: input.onlyStickies,
    startedBy: input.userKey,
    startedByName: input.userName,
    status: "active",
    ballots: {},
    done: {},
  };
}

/** The user's own ballot (a copy). */
export function ballotOf(voting: BoardVoting | undefined, userKey: string): string[] {
  const ballot = voting?.ballots?.[userKey];
  return ballot ? Array.from(ballot) : [];
}

export function votesLeft(voting: BoardVoting | undefined, userKey: string): number {
  if (!voting) return 0;
  return Math.max(0, voting.perPerson - ballotOf(voting, userKey).length);
}

/**
 * Whether this user may cast votes right now: the session is open and
 * they have not pressed Done. A read-only (viewer) mount never gets here —
 * it has no vote tool — but the gate is repeated by the caller.
 */
export function canVote(voting: BoardVoting | undefined, userKey: string): boolean {
  return voting?.status === "active" && !voting.done?.[userKey];
}

/**
 * The user's ballot after a vote on `elementId`, or `null` when the vote
 * is refused: no open session, already done, out of votes, or (with
 * "only stickies") the element is not a sticky.
 */
export function castVote(
  voting: BoardVoting | undefined,
  userKey: string,
  elementId: string,
  isSticky: boolean,
): string[] | null {
  if (!voting || !canVote(voting, userKey)) return null;
  if (voting.onlyStickies && !isSticky) return null;
  const ballot = ballotOf(voting, userKey);
  if (ballot.length >= voting.perPerson) return null;
  return [...ballot, elementId];
}

/** The ballot with ONE vote on `elementId` taken back, or `null` if there is none. */
export function retractVote(
  voting: BoardVoting | undefined,
  userKey: string,
  elementId: string,
): string[] | null {
  if (!voting || !canVote(voting, userKey)) return null;
  const ballot = ballotOf(voting, userKey);
  const i = ballot.lastIndexOf(elementId);
  if (i < 0) return null;
  ballot.splice(i, 1);
  return ballot;
}

export interface TallyRow {
  elementId: string;
  votes: number;
}

/**
 * Votes per element, highest first (ties broken by element id so every
 * client ranks identically). Votes on elements that no longer exist are
 * dropped when `liveIds` is given — a deleted sticky cannot win.
 */
export function tallyVotes(
  voting: BoardVoting | undefined,
  liveIds?: ReadonlySet<string>,
): TallyRow[] {
  if (!voting) return [];
  const counts = new Map<string, number>();
  for (const ballot of Object.values(voting.ballots ?? {})) {
    if (!ballot) continue;
    for (const id of Array.from(ballot)) {
      if (liveIds && !liveIds.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([elementId, votes]) => ({ elementId, votes }))
    .sort((a, b) => b.votes - a.votes || a.elementId.localeCompare(b.elementId));
}

/** How many participants have cast at least one vote, and how many pressed Done. */
export function participation(voting: BoardVoting | undefined): {
  voters: number;
  done: number;
} {
  if (!voting) return { voters: 0, done: 0 };
  const voters = Object.values(voting.ballots ?? {}).filter(
    (b) => b && Array.from(b).length > 0,
  ).length;
  const done = Object.values(voting.done ?? {}).filter(Boolean).length;
  return { voters, done };
}

/** Only the facilitator ends an open session. */
export function canEndVoting(voting: BoardVoting | undefined, userKey: string): boolean {
  return voting?.status === "active" && voting.startedBy === userKey;
}
