import {
  buildElementWorldLookup,
  computeConnectorFrame,
  type ConnectorElement,
  type Element,
  type Frame,
  type Point,
} from '@wafflebase/slides';
import {
  frameAround,
  isSectionElement,
  sectionOf,
  SECTION_PADDING,
} from '../model/section';
import {
  AGENT_GRID_GAP,
  besideContent,
  findFreeRect,
  gridColumns,
  gridOrigins,
  gridSize,
} from './layout';
import { createSectionMembership, type SectionMembership } from './membership';

/**
 * Batch move / resize of top-level board elements, planned on plain data
 * so a writer can land the result as granular field writes inside one
 * `doc.update` (the `/api/v1` board endpoints) and refuse a bad batch
 * before touching the document.
 *
 * Section-aware the way a drag on the canvas is (`companionMoveIds`): a
 * section that MOVES carries everything geometrically inside it, read
 * before the move; a section that is only resized carries nothing. A
 * connector glued to anything that moved gets its cached frame recomputed,
 * as `YorkieBoardStore.updateElementFrame` does.
 */
export interface MoveSpec {
  id: string;
  /** New top-left, in world coordinates. */
  x: number;
  y: number;
  /** New size; absent keeps the current one. */
  w?: number;
  h?: number;
}

export type MovePlan =
  | {
      ok: true;
      /** Every element whose stored fields change, in its new plain form. */
      changed: Element[];
      /** Ids named in the batch. */
      moved: string[];
      /** Section members carried along by a moved section. */
      carried: string[];
    }
  | {
      ok: false;
      /**
       * `not_found` — no top-level element has the id; `duplicate` — an id
       * appears twice; `connector` — a connector's frame follows its ends and
       * cannot be set; `locked` — the element is a locked section or inside
       * one, which the canvas does not let anyone move either.
       */
      reason: 'not_found' | 'duplicate' | 'connector' | 'locked';
      ids: string[];
    };

/** Ids a locked section freezes: the section and everything inside it. */
export function lockedIds(
  elements: readonly Element[],
  membership: SectionMembership = createSectionMembership(elements),
): Set<string> {
  const out = new Set<string>();
  for (const el of elements) {
    if (!sectionOf(el)?.locked) continue;
    out.add(el.id);
    for (const id of membership.membersOf(el)) out.add(id);
  }
  return out;
}

function translate(el: Element, dx: number, dy: number): Element {
  const frame = { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy };
  if (el.type !== 'connector') return { ...el, frame } as Element;
  // A free end travels with the drag; a glued end follows its target and
  // is resolved when the frame is recomputed.
  const shift = (ep: ConnectorElement['start']): ConnectorElement['start'] =>
    ep.kind === 'free' ? { kind: 'free', x: ep.x + dx, y: ep.y + dy } : ep;
  return { ...el, frame, start: shift(el.start), end: shift(el.end) };
}

