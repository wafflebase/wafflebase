import type { FreeformCommand } from './element';
import { MAX_GROUP_DEPTH } from './group-depth';

/**
 * Compact storage for ink paths.
 *
 * A marker stroke is a `'freeform'` shape whose `data.path.commands` is
 * an `M` followed by one `Q` per captured point. Stored as a CRDT array
 * of objects that is one Yorkie object per command and one register per
 * coordinate, each carrying its own CRDT metadata — a 200-point stroke
 * costs tens of kilobytes. A board, whose users draw stroke after stroke,
 * pays that per stroke.
 *
 * This codec packs such a command list into ONE string:
 *
 * ```text
 * q1:M0,5000Q120,-40,60,-20Q…
 * ```
 *
 * - `q1:` versions the format, so a later encoding can coexist.
 * - Each command is its letter followed by its coordinates.
 * - Coordinates are normalized `[0, 1]` path units quantised to
 *   1 / {@link FREEFORM_QUANTUM}, then written as the DELTA from the
 *   previous coordinate on the same axis (x after x, y after y). Ink
 *   moves a little at a time, so deltas are short. Deltas are taken
 *   between already-quantised values, so rounding never accumulates.
 *
 * Only the ink vocabulary (`M`, `L`, `Q`) is packed; a path with any
 * other command (an imported custGeom with `C`, `A` or `Z`) keeps its
 * array form. Decoding is pure and total: anything that is not a valid
 * packed string decodes to `null`, and callers fall back to reading the
 * value as it is.
 *
 * Pure and DOM-free: the backend's board reader decodes with it too.
 */

/** Steps per path unit: 1e-4 of the frame, 0.1 px on a 1000 px stroke. */
export const FREEFORM_QUANTUM = 10000;

const PREFIX = 'q1:';

/** Whether a command list can be packed by {@link encodeFreeformCommands}. */
export function isPackableFreeform(commands: readonly FreeformCommand[]): boolean {
  if (commands.length === 0) return false;
  for (const cmd of commands) {
    if (cmd.c !== 'M' && cmd.c !== 'L' && cmd.c !== 'Q') return false;
    for (const v of coordsOf(cmd)) if (!Number.isFinite(v)) return false;
  }
  return true;
}

function coordsOf(cmd: FreeformCommand): number[] {
  switch (cmd.c) {
    case 'M':
    case 'L':
      return [cmd.x, cmd.y];
    case 'Q':
      return [cmd.x1, cmd.y1, cmd.x, cmd.y];
    default:
      return [];
  }
}

/**
 * Pack `commands` into one string, or `null` when they are not all
 * `M` / `L` / `Q` (see {@link isPackableFreeform}).
 */
export function encodeFreeformCommands(
  commands: readonly FreeformCommand[],
): string | null {
  if (!isPackableFreeform(commands)) return null;
  let lastX = 0;
  let lastY = 0;
  let out = PREFIX;
  for (const cmd of commands) {
    out += cmd.c;
    const coords = coordsOf(cmd);
    for (let i = 0; i < coords.length; i++) {
      const q = Math.round(coords[i] * FREEFORM_QUANTUM);
      const isX = i % 2 === 0;
      const d = q - (isX ? lastX : lastY);
      if (isX) lastX = q;
      else lastY = q;
      // A leading `-` doubles as the separator, so it needs no comma.
      out += (i === 0 || d < 0 ? '' : ',') + d;
    }
  }
  return out;
}

const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, Q: 4 };

/**
 * Unpack a string from {@link encodeFreeformCommands}. `null` for
 * anything that is not one (wrong prefix, unknown letter, wrong arity).
 */
