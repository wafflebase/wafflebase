import { generateId, type ElementInit, type Endpoint, type Frame } from '@wafflebase/slides';
import { resolveMiroFrames } from './geometry';
import { pickConnectorSite } from './connector-sites';
import { miroShapeKind } from './shape-kind';
import { stickyHex } from './colors';
import { miroHtmlToBlocks } from './text';
import type { MiroImportInput, MiroItemLike, MiroMapResult } from './types';

const SUPPORTED = new Set(['sticky_note', 'shape', 'text', 'image', 'frame', 'card', 'app_card']);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** Miro connector `shape` → the board's connector routing. */
function routingOf(shape: string | undefined): 'straight' | 'elbow' | 'curved' {
  if (shape === 'straight') return 'straight';
  if (shape === 'elbowed') return 'elbow';
  return 'curved';
}

/**
 * Escape text that is about to be interpolated into an HTML fragment.
 *
 * Card titles/descriptions arrive as PLAIN TEXT and are wrapped in `<p>` so
 * they can share `miroHtmlToBlocks` with the fields that really are HTML.
 * Without this, a title containing `<`, `&`, or literally `</p><p>` is
 * reparsed as markup: the words silently restructure, or vanish into a tag
 * name. (Not an XSS vector — `DOMParser` output is inert and only text and
 * marks are ever read off it — but it does corrupt the user's content.)
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Map a Miro board's items + connectors to board `ElementInit`s.
 *
 * Two passes, mirroring the PPTX importer's `parseSpTree`: pass 1 assigns an
 * element id to every mappable item and records `miroId → elementId`, so pass
 * 2 can resolve connector endpoints regardless of the order items arrived in.
 *
 * The ids minted here are LOCAL HANDLES carried on `__id`, not the ids the
 * document ends up with — the store mints its own on `addElement`. The applier
 * (`applyBoardElements`) is responsible for remapping every connector endpoint
 * from a `__id` onto the real one; a connector written with a raw `__id`
 * anchors to nothing and collapses to the world origin.
 *
 * Pure: no I/O, no secrets, no env — the one environment-dependent value (the
 * image base URL) is injected as `resolveImageUrl`.
 */
