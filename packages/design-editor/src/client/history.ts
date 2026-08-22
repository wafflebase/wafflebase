import { useCallback, useEffect, useRef, useState } from 'react';
import { editStateKey, emptyEditState, type EditRef, type EditState } from './edits.ts';
import type { AnchorRebase } from './anchors.ts';

/**
 * Editor-level undo/redo for staged edits — the document model, not the file
 * model.
 *
 * WHY THIS EXISTS. The bridge already has a transaction log over *commits*
 * (`/commit` `/undo` `/redo`), and the header used to drive that. It is the wrong
 * altitude for an editor: it can only step between saves, so typing five tweaks
 * and pressing undo threw away all five. This hook is the missing layer — it
 * tracks the edits themselves, exactly like a text editor:
 *
 *   • every staged change pushes a snapshot (keystrokes coalesce, see below)
 *   • "Save to Code" is Ctrl+S: an explicit write, NOT a history entry
 *   • undo after a save steps back to the previous edit and the state goes DIRTY
 *     again, because `dirty` compares the present against `baseline` (what the
 *     last save actually wrote) rather than counting saves
 *
 * WHY SNAPSHOTS, NOT A COMMAND LOG. The whole edit state is a handful of small
 * plain-object maps, so a snapshot is cheap, trivially serialisable, and cannot
 * drift from an inverse-command implementation. It is also what makes
 * persistence a one-liner.
 *
 * LIFETIME. The stack is persisted in `localStorage` under the dev server's
 * `sessionId`. A page reload finds a matching id and restores; restarting the
 * dev server mints a new id and the stale stack is dropped. That is precisely
 * "survives reloads, resets when you shut the server down", and it keeps the
 * server itself stateless — a stack persisted server-side would outlive the
 * files it describes and become a corruption hazard.
 */

/**
 * Deliberately NOT the prototype's `design-sdk:…` key.
 *
 * A record written by the prototype describes a different `EditState` — its own
 * edit kinds, its own anchor shape — and `normalizeState` cannot tell "a field
 * this version added" from "a field that version meant differently". Reading it
 * would restore edits whose intents no longer mean what they say. A fresh key
 * drops that history instead, which is the honest outcome for a package rename.
 */
const STORAGE_KEY = 'design-editor:edit-history:v1';
/** Snapshots kept. Generous — a snapshot is a few KB of plain objects. */
const MAX_DEPTH = 200;
/** Keystrokes on the same control within this window collapse into one entry. */
const COALESCE_MS = 700;

interface HistoryShape {
  past: EditState[];
  present: EditState;
  future: EditState[];
  /** What the last successful save wrote to disk. `dirty` is measured off this. */
  baseline: EditState;
  /**
   * Previous baselines, newest last. Popped when a committed write is reverted
   * through the bridge's transaction log, so `baseline` keeps tracking disk.
   */
  baselineStack: EditState[];
}

interface Persisted extends HistoryShape {
  sessionId: string;
  savedAt: number;
}

const initialShape = (): HistoryShape => ({
  past: [],
  present: emptyEditState(),
  future: [],
  baseline: emptyEditState(),
  baselineStack: [],
});

/**
 * Fill in any `EditState` map the persisted record is missing.
 *
 * A STORED SNAPSHOT IS AN OLDER VERSION OF THE SCHEMA. `EditState` gains a map
 * as the editor gains an edit kind — `layoutEdits` arrived with the layout
 * intents — and a record written before that field existed rehydrates without
 * it. Everything downstream then treats it as an object: `editStateKey` calls
 * `Object.keys` on it during render (white-screening the whole editor) and
 * `saveDiff` calls `Object.entries` on it while building the write plan.
 *
 * The fix belongs HERE rather than at each call site, because the alternative is
 * a guard in every consumer and one of them will always be missed. Deriving the
 * shape from `emptyEditState()` also makes the next added map migrate itself.
 *
 * WHY NOT BUMP THE STORAGE KEY. That is the cheap fix and it silently throws the
 * user's staged edits away — the failure the "restore is optimistic, losing work
 * is worse" rule exists to avoid. Migrating keeps them.
 */