export function decodeFreeformCommands(packed: string): FreeformCommand[] | null {
  if (!packed.startsWith(PREFIX)) return null;
  const body = packed.slice(PREFIX.length);
  const re = /([MLQ])([^MLQ]*)/gy;
  const out: FreeformCommand[] = [];
  let lastX = 0;
  let lastY = 0;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[0].length === 0) break;
    consumed = re.lastIndex;
    const letter = m[1];
    const nums = m[2].match(/-?\d+/g) ?? [];
    if (nums.length !== ARITY[letter]) return null;
    if (m[2].replace(/-?\d+/g, '').replace(/,/g, '') !== '') return null;
    const v: number[] = [];
    for (let i = 0; i < nums.length; i++) {
      const d = Number(nums[i]);
      if (i % 2 === 0) {
        lastX += d;
        v.push(lastX / FREEFORM_QUANTUM);
      } else {
        lastY += d;
        v.push(lastY / FREEFORM_QUANTUM);
      }
    }
    if (letter === 'Q') out.push({ c: 'Q', x1: v[0], y1: v[1], x: v[2], y: v[3] });
    else out.push({ c: letter as 'M' | 'L', x: v[0], y: v[1] });
  }
  if (consumed !== body.length || out.length === 0) return null;
  return out;
}

/**
 * The read side for a stored element `data` object: when it is a
 * freeform whose `path.commands` is a packed string, return a copy with
 * the commands decoded; otherwise return `data` unchanged. Old boards
 * (array commands) and every non-freeform element pass straight through.
 */
export function decodeFreeformData<T>(data: T): T {
  if (data === null || typeof data !== 'object') return data;
  const d = data as { kind?: unknown; path?: { commands?: unknown } };
  if (d.kind !== 'freeform' || !d.path) return data;
  const commands = d.path.commands;
  if (typeof commands !== 'string') return data;
  const decoded = decodeFreeformCommands(commands);
  return { ...data, path: { ...d.path, commands: decoded ?? [] } } as T;
}

/**
 * The write side: when `data` is a freeform whose commands are packable,
 * return a copy carrying the packed string; otherwise `data` unchanged.
 */
export function encodeFreeformData<T>(data: T): T {
  if (data === null || typeof data !== 'object') return data;
  const d = data as { kind?: unknown; path?: { commands?: unknown } };
  if (d.kind !== 'freeform' || !d.path || !Array.isArray(d.path.commands)) return data;
  const packed = encodeFreeformCommands(d.path.commands as FreeformCommand[]);
  if (packed === null) return data;
  return { ...data, path: { ...d.path, commands: packed } } as T;
}

/**
 * {@link decodeFreeformData} applied to a stored element tree: every
 * shape (and every group child, recursively) gets its path decoded.
 * Returns new objects only along the branches that changed.
 */
export function decodeFreeformElements<T>(elements: readonly T[], depth = 0): T[] {
  return elements.map((el) => {
    const e = el as { type?: unknown; data?: { children?: unknown } };
    if (e.type === 'shape') {
      const data = decodeFreeformData(e.data);
      return data === e.data ? el : ({ ...el, data } as T);
    }
    // Past MAX_GROUP_DEPTH a group is returned as stored: the tree is
    // untrusted (a peer wrote it), and the walk must not blow the stack.
    if (
      e.type === 'group' &&
      depth < MAX_GROUP_DEPTH &&
      e.data &&
      Array.isArray(e.data.children)
    ) {
      const children = decodeFreeformElements(e.data.children as unknown[], depth + 1);
      return { ...el, data: { ...e.data, children } } as T;
    }
    return el;
  });
}

/** {@link encodeFreeformData} applied to an element tree; the write twin of {@link decodeFreeformElements}. */
export function encodeFreeformElements<T>(elements: readonly T[], depth = 0): T[] {
  return elements.map((el) => encodeFreeformElement(el, depth));
}

/** {@link encodeFreeformData} for one element (and a group's children). */
export function encodeFreeformElement<T>(el: T, depth = 0): T {
  const e = el as { type?: unknown; data?: { children?: unknown } };
  if (e.type === 'shape') {
    const data = encodeFreeformData(e.data);
    return data === e.data ? el : ({ ...el, data } as T);
  }
  if (
    e.type === 'group' &&
    depth < MAX_GROUP_DEPTH &&
    e.data &&
    Array.isArray(e.data.children)
  ) {
    const children = encodeFreeformElements(e.data.children as unknown[], depth + 1);
    return { ...el, data: { ...e.data, children } } as T;
  }
  return el;
}