export function planMoves(
  elements: readonly Element[],
  moves: readonly MoveSpec[],
): MovePlan {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const seen = new Set<string>();
  const duplicate: string[] = [];
  const missing: string[] = [];
  const connectors: string[] = [];
  for (const m of moves) {
    if (seen.has(m.id)) duplicate.push(m.id);
    seen.add(m.id);
    const el = byId.get(m.id);
    if (!el) missing.push(m.id);
    else if (el.type === 'connector') connectors.push(m.id);
  }
  if (missing.length > 0) return { ok: false, reason: 'not_found', ids: missing };
  if (duplicate.length > 0) return { ok: false, reason: 'duplicate', ids: duplicate };
  if (connectors.length > 0) return { ok: false, reason: 'connector', ids: connectors };
  // One index for the whole plan: membership is read from the board BEFORE
  // the batch, for the locked check and for every moved section alike.
  const membership = createSectionMembership(elements);
  const locked = lockedIds(elements, membership);
  const frozen = moves.map((m) => m.id).filter((id) => locked.has(id));
  if (frozen.length > 0) return { ok: false, reason: 'locked', ids: frozen };

  const next = new Map<string, Element>();
  const carried: string[] = [];
  for (const m of moves) {
    const el = byId.get(m.id)!;
    const frame: Frame = {
      ...el.frame,
      x: m.x,
      y: m.y,
      w: m.w ?? el.frame.w,
      h: m.h ?? el.frame.h,
    };
    next.set(el.id, { ...el, frame } as Element);
    const dx = m.x - el.frame.x;
    const dy = m.y - el.frame.y;
    if (!isSectionElement(el) || (dx === 0 && dy === 0)) continue;
    // Membership is read from the board BEFORE the batch, so a section
    // carries what was inside it, like a drag that began there.
    for (const id of membership.membersOf(el)) {
      if (seen.has(id) || next.has(id)) continue;
      next.set(id, translate(byId.get(id)!, dx, dy));
      carried.push(id);
    }
  }

  // Recompute the cached frame of every connector whose ends moved.
  const updated = elements.map((el) => next.get(el.id) ?? el);
  const lookup = buildElementWorldLookup(updated);
  for (const el of updated) {
    if (el.type !== 'connector') continue;
    const glued = (ep: ConnectorElement['start']) =>
      ep.kind === 'attached' && next.has(ep.elementId);
    if (!next.has(el.id) && !glued(el.start) && !glued(el.end)) continue;
    next.set(el.id, { ...el, frame: computeConnectorFrame(el, lookup) });
  }

  return {
    ok: true,
    changed: updated.filter((el) => next.has(el.id)).map((el) => next.get(el.id)!),
    moved: moves.map((m) => m.id),
    carried,
  };
}

/**
 * Lay `ids` out as a near-square grid of equal cells (the largest member's
 * size), each element centred in its cell, then frame the grid as a
 * section with the canvas's own wrap padding. With no `at`, the section
 * goes in free space beside the content that is not being arranged — the
 * agent's "cluster these into a section" in one step.
 *
 * Returns the moves (for {@link planMoves}) and the section frame.
 */
export function planGridSection(
  elements: readonly Element[],
  ids: readonly string[],
  opts: { at?: Point; columns?: number; padding?: number } = {},
): { moves: MoveSpec[]; frame: Frame } {
  const padding = opts.padding ?? SECTION_PADDING;
  const byId = new Map(elements.map((el) => [el.id, el]));
  const items = ids.map((id) => byId.get(id)).filter((el): el is Element => !!el);
  const cell = {
    w: Math.max(1, ...items.map((el) => el.frame.w)),
    h: Math.max(1, ...items.map((el) => el.frame.h)),
  };
  const columns = opts.columns ?? gridColumns(items.length);
  const grid = gridSize(items.length, cell, columns, AGENT_GRID_GAP);
  const outer = { w: grid.w + padding * 2, h: grid.h + padding * 2 };

  let topLeft: Point;
  if (opts.at) {
    topLeft = opts.at;
  } else {
    const moving = new Set(ids);
    const others = elements.filter((el) => !moving.has(el.id)).map((el) => el.frame);
    topLeft = findFreeRect(others, outer, besideContent(others));
  }
  const origins = gridOrigins(
    items.length,
    { x: topLeft.x + padding, y: topLeft.y + padding },
    cell,
    columns,
    AGENT_GRID_GAP,
  );
  const moves = items.map((el, i) => ({
    id: el.id,
    x: origins[i].x + (cell.w - el.frame.w) / 2,
    y: origins[i].y + (cell.h - el.frame.h) / 2,
  }));
  return {
    moves,
    frame: { x: topLeft.x, y: topLeft.y, w: outer.w, h: outer.h, rotation: 0 },
  };
}

/** The frame of a section wrapping `ids` where they are, with the canvas's padding. */
export function frameAroundIds(
  elements: readonly Element[],
  ids: readonly string[],
): Frame | undefined {
  const wanted = new Set(ids);
  return frameAround(elements.filter((el) => wanted.has(el.id)).map((el) => el.frame));
}