export function normalizeState(value: unknown): EditState {
  const base = emptyEditState();
  if (!value || typeof value !== 'object') return base;
  const stored = value as Record<string, unknown>;
  // The migration is deliberately key-agnostic — that is what makes the NEXT
  // added map migrate itself — so it writes through an index signature. Each
  // `EditState` field is a `Record<string, Pending*>`, and TypeScript cannot
  // narrow the value type from a `keyof` loop variable; the runtime shape check
  // below is the real guarantee.
  const out = base as unknown as Record<string, unknown>;
  for (const key of Object.keys(base)) {
    const map = stored[key];
    // Only adopt a real map. A null, an array, or a primitive from a corrupt
    // record must never become the value `Object.keys` is handed.
    if (map && typeof map === 'object' && !Array.isArray(map)) out[key] = map;
  }
  return base;
}

const normalizeStates = (list: unknown): EditState[] =>
  Array.isArray(list) ? list.map(normalizeState) : [];

function readPersisted(): Persisted | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Persisted;
    if (!d || typeof d.sessionId !== 'string' || !d.present) return null;
    // Migrate every snapshot, not just `present`: the undo/redo stacks and the
    // baseline stack are `EditState`s too, and stepping back into one of them
    // would hit the same throw a few keystrokes later.
    return {
      ...d,
      present: normalizeState(d.present),
      baseline: normalizeState(d.baseline),
      past: normalizeStates(d.past),
      future: normalizeStates(d.future),
      baselineStack: normalizeStates(d.baselineStack),
    };
  } catch {
    return null;
  }
}

