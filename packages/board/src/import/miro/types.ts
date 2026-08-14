import type { ElementInit } from '@wafflebase/slides';
import type { MiroGeometryLike, MiroParentLike, MiroPositionLike } from './geometry';

/** Loose mirrors of the backend's Miro payload — the mapper reads no more. */
export interface MiroItemLike {
  id: string;
  type: string;
  /**
   * The item's CENTRE, measured against whatever `position.relativeTo` names —
   * the canvas centre for a top-level item, the parent frame's top-left for
   * one inside a frame. `resolveMiroFrames` turns the pair into board-absolute
   * coordinates; reading `position` on its own is a bug.
   */
  position?: MiroPositionLike;
  geometry?: MiroGeometryLike;
  /** The containing frame, when the item sits inside one. */
  parent?: MiroParentLike;
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
}

/**
 * Miro's `RelativeOffset`: a point on an item's bounding box expressed as
 * percentage strings, top-left = `{ x: '0%', y: '0%' }`. Typed loosely (and
 * optionally numeric) because it arrives as untrusted payload — the parser in
 * `connector-sites.ts` validates it rather than trusting the shape.
 */
export interface MiroRelativeOffsetLike {
  x?: string | number;
  y?: string | number;
}

/**
 * One end of a Miro connector. `snapTo` (`'auto' | 'top' | 'right' | 'bottom'
 * | 'left'`) and `position` are what decide which side of the shape the
 * connector leaves from; see `pickConnectorSite`.
 */
export interface MiroConnectorEndLike {
  id?: string;
  snapTo?: string;
  position?: MiroRelativeOffsetLike;
}

export interface MiroConnectorLike {
  id: string;
  shape?: string;
  startItem?: MiroConnectorEndLike;
  endItem?: MiroConnectorEndLike;
  style?: Record<string, unknown>;
}

export interface MiroImportInput {
  items: MiroItemLike[];
  connectors: MiroConnectorLike[];
  /**
   * Turn the backend's image URL into one a browser can actually load,
   * injected because this package must stay free of env and I/O concerns.
   *
   * The backend re-hosts every Miro image and rewrites `data.imageUrl` to a
   * ROOT-RELATIVE `/api/v1/workspaces/:wid/images/:id`. The SPA and the API sit
   * on different origins in every environment we ship, so persisting that value
   * verbatim into the CRDT 404s forever. The frontend owns the base URL, so it
   * passes its resolver in — `resolveImageUrl` from
   * `app/spreadsheet/image-upload`, the same one the native upload path uses.
   *
   * Required, not optional: a defaulted identity would be invisible at the call
   * site, and that is exactly how the relative URL shipped once already.
   */
  resolveImageUrl: (url: string) => string;
}

/**
 * `inits` are ready for `store.addElement`. Each carries a non-model `__id`
 * so connectors can reference the element the store will create; the applier
 * remaps those handles onto the real store ids and strips them before writing.
 */
export interface MiroMapResult {
  inits: (ElementInit & { __id?: string })[];
  /**
   * Count of entries that did NOT come across, keyed by Miro item type.
   * Everything counted here is absent from `inits`.
   */
  skipped: Record<string, number>;
  /**
   * Count of entries that DID come across but in a degraded form, keyed by the
   * kind of degradation.
   *
   * Kept apart from `skipped` because they are opposite facts about the import.
   * Folding them together told the user content was missing when it was
   * present, in a line ("2 shape-kinds skipped") that also named a Miro item
   * type which does not exist.
   */
  approximated: Record<string, number>;
}
