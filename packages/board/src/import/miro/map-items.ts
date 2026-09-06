import {
  generateId,
  type ElementInit,
  type Endpoint,
  type Frame,
  type ArrowheadKind,
  type ArrowheadStyle,
  type Stroke,
  type ThemeColor,
} from '@wafflebase/slides';
import { resolveMiroFrames, resizeAboutCentre } from './geometry';
import { parsePercent, pickConnectorSite, siteAnchor } from './connector-sites';
import { miroShapeKind } from './shape-kind';
import { stickyHex } from './colors';
import {
  estimateTextHeight,
  estimateTextWidth,
  miroAlignment,
  miroFontSizePt,
  miroHtmlToBlocks,
  type MiroTextStyle,
} from './text';
import type {
  MiroConnectorCaptionLike,
  MiroImportInput,
  MiroItemLike,
  MiroMapResult,
} from './types';

const SUPPORTED = new Set(['sticky_note', 'shape', 'text', 'image', 'frame', 'card', 'app_card']);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Read a number that Miro may have sent as a string.
 *
 * The REST API serialises every numeric field under `style` as a STRING —
 * `borderWidth: "2.0"`, `strokeWidth: "1.0"`, `fontSize: "21"`,
 * `fillOpacity: "0.0"` — even though the sibling `geometry` and `position`
 * objects really do carry numbers. A `typeof v === 'number'` guard therefore
 * discarded every style number a real board has: `borderWidth && borderWidth > 0`
 * never fired, so on the reference board 4,383 shapes imported with no outline
 * at all. Combined with an opaque default fill that made them blank boxes.
 *
 * It went unnoticed because the unit fixtures hand-wrote `borderWidth: 3` as a
 * number, a shape the API never actually produces.
 *
 * Bare `Number()` is not enough on its own: it maps `''`, `'  '`, `null` and
 * `[]` to 0, which would turn an ABSENT width into a real zero and an absent
 * opacity into "fully transparent". So only a non-blank string is converted,
 * and only a finite result is returned.
 */
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Resolve a Miro shape's body fill, or `undefined` when the shape is not
 * painted at all.
 *
 * Miro reports fill as a colour PLUS a separate `fillOpacity`, and on real
 * boards transparent is the norm rather than the exception — 7,242 of the
 * reference board's 8,888 items carry `fillOpacity: "0.0"`. Ignoring that and
 * always writing a solid fill did two visible kinds of damage:
 *
 * - a transparent shape whose only visible feature was its border became a
 *   blank white box, invisible against the canvas; and
 * - being opaque, it also PAINTED OVER whatever was emitted before it, hiding
 *   content that had imported correctly.
 *
 * `ShapeElement.data.fill` documents "absent ⇒ the shape is not painted", so
 * fully transparent maps to omitting the field. Partial opacity (0 < a < 1,
 * ~240 items on the same board) maps to `ThemeColor.alpha`, which the model
 * already carries.
 *
 * The `'transparent'` literal is checked as well as the numeric opacity: Miro
 * uses it for shapes created before `fillOpacity` existed, and it is not a
 * colour any renderer can resolve.
 */
function miroShapeFill(style: Record<string, unknown>): ThemeColor | undefined {
  const value = str(style.fillColor);
  if (value === 'transparent') return undefined;

  const opacity = num(style.fillOpacity);
  if (opacity !== undefined && opacity <= 0) return undefined;

  // No colour and no opacity is no INFORMATION, not a white shape. Miro sends
  // a `fillColor` with every real shape; the items that arrive without one are
  // the ones it flags `isSupported: false`, which carry no `style` block at
  // all — 51 of them on the reference board. Defaulting those to opaque white
  // reintroduced exactly the damage above: an invisible box that also hides
  // whatever it happens to be emitted over.
  if (value === undefined && opacity === undefined) return undefined;

  const color = value ?? '#ffffff';
  return opacity !== undefined && opacity < 1
    ? { kind: 'srgb', value: color, alpha: opacity }
    : { kind: 'srgb', value: color };
}

