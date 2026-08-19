/**
 * Yorkie Tree attribute codec for block-level style.
 *
 * The docs body is a Yorkie `Tree` CRDT whose element nodes carry a flat
 * `Record<string, string>` of attributes. Two writers encode it — the editor's
 * `YorkieDocStore` (`packages/frontend/src/app/docs/yorkie-doc-store.ts`) and
 * the backend's `docs-tree.ts` (the v1 content REST endpoint) — and either
 * one's output must be readable by the other's reader. That contract used to
 * be maintained by copy-paste; it lives here instead so there is exactly one
 * encoding of a block style on the wire.
 *
 * Pure data-model code: no DOM, no Yorkie import. Exported from both the
 * browser (`src/index.ts`) and Node (`src/node.ts`) entries.
 */
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_HEADER_MARGIN_FROM_EDGE,
  normalizeBlockStyle,
  type BlockStyle,
} from './types.js';

/** The alignments a block style may carry. Mirrors `BlockStyle['alignment']`. */
export const BLOCK_ALIGNMENTS: ReadonlyArray<NonNullable<BlockStyle['alignment']>> =
  ['left', 'center', 'right', 'justify'];

/**
 * Narrow an untrusted value to a paintable alignment. Anything else (a legacy
 * attribute, a hand-edited CRDT, the literal string `"undefined"` an older
 * serializer could persist) is not an alignment the layout engine can honor.
 */
export function isBlockAlignment(
  value: unknown,
): value is NonNullable<BlockStyle['alignment']> {
  return (
    typeof value === 'string' &&
    (BLOCK_ALIGNMENTS as ReadonlyArray<string>).includes(value)
  );
}

/** The numeric block-style fields persisted as Tree attributes. */
export const BLOCK_STYLE_NUMERIC_FIELDS = [
  'lineHeight',
  'marginTop',
  'marginBottom',
  'textIndent',
  'marginLeft',
] as const;

/**
 * Encode a block style as Tree attributes.
 *
 * `BlockStyle` is a full shape in the model but a *partial* on the wire: the
 * v1 content PUT API accepts `style: {}`, and older documents predate fields
 * added since. Writing an absent field unconditionally would persist
 * `alignment: undefined` and the literal string `"undefined"` for every
 * number, which the reader turns into `NaN` and the layout engine turns into
 * an unrenderable block. So each attribute is emitted only when it carries a
 * value the reader can invert: an alignment the renderer knows, and a finite
 * number for the geometry. Anything omitted falls back to
 * `DEFAULT_BLOCK_STYLE` on read, which is what an unspecified field means.
 */
export function serializeBlockStyleAttrs(
  style: Partial<BlockStyle> | undefined,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (isBlockAlignment(style?.alignment)) attrs.alignment = style.alignment;
  for (const field of BLOCK_STYLE_NUMERIC_FIELDS) {
    const raw = style?.[field];
    if (raw === undefined || raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) attrs[field] = String(value);
  }
  return attrs;
}

/**
 * Invert `serializeBlockStyleAttrs`.
 *
 * An attribute the writer above would never emit — a non-finite number, an
 * alignment outside {@link BLOCK_ALIGNMENTS} — reads as the default rather
 * than reaching the layout engine: `normalizeBlockStyle` is a bare spread and
 * would keep whatever it is handed. This also keeps the v1 REST endpoint's
 * `GET` → `PUT` identity intact, since the validator on the write side
 * rejects exactly the values dropped here.
 */
export function parseBlockStyleAttrs(
  attrs: Record<string, string> | undefined,
): BlockStyle {
  if (!attrs) return { ...DEFAULT_BLOCK_STYLE };
  const partial: Partial<BlockStyle> = {};
  if (isBlockAlignment(attrs.alignment)) partial.alignment = attrs.alignment;
  for (const field of BLOCK_STYLE_NUMERIC_FIELDS) {
    if (!(field in attrs)) continue;
    const value = Number(attrs[field]);
    if (Number.isFinite(value)) partial[field] = value;
  }
  return normalizeBlockStyle(partial);
}

/**
 * Same contract as {@link serializeBlockStyleAttrs} for the header/footer
 * `marginFromEdge` attribute: it is optional on the wire
 * (`{ header: { blocks: [] } }` is a valid PUT body), and writing it
 * unconditionally would persist the literal string `"undefined"` that the
 * reader below turns into `NaN` — an unrenderable header offset.
 */
export function serializeMarginFromEdgeAttrs(
  marginFromEdge: number | undefined,
): Record<string, string> {
  if (marginFromEdge === undefined || marginFromEdge === null) return {};
  const value = Number(marginFromEdge);
  return Number.isFinite(value) ? { marginFromEdge: String(value) } : {};
}

/**
 * Invert `serializeMarginFromEdgeAttrs`. A non-finite attribute (a legacy
 * document written before the guard above, a hand-edited CRDT) reads as
 * `DEFAULT_HEADER_MARGIN_FROM_EDGE` rather than poisoning the header layout
 * with `NaN`.
 */
export function parseMarginFromEdgeAttr(value: string | undefined): number {
  if (value === undefined) return DEFAULT_HEADER_MARGIN_FROM_EDGE;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_HEADER_MARGIN_FROM_EDGE;
}
