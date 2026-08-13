/**
 * The undo/redo spine.
 *
 * A `/commit` applies a batch as ONE undo unit and records every file it changed,
 * keeping both the pristine `before` and the written `after`. Undo writes `before`
 * back; redo writes `after`.
 *
 * Stacks live in memory for the dev-server process lifetime, deliberately NOT
 * persisted: a stale on-disk stack would be a corruption hazard — it would offer to
 * "undo" a change to a file that has since moved on, overwriting work with bytes
 * from a previous session. The `.bak` files remain the separate, coarser
 * session-pristine escape hatch, and git is the real one.
 */

import type { FileCheckpoint, Transaction } from './protocol';
import type { PathGuard } from './paths';
import type { Tracker } from './tracked';

export interface TransactionStore {
  record(labels: string[], files: FileCheckpoint[]): Transaction;
  /** Write every `before` back. Moves the transaction to the redo stack. */
  undo(): Promise<{ txn: Transaction; files: string[] } | { error: string }>;
  /** Write every `after` again. Moves it back to the undo stack. */
  redo(): Promise<{ txn: Transaction; files: string[] } | { error: string }>;
  summary(): { undo: TransactionSummary[]; redo: TransactionSummary[] };
}

export interface TransactionSummary {
  id: number;
  ts: number;
  labels: string[];
  files: string[];
}

const summarize = (t: Transaction): TransactionSummary => ({
  id: t.id,
  ts: t.ts,
  labels: t.labels,
  files: t.files.map((f) => f.path),
});

export function createTransactionStore(
  guard: PathGuard,
  tracker: Tracker,
  now: () => number = Date.now,
): TransactionStore {
  const undoStack: Transaction[] = [];
  const redoStack: Transaction[] = [];
  let counter = 0;

  /**
   * Restore one side of a transaction.
   *
   * Paths are re-resolved through the guard rather than trusted from the stored
   * checkpoint. The stack is in-process and its paths came from `resolveSafe`
   * originally, so this is defence in depth — but a restore writes files without
   * any further validation of their CONTENT, so it is the one place where a bad
   * path would be maximally damaging.
   */
  // Annotated rather than inferred: TS infers the two branches as a union that
  // carries `error?: undefined` on the success member, and `'error' in r` then
  // narrows nothing — the callers' `return r` would widen back to both shapes.
  const restore = async (
    txn: Transaction,
    side: 'before' | 'after',
  ): Promise<{ error: string } | { files: string[] }> => {
    // Resolve EVERY path before writing any. Resolving inside the write loop meant
    // a refusal on the third file left the first two restored — a transaction half
    // undone, which is worse than not undone: neither stack now describes the tree.
    const targets: { abs: string; text: string; rel: string }[] = [];
    for (const f of txn.files) {
      const r = guard.resolveSafe(f.path);
      if ('error' in r) return { error: `${f.path}: ${r.error}` };
      targets.push({ abs: r.abs, text: f[side], rel: f.path });
    }

    const written: string[] = [];
    for (const t of targets) {
      try {
        await tracker.write(t.abs, t.text);
      } catch (err) {
        // A write that fails mid-way cannot be rolled back — the earlier files are
        // already on disk. Report which ones landed so the caller can say so, rather
        // than claiming the whole restore failed when half of it succeeded.
        return {
          error:
            `${t.rel}: ${String(err)}` +
            (written.length ? ` (already restored: ${written.join(', ')})` : ''),
        };
      }
      written.push(t.rel);
    }
    return { files: written };
  };

  return {
    record(labels, files) {
      const txn: Transaction = { id: ++counter, ts: now(), labels, files };
      undoStack.push(txn);
      // A new commit invalidates the redo branch: redoing after it would write
      // bytes computed against a tree that no longer exists.
      redoStack.length = 0;
      return txn;
    },

    async undo() {
      const txn = undoStack.pop();
      if (!txn) return { error: 'nothing to undo' };
      const r = await restore(txn, 'before');
      if ('error' in r) {
        // Put it back: a failed undo must not silently consume the entry, or the
        // change becomes unreachable from both stacks.
        undoStack.push(txn);
        return r;
      }
      redoStack.push(txn);
      return { txn, files: r.files };
    },

    async redo() {
      const txn = redoStack.pop();
      if (!txn) return { error: 'nothing to redo' };
      const r = await restore(txn, 'after');
      if ('error' in r) {
        redoStack.push(txn);
        return r;
      }
      undoStack.push(txn);
      return { txn, files: r.files };
    },

    summary: () => ({
      // Most recent first, which is the order the client's history list renders.
      undo: [...undoStack].reverse().map(summarize),
      redo: [...redoStack].reverse().map(summarize),
    }),
  };
}