/**
 * Miro's line style → the board's `Stroke.dash`.
 *
 * Shapes call the field `borderStyle` and connectors call it `strokeStyle`,
 * but the vocabulary is the same one. `'normal'` is Miro's solid, and anything
 * unrecognised (API drift) is left undefined so the renderer's own solid
 * default applies rather than a guess.
 */
function miroDash(name: string | undefined): 'dashed' | 'dotted' | undefined {
  if (name === 'dashed') return 'dashed';
  if (name === 'dotted') return 'dotted';
  return undefined;
}

/**
 * Build a `Stroke` from a Miro `style` block, or `undefined` when the line is
 * not drawn.
 *
 * Shared by shapes (`borderWidth`/`borderColor`/`borderStyle`/`borderOpacity`)
 * and connectors (`stroke*`), because the only difference between the two is
 * the field-name prefix — the semantics, including the string-typed numbers,
 * are identical.
 *
 * A width of 0 means "no border" in Miro, so it yields `undefined` rather than
 * a zero-width stroke the renderer would still set up state for. Opacity rides
 * on `ThemeColor.alpha` exactly as the fill's does; a fully transparent border
 * is no border.
 */
function miroStroke(
  style: Record<string, unknown>,
  keys: { width: string; color: string; style: string; opacity: string },
  defaultColor: string,
): Stroke | undefined {
  const width = num(style[keys.width]);
  if (width === undefined || width <= 0) return undefined;

  const opacity = num(style[keys.opacity]);
  if (opacity !== undefined && opacity <= 0) return undefined;

  const value = str(style[keys.color]) ?? defaultColor;
  const color: ThemeColor =
    opacity !== undefined && opacity < 1
      ? { kind: 'srgb', value, alpha: opacity }
      : { kind: 'srgb', value };

  const dash = miroDash(str(style[keys.style]));
  return { color, width, ...(dash ? { dash } : {}) };
}

const SHAPE_STROKE_KEYS = {
  width: 'borderWidth',
  color: 'borderColor',
  style: 'borderStyle',
  opacity: 'borderOpacity',
} as const;

const CONNECTOR_STROKE_KEYS = {
  width: 'strokeWidth',
  color: 'strokeColor',
  style: 'strokeStyle',
  opacity: 'strokeOpacity',
} as const;

/**
 * The item-level typography Miro keeps on `style`, in the units the docs text
 * model uses. `data.content` carries only the inline markup, so without this
 * every imported label collapsed to the 11pt black default.
 */
function textStyleOf(style: Record<string, unknown>): MiroTextStyle {
  const fontSize = miroFontSizePt(num(style.fontSize));
  const color = str(style.color);
  const alignment = miroAlignment(str(style.textAlign));
  return {
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(alignment !== undefined ? { alignment } : {}),
  };
}

/**
 * Miro `textAlignVertical` → the board's `TextBody.verticalAnchor`.
 *
 * Shapes defaulted to `'middle'` unconditionally, which is Miro's own default
 * but wrong for the items that say otherwise — a label pinned to the bottom of
 * a tall container drifted to its centre.
 */
function verticalAnchorOf(
  style: Record<string, unknown>,
  fallback: 'top' | 'middle' | 'bottom',
): 'top' | 'middle' | 'bottom' {
  const value = str(style.textAlignVertical);
  if (value === 'top' || value === 'middle' || value === 'bottom') return value;
  return fallback;
}

/**
 * Miro's stroke-cap vocabulary → the board's arrowhead kinds.
 *
 * Every cap used to collapse to a filled `triangle`, so an open arrow, a
 * diamond and a circle all arrived as the same solid head. The board models
 * filled and open variants of triangle / diamond / circle, which covers all
 * but Miro's ERD crow's-foot notation.
 *
 * Own-property lookup only: the name arrives verbatim from externally supplied
 * JSON, and a bare index would resolve inherited `Object.prototype` keys.
 */