export function mapMiroItems(input: MiroImportInput): MiroMapResult {
  const skipped: Record<string, number> = {};
  const bump = (type: string) => { skipped[type] = (skipped[type] ?? 0) + 1; };
  const approximated: Record<string, number> = {};
  const approx = (kind: string) => { approximated[kind] = (approximated[kind] ?? 0) + 1; };

  // --- pass 0: board-absolute geometry ---
  // Resolved over the WHOLE payload, not just the mappable items: a frame is
  // the parent that positions its contents, and it has to be reachable here
  // even in the shapes where it would not itself be emitted.
  const { frames: absolute, orphans } = resolveMiroFrames(input.items);

  // --- pass 1: id map + frames ---
  const idMap = new Map<string, string>();
  const frames = new Map<string, Frame>();
  const mappable: MiroItemLike[] = [];

  for (const item of input.items) {
    if (!SUPPORTED.has(item.type)) {
      bump(item.type);
      continue;
    }
    // An image with no usable `imageUrl` emits nothing, so it must not reach
    // the id map: a connector pointing at it would resolve to a live handle
    // and be emitted `attached` to an element that is never created. The
    // applier does catch that, but it reports the drop under its own counter —
    // the honest place to account for it is here, where the cause is known.
    // This is why the check runs in pass 1, BEFORE the id is minted.
    if (item.type === 'image' && !str((item.data ?? {}).imageUrl)) {
      bump('image');
      continue;
    }
    const elementId = generateId();
    idMap.set(item.id, elementId);
    frames.set(item.id, absolute.get(item.id)!);
    // Counted here, not in `resolveMiroFrames`: `approximated` reports what
    // reached the document in a degraded form, and an item that was skipped
    // above never reaches it at all.
    if (orphans.has(item.id)) approx('parent-position');
    mappable.push(item);
  }

  // --- pass 2: build the elements ---
  const inits: (ElementInit & { __id?: string })[] = [];

  // Frames first. A board has no container concept, so a Miro frame becomes an
  // ordinary opaque rectangle — and z-order here is array order. Emitting them
  // in `/items` order meant a frame that happened to arrive after the items it
  // contains painted straight over them, hiding the content it is supposed to
  // delimit. Frames are backdrops, so they go at the bottom.
  const ordered = [
    ...mappable.filter((i) => i.type === 'frame'),
    ...mappable.filter((i) => i.type !== 'frame'),
  ];

  for (const item of ordered) {
    const __id = idMap.get(item.id)!;
    const frame = frames.get(item.id)!;
    const data = item.data ?? {};
    const style = item.style ?? {};

    if (item.type === 'sticky_note') {
      inits.push({
        __id,
        type: 'shape',
        frame,
        data: {
          kind: 'roundRect',
          fill: { kind: 'srgb', value: stickyHex(str(style.fillColor)) },
          text: {
            blocks: miroHtmlToBlocks(str(data.content)),
            verticalAnchor: 'middle',
            autofit: 'shrink',
          },
        },
      } as ElementInit & { __id: string });
      continue;
    }

    if (item.type === 'shape') {
      const { kind, known } = miroShapeKind(str(data.shape));
      // The shape IS imported — as a rect. That is a degradation, not a skip.
      if (!known) approx('shape-kind');
      const borderWidth = num(style.borderWidth);
      inits.push({
        __id,
        type: 'shape',
        frame,
        data: {
          kind,
          fill: { kind: 'srgb', value: str(style.fillColor) ?? '#ffffff' },
          ...(borderWidth && borderWidth > 0
            ? { stroke: { color: str(style.borderColor) ?? '#1a1a1a', width: borderWidth } }
            : {}),
          text: {
            blocks: miroHtmlToBlocks(str(data.content)),
            verticalAnchor: 'middle',
            autofit: 'shrink',
          },
        },
      } as ElementInit & { __id: string });
      continue;
    }

    if (item.type === 'text') {
      inits.push({
        __id,
        type: 'text',
        frame,
        data: { blocks: miroHtmlToBlocks(str(data.content)) },
      } as ElementInit & { __id: string });
      continue;
    }

    if (item.type === 'image') {
      // Non-null by construction: pass 1 drops an image without a `src` before
      // it can be registered, so anything reaching here has one.
      const src = str(data.imageUrl)!;
      inits.push({
        // The backend's URL is root-relative; the injected resolver makes it
        // absolute before it is persisted. See `MiroImportInput`.
        __id, type: 'image', frame, data: { src: input.resolveImageUrl(src) },
      } as ElementInit & { __id: string });
      continue;
    }

    if (item.type === 'frame') {
      // A board has no container concept — a frame becomes a labelled region.
      inits.push({
        __id,
        type: 'shape',
        frame,
        data: {
          kind: 'rect',
          fill: { kind: 'srgb', value: '#FFFFFF' },
          stroke: { color: '#B0B7C3', width: 1 },
          text: {
            blocks: miroHtmlToBlocks(str(data.title)),
            verticalAnchor: 'top',
          },
        },
      } as ElementInit & { __id: string });
      continue;
    }

    // card | app_card
    const title = str(data.title) ?? '';
    const description = str(data.description) ?? '';
    const html = [
      title ? `<p>${escapeHtml(title)}</p>` : '',
      description ? `<p>${escapeHtml(description)}</p>` : '',
    ].join('');
    inits.push({
      __id,
      type: 'shape',
      frame,
      data: {
        kind: 'roundRect',
        fill: { kind: 'srgb', value: '#FFFFFF' },
        stroke: { color: str(style.cardTheme) ?? str(style.fillColor) ?? '#2d9bf0', width: 2 },
        text: { blocks: miroHtmlToBlocks(html), verticalAnchor: 'top' },
      },
    } as ElementInit & { __id: string });
  }

  // --- connectors ---
  for (const connector of input.connectors) {
    const startId = connector.startItem?.id;
    const endId = connector.endItem?.id;
    const startElement = startId ? idMap.get(startId) : undefined;
    const endElement = endId ? idMap.get(endId) : undefined;

    // Both ends must anchor to a mapped element. Miro exposes no absolute
    // coordinate for an end that did not map, so a `free` endpoint could only
    // be guessed — and the guess lands at the world origin, which for a board
    // sitting far from (0, 0) draws a long stray line across the import.
    // Reporting the connector is honest; inventing a position is not.
    if (!startElement || !endElement) {
      bump('connector');
      continue;
    }

    // Each end attaches to the side that faces the other end. Hardcoding
    // `siteIndex: 0` (top-centre, outward normal pointing north) made every
    // imported connector leave the top of the source and arrive at the top of
    // the target — and since the default routing is `curved`, which bows along
    // those normals, even neighbouring shapes were joined by a huge arc
    // sweeping over the board. See `pickConnectorSite` for the precedence.
    const startFrame = startId ? frames.get(startId) : undefined;
    const endFrame = endId ? frames.get(endId) : undefined;
    const start: Endpoint = {
      kind: 'attached',
      elementId: startElement,
      siteIndex: pickConnectorSite(connector.startItem, startFrame, endFrame),
    };
    const end: Endpoint = {
      kind: 'attached',
      elementId: endElement,
      siteIndex: pickConnectorSite(connector.endItem, endFrame, startFrame),
    };

    const style = connector.style ?? {};
    const strokeWidth = num(style.strokeWidth);
    inits.push({
      __id: generateId(),
      type: 'connector',
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      routing: routingOf(connector.shape),
      start,
      end,
      arrowheads: {
        ...(str(style.startStrokeCap) && str(style.startStrokeCap) !== 'none'
          ? { start: { kind: 'triangle', size: 'md' } }
          : {}),
        ...(str(style.endStrokeCap) !== 'none'
          ? { end: { kind: 'triangle', size: 'md' } }
          : {}),
      },
      ...(strokeWidth
        ? { stroke: { color: str(style.strokeColor) ?? '#000000', width: strokeWidth } }
        : {}),
    } as ElementInit & { __id: string });
  }

  return { inits, skipped, approximated };
}
