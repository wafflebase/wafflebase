/**
 * The reporting session: the mode the overlay is in, and the items collected
 * so far.
 *
 * Plain JS with a subscription list, no framework state. The pattern is
 * `packages/frontend/src/app/slides/zoom-controller.ts`, and the reason is the
 * same one plus one more: the overlay (which paints on pointer moves) and the
 * panel (which renders a list) subscribe independently, and collecting must
 * survive anything the app underneath does to its own render tree. A report is
 * gone for good if a remount drops it — the observation that produced it has
 * already scrolled off the screen.
 *
 * Design: `docs/design/debug-report.md`.
 */

import type { Capture, DebugItem, Disposition, Draft, Target } from './types';

/**
 * `off` — nothing mounted but the hotkey listener.
 * `idle` — overlay up, nothing being aimed at (the panel is open, say).
 * `pick` — pointing at a node or a canvas address.
 * `region` — dragging a box.
 */
export type Mode = 'off' | 'idle' | 'pick' | 'region';

/** What a caller supplies; the session owns identity and time. */
export type NewItem = {
  note: string;
  target: Target;
  capture?: Capture;
  disposition?: Disposition;
  agentCandidate?: boolean;
};

export type ItemPatch = {
  note?: string;
  disposition?: Disposition;
  agentCandidate?: boolean;
  draft?: Draft;
  capture?: Capture;
};

export interface DebugSession {
  mode(): Mode;
  /** No-op when the mode is unchanged, so subscribers are not woken pointlessly. */
  setMode(next: Mode): void;
  /** Hotkey behaviour: into `pick` from anywhere off, back to `off` from anywhere on. */
  toggle(): void;
  items(): readonly DebugItem[];
  count(): number;
  /** Returns the stored item, including the id the session assigned. */
  add(item: NewItem): DebugItem;
  /** Merges the given fields; unknown ids are ignored rather than thrown. */
  update(id: string, patch: ItemPatch): void;
  remove(id: string): void;
  /** Replace the whole list — used when rehydrating from the store on load. */
  replaceAll(items: readonly DebugItem[]): void;
  /** Called after a bundle has been handed over. */
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export type SessionOptions = {
  /** Injected so tests do not depend on `crypto` or on wall-clock ordering. */
  newId?: () => string;
  now?: () => number;
};

let fallbackCounter = 0;

function defaultNewId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // No `Math.random()`: an id only has to be unique within one session, and a
  // counter is both sufficient and reproducible in a log.
  fallbackCounter += 1;
  return `item-${fallbackCounter}`;
}

export function createSession(options: SessionOptions = {}): DebugSession {
  const newId = options.newId ?? defaultNewId;
  const now = options.now ?? (() => Date.now());

  let mode: Mode = 'off';
  let items: DebugItem[] = [];
  const listeners = new Set<() => void>();

  /**
   * Notify over a SNAPSHOT of the listener set, so a subscriber that
   * unsubscribes (or subscribes) while being notified cannot mutate the set
   * mid-iteration.
   *
   * A throwing listener must not silence the others — the panel failing to
   * render is no reason for the store to miss a write — so every listener runs
   * and the first error is rethrown afterwards. Swallowing it would make a
   * broken subscriber invisible.
   */
  const notify = () => {
    // A BOOLEAN, not an `undefined` sentinel: `throw undefined` is legal, and
    // testing the captured value against `undefined` made exactly that failure
    // invisible — the one thing this rethrow exists to prevent.
    let failed = false;
    let firstError: unknown;
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
      }
    }
    if (failed) throw firstError;
  };

  return {
    mode: () => mode,

    setMode(next) {
      if (next === mode) return;
      mode = next;
      notify();
    },

    toggle() {
      mode = mode === 'off' ? 'pick' : 'off';
      notify();
    },

    items: () => items,
    count: () => items.length,

    add(item) {
      const stored: DebugItem = {
        id: newId(),
        createdAt: now(),
        note: item.note,
        target: item.target,
        ...(item.capture ? { capture: item.capture } : {}),
        disposition: item.disposition ?? 'verify',
        agentCandidate: item.agentCandidate ?? false,
      };
      items = [...items, stored];
      notify();
      return stored;
    },

    update(id, patch) {
      const index = items.findIndex((i) => i.id === id);
      if (index === -1) return;
      const next = [...items];
      next[index] = { ...next[index], ...patch };
      items = next;
      notify();
    },

    remove(id) {
      const next = items.filter((i) => i.id !== id);
      if (next.length === items.length) return;
      items = next;
      notify();
    },

    replaceAll(next) {
      items = [...next];
      notify();
    },

    clear() {
      if (items.length === 0) return;
      items = [];
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The process-wide session.
 *
 * A singleton because the hotkey, the overlay and the panel are three mounts
 * of one activity, and because collecting has to outlive any of them. Hosts
 * that want isolation (tests, the design editor embedding a second instance)
 * call `createSession()` instead.
 */
export const debugSession: DebugSession = createSession();
