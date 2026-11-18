/**
 * Remove every element of a Yorkie array proxy whose `id` is in `ids`, in
 * ONE change, so that the change's native undo survives garbage collection.
 *
 * The order matters. Yorkie records each array delete's undo as "re-insert
 * after the previous LIVE element", and while replaying an undo it re-issues
 * the re-inserted element's createdAt and reconciles only the OTHER history
 * entries, not the remaining ops of the entry being replayed. Deleting
 * back-to-front makes each delete's anchor the next element to be deleted
 * (still live at that moment), so the undo of a run of adjacent elements
 * re-inserts one after the old createdAt of another. That createdAt only
 * resolves while its tombstone exists; once the document syncs and GC purges
 * it, the undo throws `cant find the given node` and is lost.
 *
 * Deleting front-to-back anchors every delete on an element that this change
 * leaves alone (or the array head): the deletes before it have already
 * tombstoned their own nodes, and the anchor lookup skips tombstones. The
 * replay then inserts each element after that surviving neighbour, and the
 * RGA rule (newer insert goes first) restores the original order.
 */
export function removeIdsFromYorkieArray(
  array: ArrayLike<{ id: string }>,
  ids: ReadonlySet<string>,
): void {
  const spliceable = array as unknown as { splice(i: number, d: number): void };
  let i = 0;
  while (i < array.length) {
    if (ids.has(array[i].id)) {
      spliceable.splice(i, 1);
    } else {
      i++;
    }
  }
}
