/**
 * Board collaboration rituals — stamps, dot voting and board comments.
 * The CRDT shapes live here so `types/board-document.ts` (a hub file
 * shared by many branches) only gains three optional fields.
 *
 * All three are ADDITIVE root keys: a board without them loads and works,
 * and a viewer that attaches with `{}` never writes them.
 */

/** The six FigJam-style stamps. */
export type BoardStampKind =
  | "plus1"
  | "heart"
  | "star"
  | "question"
  | "check"
  | "cross";

/**
 * One stamp on one element.
 *
 * `u`/`v` locate it as a fraction of the element's frame (0..1 on each
 * axis, in the element's own unrotated box), so it moves, scales and
 * rotates with the element instead of being left behind at a world point.
 */
export interface BoardStamp {
  /** The top-level element the stamp sits on. */
  el: string;
  /** Stable per-user key (`u<userId>`). Owner of the stamp. */
  by: string;
  /** Display name at the time of stamping, for the hover card. */
  name: string;
  kind: BoardStampKind;
  u: number;
  v: number;
  /** Unix ms. Stored as a Yorkie Long (see `toYorkieMs`). */
  at: number;
}

/**
 * `root.stamps` — a FLAT map keyed `<elementId>~<userKey>~<nonce>`.
 *
 * Flat rather than `stamps[elementId][userKey]`: nested containers would
 * have to be created on the first stamp, and two users stamping the same
 * fresh element concurrently would each create the inner object — Yorkie
 * resolves a same-key object assignment by LWW, so one stamp would vanish.
 * In a flat map every stamp is its own key, so concurrent stamps never
 * touch the same key. The map itself is seeded by `initialBoardRoot()`.
 */
export type BoardStamps = { [key: string]: BoardStamp };

/** `root.voting` — one dot-voting session, or absent. */
export interface BoardVoting {
  id: string;
  prompt: string;
  /** Votes each participant may cast, 1..10. */
  perPerson: number;
  /** When true, only sticky notes accept votes. */
  onlyStickies: boolean;
  /** Facilitator's user key; only they can end the session. */
  startedBy: string;
  startedByName: string;
  status: "active" | "ended";
  /**
   * Each participant's votes as element ids (repeats allowed — two votes
   * on one sticky is two entries). Each key is written by its own user
   * only, so ballots never conflict.
   *
   * HIDDEN IN THE UI ONLY: the CRDT is readable by every client attached
   * to the board, so a determined participant can read others' ballots
   * from devtools while the vote is open. The board renders only your own
   * votes until the facilitator ends the session.
   */
  ballots: { [userKey: string]: string[] };
  /** Participants who pressed "Done". */
  done: { [userKey: string]: boolean };
}

export type { BoardAnchor } from "@/types/comments";
