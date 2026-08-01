import { generateId, type ElementInit, type Endpoint } from '@wafflebase/slides';
import { miroFrame } from './geometry';
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
 * Map a Miro board's items + connectors to board `ElementInit`s.
 *
 * Two passes, mirroring the PPTX importer's `parseSpTree`: pass 1 assigns an
 * element id to every mappable item and records `miroId → elementId`, so pass
 * 2 can resolve connector endpoints regardless of the order items arrived in.
 *
 * Pure: no I/O, no secrets, no DOM beyond `DOMParser` for the text fragments.
 */
export function mapMiroItems(input: MiroImportInput): MiroMapResult {
  const skipped: Record<string, number> = {};
  const bump = (type: string) => { skipped[type] = (skipped[type] ?? 0) + 1; };

  // --- pass 1: id map + frames ---
  const idMap = new Map<string, string>();
  const frames = new Map<string, ReturnType<typeof miroFrame>>();
  const mappable: MiroItemLike[] = [];

  for (const item of input.items) {
    if (!SUPPORTED.has(item.type)) {
      bump(item.type);
      continue;
    }
    const elementId = generateId();
    idMap.set(item.id, elementId);
    frames.set(item.id, miroFrame(item.position, item.geometry));
    mappable.push(item);
  }

  // --- pass 2: build the elements ---
  const inits: (ElementInit & { __id?: string })[] = [];

  for (const item of mappable) {
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
      if (!known) bump('shape-kind');
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
      const src = str(data.imageUrl);
      if (!src) { bump('image'); continue; }
      inits.push({
        __id, type: 'image', frame, data: { src },
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
    const html = [title ? `<p>${title}</p>` : '', description ? `<p>${description}</p>` : ''].join('');
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

    // Nothing to anchor to on either end — the connector would float at the
    // origin, which is worse than reporting it.
    if (!startElement && !endElement) {
      bump('connector');
      continue;
    }

    const centreOf = (miroId: string | undefined): { x: number; y: number } => {
      const f = miroId ? frames.get(miroId) : undefined;
      return f ? { x: f.x + f.w / 2, y: f.y + f.h / 2 } : { x: 0, y: 0 };
    };

    const endpoint = (elementId: string | undefined, otherMiroId: string | undefined): Endpoint =>
      elementId
        ? { kind: 'attached', elementId, siteIndex: 0 }
        : { kind: 'free', ...centreOf(otherMiroId) };

    const style = connector.style ?? {};
    const strokeWidth = num(style.strokeWidth);
    inits.push({
      __id: generateId(),
      type: 'connector',
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      routing: routingOf(connector.shape),
      start: endpoint(startElement, startId),
      end: endpoint(endElement, endId),
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

  return { inits, skipped };
}