function writePersisted(sessionId: string, shape: HistoryShape) {
  try {
    const payload: Persisted = { ...shape, sessionId, savedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota or a disabled store — history simply stops surviving reloads.
  }
}

function clearPersisted() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export interface EditHistory {
  /** The current staged edits. */
  state: EditState;
  /**
   * The snapshot the last successful save wrote to disk. `saveDiff(baseline,
   * state)` is the write plan; `dirty` is `baseline !== state`.
   */
  baseline: EditState;
  /**
   * Stage a change. `coalesceKey` collapses consecutive changes to the same
   * control (a colour input's keystrokes) into one undo step; pass a distinct
   * key — or none — for discrete actions.
   */
  update: (fn: (prev: EditState) => EditState, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
  /** Present differs from what was last written to disk. */
  dirty: boolean;
  /** Discard every staged edit (a normal, undoable history step). */
  clear: () => void;
  /**
   * Forget specific edits entirely — remove them from the present, the baseline,
   * AND the whole undo/redo stack.
   *
   * This is the recovery path for an edit that can no longer be applied because
   * its file changed outside the editor. Dropping from the present alone is not
   * enough: an edit still in `baseline` makes the next save try to REVERT it, and
   * that revert needs the same vanished text, so the editor would stay
   * permanently dirty with an unsatisfiable plan. Clearing the stacks too keeps
   * ⌘Z from resurrecting it.
   *
   * Deliberately NOT undoable — it discards information (the old value we could
   * have restored) that no longer describes the file on disk.
   */
  dropEdits: (refs: EditRef[]) => void;
  /**
   * Rewrite staged layout anchors' PATH HINTS after a metadata refresh.
   *
   * Load-bearing, not cosmetic: our own writes shift paths (a `layout-insert`
   * renumbers every following sibling), so without this the next save would fail
   * on every shifted edit. Like `dropEdits` it touches the present, the baseline
   * AND every stack snapshot — a coordinate has to be consistent everywhere or
   * ⌘Z would resurrect a stale one.
   *
   * Takes `planRebase`'s output whole, INCLUDING the `lost` entries, and skips
   * them itself. The prototype declared its own narrower parameter type, which
   * made filtering the caller's job on a list where a missed filter writes
   * `path: undefined` into a live anchor.
   *
   * Also like `dropEdits`, deliberately NOT undoable: a coordinate correction is
   * not an edit. And it must not flip `dirty`, which is why `editStateKey`
   * excludes `path`/`fpx` (see `HINT_KEYS`).
   */
  rebaseAnchors: (rebases: AnchorRebase[]) => void;
  /** Record that `state` is now on disk (called after a successful commit). */
  markSaved: () => void;
  /** A committed write was reverted on disk — step `baseline` back with it. */
  rollbackBaseline: () => void;
  /** Whether a persisted history was restored on mount (for the status line). */
  restored: boolean;
}

/**
 * @param sessionId The dev server's process id from `/health`, or null while the
 *   bridge has not answered yet. Persistence starts once it is known; a change of
 *   id (server restarted) resets the history and reports `false` from `onReset`.
 */
export function useEditHistory(sessionId: string | null, onReset?: () => void): EditHistory {
  // Hydrate SYNCHRONOUSLY during the first render, not in an effect. An effect
  // would run in the same commit as the persist effect below, which would then
  // write the still-empty state over the stored record before the restore landed.
  // Reading `localStorage` here is a pure read, guarded to happen exactly once.
  const pendingRef = useRef<Persisted | null | undefined>(undefined);
  if (pendingRef.current === undefined) pendingRef.current = readPersisted();

  // Restore optimistically: with the bridge down there is nothing to validate
  // against, and losing the user's work would be the worse failure. The reconcile
  // effect below drops it if the server turns out to be a new process.
  const [shape, setShape] = useState<HistoryShape>(() => {
    const p = pendingRef.current;
    return p
      ? {
          past: p.past ?? [],
          present: p.present,
          future: p.future ?? [],
          baseline: p.baseline ?? emptyEditState(),
          baselineStack: p.baselineStack ?? [],
        }
      : initialShape();
  });
  const [restored, setRestored] = useState(() => !!pendingRef.current);
  const coalesceRef = useRef<{ key: string; at: number } | null>(null);
  const resetNotifyRef = useRef(onReset);
  resetNotifyRef.current = onReset;

  // Reconcile with the server's identity once it is known. A different id means
  // the dev server was restarted, so the stack describes files that may have
  // moved on — drop it rather than replay it.
  useEffect(() => {
    if (!sessionId) return;
    const p = pendingRef.current;
    if (p && p.sessionId !== sessionId) {
      pendingRef.current = null;
      clearPersisted();
      setShape(initialShape());
      setRestored(false);
      resetNotifyRef.current?.();
    }
  }, [sessionId]);

  // Persist on every change. Until the bridge answers we key on whatever session
  // the restored record carried (or `unknown`), so edits made while the bridge is
  // unreachable still survive a reload — the reconcile above throws them away if
  // the server turns out to be a different process.
  const keyedSession = sessionId ?? pendingRef.current?.sessionId ?? 'unknown';
  useEffect(() => {
    writePersisted(keyedSession, shape);
  }, [keyedSession, shape]);

  const update = useCallback((fn: (prev: EditState) => EditState, coalesceKey?: string) => {
    setShape((prev) => {
      const next = fn(prev.present);
      if (editStateKey(next) === editStateKey(prev.present)) return prev; // no-op
      const now = Date.now();
      const last = coalesceRef.current;
      const coalesce =
        !!coalesceKey &&
        !!last &&
        last.key === coalesceKey &&
        now - last.at < COALESCE_MS &&
        prev.past.length > 0;
      coalesceRef.current = coalesceKey ? { key: coalesceKey, at: now } : null;
      return {
        ...prev,
        past: coalesce ? prev.past : [...prev.past, prev.present].slice(-MAX_DEPTH),
        present: next,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    coalesceRef.current = null;
    setShape((prev) => {
      if (!prev.past.length) return prev;
      const past = prev.past.slice(0, -1);
      const present = prev.past[prev.past.length - 1];
      return { ...prev, past, present, future: [prev.present, ...prev.future].slice(0, MAX_DEPTH) };
    });
  }, []);

  const redo = useCallback(() => {
    coalesceRef.current = null;
    setShape((prev) => {
      if (!prev.future.length) return prev;
      const [present, ...future] = prev.future;
      return { ...prev, past: [...prev.past, prev.present].slice(-MAX_DEPTH), present, future };
    });
  }, []);

  const clear = useCallback(() => {
    coalesceRef.current = null;
    setShape((prev) =>
      editStateKey(prev.present) === editStateKey(emptyEditState())
        ? prev
        : {
            ...prev,
            past: [...prev.past, prev.present].slice(-MAX_DEPTH),
            present: emptyEditState(),
            future: [],
          },
    );
  }, []);

  const dropEdits = useCallback((refs: EditRef[]) => {
    if (!refs.length) return;
    coalesceRef.current = null;
    const strip = (s: EditState): EditState => {
      let out = s;
      for (const { map, key } of refs) {
        if (!(key in out[map])) continue;
        const next = { ...out[map] };
        delete next[key];
        out = { ...out, [map]: next };
      }
      return out;
    };
    setShape((prev) => ({
      past: prev.past.map(strip),
      present: strip(prev.present),
      future: prev.future.map(strip),
      baseline: strip(prev.baseline),
      baselineStack: prev.baselineStack.map(strip),
    }));
  }, []);

  const rebaseAnchors = useCallback((rebases: AnchorRebase[]) => {
    // A `lost` entry carries no `path`, and writing `path: undefined` into a live
    // anchor would break the very save this exists to keep working. Those belong
    // to the stale-marking path (`dropEdits`), not here.
    const moves = rebases.filter((r) => r.path);
    if (!moves.length) return;
    const apply = (s: EditState): EditState => {
      let out = s;
      for (const { map, key, field, path, fpx } of moves) {
        const bucket = out[map] as Record<string, unknown>;
        const edit = bucket[key] as Record<string, unknown> | undefined;
        const anchor = edit?.[field] as { path: number[]; fpx?: string } | undefined;
        if (!anchor) continue;
        out = {
          ...out,
          [map]: { ...bucket, [key]: { ...edit, [field]: { ...anchor, path, fpx } } },
        };
      }
      return out;
    };
    setShape((prev) => ({
      past: prev.past.map(apply),
      present: apply(prev.present),
      future: prev.future.map(apply),
      baseline: apply(prev.baseline),
      baselineStack: prev.baselineStack.map(apply),
    }));
  }, []);

  const markSaved = useCallback(() => {
    setShape((prev) => ({
      ...prev,
      baseline: prev.present,
      baselineStack: [...prev.baselineStack, prev.baseline].slice(-MAX_DEPTH),
    }));
  }, []);

  const rollbackBaseline = useCallback(() => {
    setShape((prev) => {
      if (!prev.baselineStack.length) return { ...prev, baseline: emptyEditState() };
      const baselineStack = prev.baselineStack.slice(0, -1);
      return { ...prev, baseline: prev.baselineStack[prev.baselineStack.length - 1], baselineStack };
    });
  }, []);

  return {
    state: shape.present,
    baseline: shape.baseline,
    update,
    undo,
    redo,
    canUndo: shape.past.length > 0,
    canRedo: shape.future.length > 0,
    undoDepth: shape.past.length,
    redoDepth: shape.future.length,
    dirty: editStateKey(shape.present) !== editStateKey(shape.baseline),
    clear,
    dropEdits,
    rebaseAnchors,
    markSaved,
    rollbackBaseline,
    restored,
  };
}
