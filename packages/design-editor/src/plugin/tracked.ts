/**
 * External-change tracking — the editor is not the only writer.
 *
 * A staged edit captures the text it expects to find (`from: "bg-primary"`). Edit
 * the same file in your code editor and that expectation goes stale silently: the
 * AST locate fails, every affected edit errors at save time, and because failed
 * edits never reach the baseline the editor stays dirty forever with no way out.
 *
 * The rule that makes this survivable: we know which bytes WE wrote, so anything
 * else landing in a tracked file is external. Report it and let the client
 * re-validate, rather than discovering it at save time.
 *
 * State is per-`createTracker()` rather than module-level, for the same reason the
 * path guard is: two dev servers in one process must not share it.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';

interface FileStamp {
  mtimeMs: number;
  size: number;
}

export interface ExternalChange {
  /** Root-relative. */
  file: string;
  at: number;
}

/** How many recent external changes to keep for the client to display. */
const MAX_EXTERNAL_CHANGES = 20;

export interface Tracker {
  /** Read a file and start watching it. Every intent-compute path uses this. */
  read(abs: string): Promise<string>;
  /** Write a file AND remember the bytes, so our own write is never called external. */
  write(abs: string, text: string): Promise<void>;
  /** Is `abs` tracked, i.e. does some staged edit depend on it? */
  isTracked(abs: string): boolean;
  /**
   * Classify a filesystem event. Returns true when the change was NOT ours, in
   * which case the caller reports it.
   */
  noteChange(abs: string): boolean;
  /** Monotonic counter the client polls or receives to know its edits may be stale. */
  revision(): number;
  recentChanges(): ExternalChange[];
}

export function createTracker(relOf: (abs: string) => string, now: () => number = Date.now): Tracker {
  /** abs → the stamp we last saw. Exactly the files staged edits depend on. */
  const tracked = new Map<string, FileStamp>();
  /** abs → the exact text this process last wrote there. The own-write filter. */
  const lastWrittenByUs = new Map<string, string>();
  const changes: ExternalChange[] = [];
  let revision = 0;

  const stampOf = (abs: string): FileStamp | null => {
    try {
      const st = fs.statSync(abs);
      return { mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      // Deleted between the event and this stat. Absence is a change like any
      // other, and the caller decides what to do about it.
      return null;
    }
  };

  const restamp = (abs: string) => {
    const s = stampOf(abs);
    if (s) tracked.set(abs, s);
  };

  return {
    async read(abs) {
      const text = await fsp.readFile(abs, 'utf8');
      // Observe rather than restamp: if it is already tracked, its recorded stamp
      // is the one an external change should be measured against, and refreshing
      // it here would silently absorb a change that arrived between two reads.
      if (!tracked.has(abs)) restamp(abs);
      return text;
    },

    async write(abs, text) {
      await fsp.writeFile(abs, text, 'utf8');
      lastWrittenByUs.set(abs, text);
      restamp(abs);
    },

    isTracked: (abs) => tracked.has(abs),

    /**
     * The own-write filter compares CONTENT, not the stamp.
     *
     * A stamp comparison alone is not enough: our own `write` updates mtime, and
     * some editors write-then-touch, so mtime tells us that something happened and
     * never who did it. Comparing the bytes on disk to the bytes we last wrote is
     * the only test that distinguishes "our save landing" from "the developer
     * saving the same file in their editor".
     */
    noteChange(abs) {
      if (!tracked.has(abs)) return false;
      let current: string | null = null;
      try {
        current = fs.readFileSync(abs, 'utf8');
      } catch {
        current = null;
      }
      if (current !== null && lastWrittenByUs.get(abs) === current) {
        // Our own write coming back through the watcher.
        restamp(abs);
        return false;
      }
      restamp(abs);
      revision += 1;
      changes.unshift({ file: relOf(abs), at: now() });
      if (changes.length > MAX_EXTERNAL_CHANGES) changes.length = MAX_EXTERNAL_CHANGES;
      return true;
    },

    revision: () => revision,
    recentChanges: () => [...changes],
  };
}
