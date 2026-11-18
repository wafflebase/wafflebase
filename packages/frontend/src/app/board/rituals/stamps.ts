import type { BoardStamp, BoardStampKind, BoardStamps } from "./types";

/** Toolbar order, with each kind's label. How each is drawn: `stamp-art.ts`. */
export const STAMP_KINDS: ReadonlyArray<{
  kind: BoardStampKind;
  label: string;
}> = [
  { kind: "plus1", label: "+1" },
  { kind: "heart", label: "Heart" },
  { kind: "star", label: "Star" },
  { kind: "question", label: "Question" },
  { kind: "check", label: "Check" },
  { kind: "cross", label: "Cross" },
];

export function stampLabel(kind: BoardStampKind): string {
  return STAMP_KINDS.find((s) => s.kind === kind)?.label ?? kind;
}

export function isStampKind(value: unknown): value is BoardStampKind {
  return STAMP_KINDS.some((s) => s.kind === value);
}

/**
 * The flat-map key for one stamp. Yorkie refuses `.` in an object key, so
 * any that sneak into an id are replaced; `~` separates the parts (element
 * ids and user keys never contain it, and the parts are never parsed back
 * — the stamp's own `el` / `by` fields are the source of truth).
 */
export function stampKey(elementId: string, userKey: string, nonce: string): string {
  return `${elementId}~${userKey}~${nonce}`.replace(/\./g, "_");
}

/** What a click with the stamp tool should write. */
export type StampEdit =
  | { op: "add"; key: string; stamp: BoardStamp }
  | { op: "remove"; key: string };

/**
 * Decide the write for a stamp-tool click.
 *
 * `hitOwnKey` is the key of one of the CLICKING user's stamps under the
 * pointer, if any (the layer hit-tests in screen space). Clicking your own
 * stamp removes it — someone else's stamp is never removable, it is just
 * stamped on top of. Otherwise a click on an element adds a stamp; a click
 * on empty canvas does nothing.
 */
export function planStampClick(input: {
  stamps: BoardStamps;
  hitOwnKey: string | null;
  elementId: string | null;
  userKey: string;
  userName: string;
  kind: BoardStampKind;
  u: number;
  v: number;
  now: number;
  nonce: string;
}): StampEdit | null {
  if (input.hitOwnKey) {
    const own = input.stamps[input.hitOwnKey];
    if (own && own.by === input.userKey) {
      return { op: "remove", key: input.hitOwnKey };
    }
  }
  if (!input.elementId) return null;
  return {
    op: "add",
    key: stampKey(input.elementId, input.userKey, input.nonce),
    stamp: {
      el: input.elementId,
      by: input.userKey,
      name: input.userName,
      kind: input.kind,
      u: input.u,
      v: input.v,
      at: input.now,
    },
  };
}

/** Apply a {@link StampEdit} to a plain map (and, via the same calls, to a Yorkie proxy). */
export function applyStampEdit(stamps: BoardStamps, edit: StampEdit): void {
  if (edit.op === "add") stamps[edit.key] = edit.stamp;
  else delete stamps[edit.key];
}

/**
 * Keys of stamps sitting on any of `removedIds` — what to drop when those
 * elements are deleted, so the map does not accumulate orphans.
 */
export function stampKeysForElements(
  stamps: BoardStamps | undefined,
  removedIds: ReadonlySet<string>,
): string[] {
  if (!stamps) return [];
  const keys: string[] = [];
  for (const [key, stamp] of Object.entries(stamps)) {
    if (stamp && removedIds.has(stamp.el)) keys.push(key);
  }
  return keys;
}

/**
 * Whether a stamp read from the CRDT has the shape the overlay draws. Any
 * collaborator can write `root.stamps`, so a kind this client does not know
 * (a newer client's, or a crafted one) or a non-string owner would otherwise
 * reach code that indexes the stamp art by kind every frame.
 */
function isDrawableStamp(stamp: BoardStamp | undefined): stamp is BoardStamp {
  return (
    !!stamp &&
    isStampKind(stamp.kind) &&
    typeof stamp.by === "string" &&
    typeof stamp.name === "string" &&
    Number.isFinite(stamp.u) &&
    Number.isFinite(stamp.v)
  );
}

/**
 * Stamps grouped by element, restricted to elements that still exist at
 * the top level. An orphan (its element deleted by an undo, or by a client
 * that predates the cleanup) is simply not drawn — garbage collection on
 * read, so a missed cleanup can never paint a stamp in mid-air. A stamp
 * that fails {@link isDrawableStamp} is skipped the same way.
 */
export function stampsByElement(
  stamps: BoardStamps | undefined,
  liveIds: ReadonlySet<string>,
): Map<string, Array<{ key: string; stamp: BoardStamp }>> {
  const out = new Map<string, Array<{ key: string; stamp: BoardStamp }>>();
  if (!stamps) return out;
  for (const [key, stamp] of Object.entries(stamps)) {
    if (!isDrawableStamp(stamp) || !liveIds.has(stamp.el)) continue;
    let list = out.get(stamp.el);
    if (!list) {
      list = [];
      out.set(stamp.el, list);
    }
    list.push({ key, stamp });
  }
  for (const list of out.values()) list.sort((a, b) => a.stamp.at - b.stamp.at);
  return out;
}

/** "+1: alice, bob · Heart: carol" — who stamped what, for the hover card. */
export function describeStamps(list: ReadonlyArray<{ stamp: BoardStamp }>): string {
  const byKind = new Map<BoardStampKind, string[]>();
  for (const { stamp } of list) {
    const names = byKind.get(stamp.kind) ?? [];
    if (!names.includes(stamp.name)) names.push(stamp.name);
    byKind.set(stamp.kind, names);
  }
  return [...byKind.entries()]
    .map(([kind, names]) => `${stampLabel(kind)}: ${names.join(", ")}`)
    .join(" · ");
}