const ARROWHEAD_KIND: Record<string, ArrowheadKind> = {
  stealth: 'triangle',
  rounded_stealth: 'triangle',
  filled_triangle: 'triangle',
  arrow: 'triangle-open',
  unfilled_triangle: 'triangle-open',
  filled_diamond: 'diamond',
  unfilled_diamond: 'diamond-open',
  filled_oval: 'circle',
  filled_circle: 'circle',
  unfilled_oval: 'circle-open',
  unfilled_circle: 'circle-open',
};

/**
 * Miro's own defaults for a connector that carries no `style` at all:
 * undecorated at the start, arrowhead at the end.
 *
 * These are stated rather than implied. The two ends previously read their cap
 * through visibly different expressions — the start required a defined value,
 * the end did not — which produced exactly this behaviour by accident and read
 * as a bug in the end branch.
 */
const DEFAULT_START_CAP = 'none';
const DEFAULT_END_CAP = 'stealth';

/**
 * Resolve one end's arrowhead, or `undefined` for an undecorated end.
 *
 * An unrecognised cap — Miro's ERD crow's-foot family, or API drift — degrades
 * to a filled triangle rather than disappearing: the connector genuinely has a
 * decoration there, and dropping it silently would misreport the diagram.
 * `onApproximate` lets the caller account for that as a degradation.
 */
function arrowheadOf(
  cap: string | undefined,
  fallback: string,
  onApproximate: () => void,
): ArrowheadStyle | undefined {
  const name = cap ?? fallback;
  if (name === 'none') return undefined;
  if (Object.prototype.hasOwnProperty.call(ARROWHEAD_KIND, name)) {
    return { kind: ARROWHEAD_KIND[name], size: 'md' };
  }
  onApproximate();
  return { kind: 'triangle', size: 'md' };
}

/**
 * Turn one Miro connector caption — the text drawn ON the line — into a
 * free-standing text element placed along it, or `undefined` when there is
 * nothing to place.
 *
 * The board has no caption model, and 378 of the reference board's connectors
 * carried one. They were dropped without being counted, which on a process
 * diagram loses the step labels that make it readable at all.
 *
 * A detached label is a real degradation and the caller reports it as one: it
 * will not follow the connector when either endpoint moves.
 *
 * Placement interpolates between the two resolved CONNECTION SITES by the
 * caption's own percentage along the line — not between the frame centres. The
 * centres are not on the connector: a connector runs mid-edge to mid-edge, so
 * a chord between centres diverges from the drawn line by half the size
 * difference of the two shapes. On the reference board, which routinely joins
 * a 1452-wide shape to a 77-wide label, that put captions hundreds of units
 * up-line and often inside the larger shape.
 *
 * Site-to-site is exact for a straight connector and approximate for a curved
 * or elbowed one, which bows away from the chord. Sitting slightly off a curve
 * is a far smaller loss than not existing.
 */
