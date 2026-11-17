import type { YorkieBoardRoot } from "@/types/board-document";
import { toYorkieMs } from "./board-comment-store";
import type { StampEdit } from "./stamps";
import type { BoardVoting } from "./types";

/** The slice of `YorkieBoardStore` the ritual writes need. */
export interface RitualStore {
  batch(fn: () => void): void;
  updateRituals(fn: (root: YorkieBoardRoot) => void): void;
}

/**
 * Every ritual write is one `store.batch` — one Yorkie change and one undo
 * unit — through `updateRituals`, never a raw `doc.update`, so it can run
 * from a selection or insert callback that already sits inside a batch.
 */
function write(store: RitualStore, fn: (root: YorkieBoardRoot) => void): void {
  store.batch(() => store.updateRituals(fn));
}

export function writeStampEdit(store: RitualStore, edit: StampEdit): void {
  write(store, (r) => {
    if (edit.op === "add") {
      // Seeded by `initialBoardRoot`; guarded for a board attached before.
      if (!r.stamps) r.stamps = {};
      r.stamps[edit.key] = { ...edit.stamp, at: toYorkieMs(edit.stamp.at) };
    } else if (r.stamps) {
      delete r.stamps[edit.key];
    }
  });
}

/** Start a session, replacing any ended one (or a stale active one). */
export function writeStartVoting(store: RitualStore, voting: BoardVoting): void {
  write(store, (r) => {
    r.voting = { ...voting, ballots: {}, done: {} };
  });
}

/** Run `fn` on the live session only if it is still `sessionId`. */
function onSession(
  store: RitualStore,
  sessionId: string,
  fn: (voting: BoardVoting) => void,
): void {
  write(store, (r) => {
    const voting = r.voting;
    if (!voting || voting.id !== sessionId) return;
    fn(voting);
  });
}

export function writeBallot(
  store: RitualStore,
  sessionId: string,
  userKey: string,
  ballot: string[],
): void {
  onSession(store, sessionId, (v) => {
    if (v.status !== "active") return;
    if (!v.ballots) v.ballots = {};
    v.ballots[userKey] = ballot;
  });
}

export function writeDone(
  store: RitualStore,
  sessionId: string,
  userKey: string,
  done: boolean,
): void {
  onSession(store, sessionId, (v) => {
    if (v.status !== "active") return;
    if (!v.done) v.done = {};
    if (done) v.done[userKey] = true;
    else delete v.done[userKey];
  });
}

export function writeEndVoting(store: RitualStore, sessionId: string): void {
  onSession(store, sessionId, (v) => {
    v.status = "ended";
  });
}

export function writeClearVoting(store: RitualStore, sessionId: string): void {
  write(store, (r) => {
    if (r.voting?.id === sessionId) delete r.voting;
  });
}