function captionInit(
  caption: MiroConnectorCaptionLike,
  ends: { frame: Frame; siteIndex: number } | undefined,
  otherEnds: { frame: Frame; siteIndex: number } | undefined,
  style: Record<string, unknown>,
): (ElementInit & { __id: string }) | undefined {
  if (!ends || !otherEnds) return undefined;

  // A connector's caption typography lives on the CONNECTOR's style, beside
  // the stroke fields — `fontSize` and `color` sit right next to `strokeColor`
  // — which is why it goes through the same `textStyleOf` an item's does.
  const textStyle = textStyleOf(style);
  const blocks = miroHtmlToBlocks(caption.content, { ...textStyle, alignment: 'center' });
  if (!blocks.some((b) => b.inlines.some((i) => i.text.trim() !== ''))) return undefined;

  // Miro measures the caption's position from the START of the line; a missing
  // or unparseable value means the midpoint, which is also its own default.
  const along = (parsePercent(caption.position) ?? 50) / 100;
  const from = siteAnchor(ends.frame, ends.siteIndex);
  const to = siteAnchor(otherEnds.frame, otherEnds.siteIndex);
  const cx = from.x + (to.x - from.x) * along;
  const cy = from.y + (to.y - from.y) * along;

  const fontSizePx = num(style.fontSize);
  const w = estimateTextWidth(blocks, fontSizePx);
  const h = estimateTextHeight(blocks, fontSizePx);
  return {
    __id: generateId(),
    type: 'text',
    frame: { x: cx - w / 2, y: cy - h / 2, w, h, rotation: 0 },
    // Centred both ways, so the label straddles the line the way Miro draws it
    // rather than hanging off one corner of a guessed box.
    data: { blocks, verticalAnchor: 'middle' },
  } as ElementInit & { __id: string };
}

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
            blocks: miroHtmlToBlocks(str(data.content), textStyleOf(style)),
            verticalAnchor: verticalAnchorOf(style, 'middle'),
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
      const fill = miroShapeFill(style);
      const stroke = miroStroke(style, SHAPE_STROKE_KEYS, '#1a1a1a');
      inits.push({
        __id,
        type: 'shape',
        frame,
        data: {
          kind,
          ...(fill ? { fill } : {}),
          ...(stroke ? { stroke } : {}),
          text: {
            blocks: miroHtmlToBlocks(str(data.content), textStyleOf(style)),
            verticalAnchor: verticalAnchorOf(style, 'middle'),
            autofit: 'shrink',
          },
        },
      } as ElementInit & { __id: string });
      continue;
    }

    if (item.type === 'text') {
      const textStyle = textStyleOf(style);
      const blocks = miroHtmlToBlocks(str(data.content), textStyle);
      // Miro omits `geometry.height` on a text item — its box auto-sizes to
      // its content, so only the width is authoritative — and `miroFrame`'s
      // generic 100px fallback then applied to 43% of a real board. Since Miro
      // positions by CENTRE, that fallback also pushed every label ~50px above
      // where it belonged.
      const sized =
        item.geometry?.height === undefined
          ? resizeAboutCentre(frame, estimateTextHeight(blocks, num(style.fontSize)))
          : frame;
      inits.push({
        __id,
        type: 'text',
        frame: sized,
        data: {
          blocks,
          // Middle, not the model's `'top'` default. The height above is an
          // estimate that cannot account for wrapping, and anchoring in the
          // middle spreads that error symmetrically about the point Miro
          // centred the text on instead of letting it all push downward.
          verticalAnchor: 'middle',
        },
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
            // NOT escaped, unlike the card branch below. Miro delivers a frame
            // title ALREADY HTML-escaped ("Creating Document &amp; Auth
            // Webhook"), so parsing it is what decodes it; escaping it first
            // would put the literal entity on the canvas. 35 of the reference
            // board's 145 frame titles contain one.
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
    //
    // The two ways that happens are different facts about the import and are
    // counted apart. An end with NO item id is dangling in Miro itself — 915
    // of the reference board's 1,994 connectors, and nothing on our side could
    // have kept them. An end that names an item we did not map is ours: the
    // item was an unsupported type, or fell past the import's item ceiling.
    // Folding them together made a truncated import look like a Miro problem.
    if (!startElement || !endElement) {
      bump(!startId || !endId ? 'connector-free-end' : 'connector');
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
    const stroke = miroStroke(style, CONNECTOR_STROKE_KEYS, '#000000');
    const bumpArrowhead = () => approx('arrowhead-kind');
    const startArrow = arrowheadOf(str(style.startStrokeCap), DEFAULT_START_CAP, bumpArrowhead);
    const endArrow = arrowheadOf(str(style.endStrokeCap), DEFAULT_END_CAP, bumpArrowhead);
    inits.push({
      __id: generateId(),
      type: 'connector',
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      routing: routingOf(connector.shape),
      start,
      end,
      arrowheads: {
        ...(startArrow ? { start: startArrow } : {}),
        ...(endArrow ? { end: endArrow } : {}),
      },
      ...(stroke ? { stroke } : {}),
    } as ElementInit & { __id: string });

    for (const caption of connector.captions ?? []) {
      const init = captionInit(
        caption,
        startFrame ? { frame: startFrame, siteIndex: start.siteIndex! } : undefined,
        endFrame ? { frame: endFrame, siteIndex: end.siteIndex! } : undefined,
        style,
      );
      if (init) {
        inits.push(init);
        approx('connector-caption');
      }
    }
  }

  return { inits, skipped, approximated };
}
