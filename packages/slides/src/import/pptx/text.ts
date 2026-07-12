import type { Block, BlockMarker, BlockStyle, Inline, InlineStyle } from '@wafflebase/docs';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '@wafflebase/docs';
import { parseColorFromContainer, type ClrMap } from './color';
import { parsePrimaryTypeface } from './font';
import { ImportReport } from './report';
import type { PptxRel } from './rels';
import { attr, attrInt, child, children, NS, textOf } from './xml';
import type { AutofitMode, VerticalAnchorMode } from '../../model/element';

/**
 * Per-slide context the text parser needs to resolve hyperlink relationships
 * and report autofit pre-scaling globally.
 */
export interface TextParseContext {
  /** Slide-scoped rels — used to look up `<a:hlinkClick r:id="rIdN">` targets. */
  rels?: Map<string, PptxRel>;
  report: ImportReport;
  /**
   * Fallback `fontSize` (in points) applied to any `<a:r>` whose `<a:rPr>`
   * lacks an `sz` attribute. OOXML inherits these from the master/layout
   * placeholder style chain; for the v1 importer we use a single hint
   * derived from the parent shape's `<p:ph type>` so title runs don't
   * collapse to the docs default of 11 pt.
   */
  defaultFontSize?: number;
  /** Master-level `<p:clrMap>` translation table for `<a:schemeClr>` lookups. */
  clrMap?: ClrMap;
  /**
   * Default `BlockMarker` per outline level (0–8), derived from the
   * master's `<p:txStyles>` slot that matches the host shape's
   * placeholder type. PowerPoint authors marker typeface (e.g. `Arial`)
   * exclusively here for many decks — the paragraph only inlines
   * per-slide overrides like `<a:buSzPts>` / `<a:buClr>`. When a
   * paragraph leaves a marker axis blank, the parser fills it from
   * this map before attaching the marker to the block.
   */
  markerDefaults?: Map<number, BlockMarker>;
  /**
   * Default paragraph alignment inherited from the placeholder style chain
   * (layout placeholder `<a:lstStyle><a:lvl1pPr algn>`, else the master's
   * `<p:txStyles>` slot `<a:lvl1pPr algn>`). Applied to any paragraph whose
   * own `<a:pPr>` omits `algn` — including an `<a:p>` with no `<a:pPr>` at
   * all, the common title shape. PowerPoint centers many titles only via
   * this chain; without it imported titles collapse to the docs renderer's
   * left default.
   */
  defaultAlignment?: BlockStyle['alignment'];
}

/** Map an OOXML `<a:pPr algn>` token to a docs `BlockStyle['alignment']`. */
export function mapAlgn(algn: string | undefined): BlockStyle['alignment'] | undefined {
  switch (algn) {
    case 'ctr':
      return 'center';
    case 'r':
      return 'right';
    case 'just':
      return 'justify';
    case 'l':
      return 'left';
    default:
      return undefined;
  }
}

/**
 * Map the `<a:bodyPr>` autofit child to an AutofitMode. normAutofit's
 * fontScale is still baked into run sizes by `parseTextBody` (keeping
 * imported decks visually identical); this only tags the mode so the
 * live engine re-engages once the user edits the box.
 */
export function detectAutofitMode(txBody: Element): AutofitMode {
  const bodyPr = child(txBody, 'bodyPr');
  if (!bodyPr) return 'none';
  if (child(bodyPr, 'normAutofit')) return 'shrink';
  if (child(bodyPr, 'spAutoFit')) return 'grow';
  return 'none';
}

/**
 * Map the `<a:bodyPr anchor>` attribute to a `VerticalAnchorMode`.
 *
 * OOXML anchor values:
 *   - `"t"`    → `'top'`    — content hugs the top of the frame (default)
 *   - `"ctr"`  → `'middle'` — content is vertically centred
 *   - `"b"`    → `'bottom'` — content sits at the bottom of the frame
 *   - `"just"` / `"dist"` — justify/distribute (rare, unsupported by the
 *     renderer) — fall back to `'top'` so content stays visible rather than
 *     being clipped or misplaced.
 *
 * Returns `undefined` when `<a:bodyPr>` is absent or has no `anchor`
 * attribute, preserving the pre-feature default behaviour.
 */
export function detectVerticalAnchor(txBody: Element): VerticalAnchorMode | undefined {
  const bodyPr = child(txBody, 'bodyPr');
  if (!bodyPr) return undefined;
  const anchor = attr(bodyPr, 'anchor');
  if (anchor === undefined) return undefined;
  if (anchor === '') return undefined;
  if (anchor === 'b') return 'bottom';
  if (anchor === 'ctr') return 'middle';
  // 't' is the canonical top value; unsupported values (e.g. 'just', 'dist')
  // fall back to 'top' so content remains visible.
  return 'top';
}

/**
 * OOXML default `<a:bodyPr>` insets (EMU): 0.1" left/right, 0.05" top/bottom.
 * PowerPoint applies these when the corresponding attribute is omitted; we
 * mirror that so a box that sets, say, only `lIns` stays symmetric with the
 * source rather than collapsing the unset sides to zero.
 */
const DEFAULT_INS = { l: 91_440, t: 45_720, r: 91_440, b: 45_720 } as const;

/**
 * Points → CSS px at 96 dpi. The docs layout engine renders `fontSize`
 * (points) via the same 96/72 factor, so paragraph margins derived from
 * point-valued `<a:spcBef>`/`<a:spcAft>` must use it too to scale in step
 * with the text they space.
 */
const PX_PER_PT = 96 / 72;

/**
 * Line-height multiplier for PowerPoint "single" line spacing (a paragraph
 * with no `<a:lnSpc>`). PowerPoint's single spacing includes the font's
 * natural leading, rendering at roughly 1.2× the em — so 1.0 packs text too
 * tight and the docs 1.5 word-processor default spreads it too far. Explicit
 * `<a:lnSpc>` percentages still override this per paragraph.
 */
const PPTX_SINGLE_LINE_HEIGHT = 1.2;

/**
 * Convert an `<a:spcBef>` / `<a:spcAft>` container to a px margin. Reads
 * absolute `<a:spcPts>` (hundredths of a point) only; returns `undefined`
 * when the element is absent or uses the rare percent-of-line form so the
 * caller can leave the axis at its default.
 */
function parseSpacingPx(spc: Element | undefined): number | undefined {
  if (!spc) return undefined;
  const pts = child(spc, 'spcPts');
  if (!pts) return undefined;
  const v = attrInt(pts, 'val');
  return v != null ? (v / 100) * PX_PER_PT : undefined;
}

/**
 * Read `<a:bodyPr lIns/tIns/rIns/bIns>` and convert EMU → deck-canvas px via
 * the per-axis scale (horizontal insets use `sx`, vertical use `sy`), exactly
 * like table-cell padding. Returns `undefined` when `<a:bodyPr>` declares no
 * inset attribute at all — leaving the box on the renderer's per-kind default
 * so plain imported text boxes are unaffected. When at least one inset is
 * present, absent sides are filled with the OOXML defaults above.
 */
export function detectBodyInset(
  txBody: Element,
  scale: { sx: number; sy: number },
): { left: number; top: number; right: number; bottom: number } | undefined {
  const bodyPr = child(txBody, 'bodyPr');
  if (!bodyPr) return undefined;
  const l = attrInt(bodyPr, 'lIns');
  const t = attrInt(bodyPr, 'tIns');
  const r = attrInt(bodyPr, 'rIns');
  const b = attrInt(bodyPr, 'bIns');
  if (l == null && t == null && r == null && b == null) return undefined;
  return {
    left: (l ?? DEFAULT_INS.l) * scale.sx,
    top: (t ?? DEFAULT_INS.t) * scale.sy,
    right: (r ?? DEFAULT_INS.r) * scale.sx,
    bottom: (b ?? DEFAULT_INS.b) * scale.sy,
  };
}

/**
 * Parse `<p:txBody>` into a docs `Block[]`.
 *
 * Honors `<a:bodyPr><a:normAutofit fontScale=...>`: each run's `fontSize`
 * is pre-multiplied by `fontScale / 100000` so the rendered output
 * approximates the source. This is lossy (we don't auto-re-fit on
 * resize), but acceptable for v1 — see the design doc's "re-validated
 * gap" section.
 */
export function parseTextBody(txBody: Element, ctx: TextParseContext): Block[] {
  let fontScale = 1;
  const bodyPr = child(txBody, 'bodyPr');
  if (bodyPr) {
    const autofit = child(bodyPr, 'normAutofit');
    if (autofit) {
      const raw = attrInt(autofit, 'fontScale');
      if (raw != null && raw > 0 && raw !== 100_000) {
        fontScale = raw / 100_000;
        ctx.report.textBoxesPreScaled += 1;
      }
    }
  }

  const paragraphs = children(txBody, 'p');
  if (paragraphs.length === 0) return [emptyBlock()];

  return paragraphs.map((p) => parseParagraph(p, fontScale, ctx));
}

function parseParagraph(
  p: Element,
  fontScale: number,
  ctx: TextParseContext,
): Block {
  const pPr = child(p, 'pPr');
  const { style, list, marker } = parseParagraphProperties(pPr, ctx);

  const inlines: Inline[] = [];
  // Font size of the most recent real run — a bare `<a:br/>` inherits it so
  // the break line matches the surrounding text (PowerPoint sizes the break
  // from the adjacent run's formatting).
  let lastRunFontSize: number | undefined;
  for (let i = 0; i < p.childNodes.length; i++) {
    const n = p.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.localName === 'r') {
      const inline = parseRun(el, fontScale, ctx);
      inlines.push(inline);
      if (inline.style.fontSize != null) lastRunFontSize = inline.style.fontSize;
    } else if (el.localName === 'br') {
      // `<a:br>` carries its own `<a:rPr>` (font size, weight, …). Lift it
      // onto the soft-break inline so the blank/broken line is sized to the
      // surrounding text — a bare `{}` style would fall back to the docs
      // default (11 pt) and drop the newline visibly too far below small text.
      // When the break has no explicit size, inherit the preceding run's.
      const style = parseRunStyle(child(el, 'rPr'), fontScale, ctx);
      if (style.fontSize == null && lastRunFontSize != null) style.fontSize = lastRunFontSize;
      inlines.push({ text: '\n', style });
    } else if (el.localName === 'fld') {
      // `<a:fld>` is a field (slide number, date, …). v1 dumps the
      // pre-rendered text and ignores the field semantics.
      const t = child(el, 't');
      if (t) inlines.push(parseRun(el, fontScale, ctx, textOf(t)));
    }
  }

  // A blank paragraph — no runs at all, or only empty `<a:t/>` runs — is one
  // empty visual line that still needs a height. Collapse it to a single
  // placeholder (docs's `computeLayout` needs at least one inline per block)
  // and give it a font size, else the line falls back to the docs default
  // (11 pt) and opens a gap that's too large next to small-point body text.
  // Prefer a size an empty run already carries — this is what an exported
  // blank line round-trips as (`<a:r sz=…/>` with no `<a:endParaRPr>`), so
  // reading only endParaRPr here would drop the size on the second import.
  // Otherwise fall back to `<a:endParaRPr>`, the paragraph-mark run PowerPoint
  // uses to size a blank line. Paragraphs holding a `<a:br>` newline keep
  // their own already-sized inlines and are untouched here.
  if (!inlines.some((i) => i.text !== '')) {
    const sized = inlines.find((i) => i.style.fontSize != null);
    const style = sized
      ? sized.style
      : parseRunStyle(child(p, 'endParaRPr'), fontScale, ctx);
    inlines.length = 0;
    inlines.push({ text: '', style });
  }

  const block: Block = {
    id: generateBlockId(),
    type: list ? 'list-item' : 'paragraph',
    inlines,
    style,
  };
  if (list) {
    block.listKind = list.kind;
    block.listLevel = list.level;
  }
  // Marker style is only meaningful on list-items. Persist it only when
  // the paragraph is a list so non-list blocks don't carry a dead field
  // through Yorkie/snapshots.
  if (list && marker) {
    block.marker = marker;
  }
  return block;
}

/** PPTX bullet config extracted from `<a:pPr>`. */
interface ListInfo {
  kind: 'ordered' | 'unordered';
  level: number;
}

function parseParagraphProperties(
  pPr: Element | undefined,
  ctx: TextParseContext,
): {
  style: BlockStyle;
  list: ListInfo | undefined;
  marker: BlockMarker | undefined;
} {
  // PPTX paragraphs carry no implicit inter-paragraph gap, and their
  // default line spacing is PowerPoint "single" — which renders at ~1.2×
  // the font size (it folds in the font's natural leading), NOT 1.0.
  // `DEFAULT_BLOCK_STYLE` is the docs *word-processor* default (1.5 line
  // height, 8 px bottom margin); inheriting it made every imported line
  // 25 % too tall and injected an 8 px gap the source never asked for —
  // visible as over-wide blank lines. But 1.0 is the opposite error: it
  // strips the leading and packs body text too tight. Reset to the PPTX
  // single-spacing defaults, then layer on whatever the deck specifies.
  const style: BlockStyle = {
    ...DEFAULT_BLOCK_STYLE,
    lineHeight: PPTX_SINGLE_LINE_HEIGHT,
    marginTop: 0,
    marginBottom: 0,
  };
  // Alignment inherits through the placeholder style chain: a paragraph
  // (or an `<a:p>` with no `<a:pPr>` at all) that omits `algn` falls back to
  // the layout/master default the caller resolved. That default comes from
  // the placeholder's level-1 properties, so it applies only to level-0
  // paragraphs; deeper bullets (lvl 1+) keep their own left default rather
  // than inheriting the level-1 alignment.
  const level = pPr ? (attrInt(pPr, 'lvl') ?? 0) : 0;
  if (level === 0 && ctx.defaultAlignment) style.alignment = ctx.defaultAlignment;
  if (!pPr) return { style, list: undefined, marker: undefined };

  const algn = mapAlgn(attr(pPr, 'algn'));
  if (algn) style.alignment = algn;

  // Line spacing — PPTX exposes either percentage (1000ths) or absolute pts.
  const lnSpc = child(pPr, 'lnSpc');
  if (lnSpc) {
    const pct = child(lnSpc, 'spcPct');
    if (pct) {
      const v = attrInt(pct, 'val');
      if (v != null) style.lineHeight = v / 100_000;
    }
    // spcPts (absolute points) is rare; ignore for v1 — docs's lineHeight is
    // a ratio, not an absolute, so the closest faithful translation is
    // keeping the single-spacing default.
  }

  // Paragraph spacing — `<a:spcBef>`/`<a:spcAft>` map to the block's top /
  // bottom margins. Reading these is also what stops a source `spcAft="0"`
  // from silently keeping the docs 8 px default. Absolute `<a:spcPts>` is the
  // common form and the only one docs px margins can represent faithfully;
  // `<a:spcPct>` (percent of a line) is rare and skipped.
  const before = parseSpacingPx(child(pPr, 'spcBef'));
  if (before != null) style.marginTop = before;
  const after = parseSpacingPx(child(pPr, 'spcAft'));
  if (after != null) style.marginBottom = after;

  // Indent / left margin — PPTX values are in EMU; docs values are px.
  // We don't have the slide scale at parse time, so we approximate with
  // the EMU→px ratio at 96 dpi (914400 EMU/in ÷ 96 px/in = 9525 EMU/px).
  // Sufficient for outline indentation; precise placement is bounded by
  // the text box anyway.
  const marL = attrInt(pPr, 'marL');
  if (marL != null) style.marginLeft = Math.round(marL / 9525);
  const indent = attrInt(pPr, 'indent');
  if (indent != null) style.textIndent = Math.round(indent / 9525);

  let list: ListInfo | undefined;
  if (child(pPr, 'buAutoNum')) list = { kind: 'ordered', level };
  else if (child(pPr, 'buChar')) list = { kind: 'unordered', level };
  // `<a:buNone/>` and absence both mean "no list" — leave list undefined.

  // Paragraph-level bullet style. PowerPoint applies these to the marker
  // glyph independent of the run's font / size / color, so the marker
  // stays consistent even when the first run is wrapped in a different
  // font (e.g. Korean-Hangul fallback). `<a:buSzPct>` (percentage of the
  // run font size) is not yet supported — none of the benchmark decks
  // emit it. The marker only matters for list items, so callers gate
  // attaching it to the block on `list !== undefined`.
  //
  // Inheritance: PPTX paragraphs commonly omit one or more bullet axes
  // (e.g. `<a:buFont>` lives only in the master's `<p:txStyles>` while
  // the paragraph inlines just `<a:buSzPts>`/`<a:buClr>` overrides).
  // Merge the master defaults for this level *under* the paragraph's
  // own values so the paragraph wins per-axis when it sets one.
  const paragraphMarker = parseBulletStyle(pPr, ctx);
  const levelDefault = ctx.markerDefaults?.get(level);
  const marker = mergeMarkers(levelDefault, paragraphMarker);

  return { style, list, marker };
}

function mergeMarkers(
  base: BlockMarker | undefined,
  overrides: BlockMarker | undefined,
): BlockMarker | undefined {
  // Always return a fresh shallow-cloned object even in the single-input
  // path. `base` is the master-level `markerDefaults` map entry shared
  // across every paragraph that resolves to the same slot × level, so
  // handing the reference back to the caller would let a downstream
  // mutation on `block.marker` (clearFormatting, theme remap, …) leak
  // back into the master and silently corrupt every other list-item
  // that uses that default. The alloc cost is one small object per
  // list paragraph — negligible against the layout / paint work that
  // follows.
  if (!base && !overrides) return undefined;
  if (!base) return { ...overrides! };
  if (!overrides) return { ...base };
  const out: BlockMarker = {};
  const fontFamily = overrides.fontFamily ?? base.fontFamily;
  const fontSize = overrides.fontSize ?? base.fontSize;
  const color = overrides.color ?? base.color;
  if (fontFamily !== undefined) out.fontFamily = fontFamily;
  if (fontSize !== undefined) out.fontSize = fontSize;
  if (color !== undefined) out.color = color;
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseBulletStyle(
  pPr: Element,
  ctx: TextParseContext,
): BlockMarker | undefined {
  let marker: BlockMarker | undefined;

  const buFont = child(pPr, 'buFont');
  if (buFont) {
    const typeface = attr(buFont, 'typeface');
    if (typeface) marker = { ...(marker ?? {}), fontFamily: typeface };
  }

  const buSzPts = child(pPr, 'buSzPts');
  if (buSzPts) {
    // `val` is in hundredths of a point per OOXML.
    const v = attrInt(buSzPts, 'val');
    if (v != null && v > 0) marker = { ...(marker ?? {}), fontSize: v / 100 };
  }

  const buClr = child(pPr, 'buClr');
  if (buClr) {
    const color = parseColorFromContainer(buClr, ctx.clrMap);
    if (color) marker = { ...(marker ?? {}), color };
  }

  return marker;
}

function parseRun(
  r: Element,
  fontScale: number,
  ctx: TextParseContext,
  textOverride?: string,
): Inline {
  const style = parseRunStyle(child(r, 'rPr'), fontScale, ctx);
  const text = textOverride ?? textOf(child(r, 't') ?? r);

  // No script-specific fontFamily override here. The renderer
  // (`@wafflebase/docs` `resolveFontFamily`) splices a Korean-capable
  // family into every non-monospace fallback chain, so the browser picks
  // a Hangul face per-glyph even when this run's typeface (e.g. Arial or
  // a brand font we don't have) carries no Korean glyphs.

  return { text, style };
}

/**
 * Parse an `<a:rPr>`-shaped element into an `InlineStyle`.
 *
 * The element is the run-property container itself: `<a:rPr>` for a run,
 * the `<a:rPr>` child of an `<a:br>`, or the paragraph's `<a:endParaRPr>`
 * (whose attributes/children mirror `<a:rPr>` exactly). Sharing this path
 * is what lets line breaks and empty paragraphs carry their real font
 * size instead of collapsing to the docs default — a blank line sized at
 * 11 pt next to 8 pt body text is what makes an imported `<a:br>` drop
 * visibly too far.
 */
/**
 * Collapse an OOXML `@u` underline value (17 possible) to the
 * representative `InlineStyle.underlineStyle` set. `sng` (and anything
 * unrecognised) returns `undefined` so it renders as the default single
 * line without storing a redundant value.
 */
function mapUnderlineStyle(u: string): InlineStyle['underlineStyle'] {
  if (u === 'dbl') return 'double';
  if (u === 'heavy') return 'heavy';
  if (u.startsWith('dotted')) return 'dotted';
  if (u.startsWith('wavy')) return 'wavy';
  if (u.startsWith('dash') || u.startsWith('dotDash') || u.startsWith('dotDotDash')) {
    return 'dashed';
  }
  return undefined; // sng, or an unmapped value → default single
}

function parseRunStyle(
  rPr: Element | undefined,
  fontScale: number,
  ctx: TextParseContext,
): InlineStyle {
  const style: InlineStyle = {};

  // Apply placeholder-derived default first so an explicit `sz` below
  // can override it.
  if (ctx.defaultFontSize != null) {
    style.fontSize = ctx.defaultFontSize * fontScale;
  }

  if (rPr) {
    if (attr(rPr, 'b') === '1') style.bold = true;
    if (attr(rPr, 'i') === '1') style.italic = true;
    const u = attr(rPr, 'u');
    if (u && u !== 'none') {
      style.underline = true;
      const us = mapUnderlineStyle(u);
      if (us) style.underlineStyle = us;
      // <a:uFill><a:solidFill>… → underlineColor.
      const uFill = child(rPr, 'uFill');
      const uSolid = uFill ? child(uFill, 'solidFill') : undefined;
      if (uSolid) {
        const uc = parseColorFromContainer(uSolid, ctx.clrMap);
        if (uc) style.underlineColor = uc;
      }
    }
    const strike = attr(rPr, 'strike');
    if (strike === 'sngStrike' || strike === 'dblStrike') {
      style.strikethrough = true;
      if (strike === 'dblStrike') style.strikeStyle = 'double';
    }
    // baseline -> super/subscript. PPTX stores as 1000ths of a percent.
    const baseline = attrInt(rPr, 'baseline');
    if (baseline != null) {
      if (baseline > 0) style.superscript = true;
      else if (baseline < 0) style.subscript = true;
    }

    const sz = attrInt(rPr, 'sz');
    if (sz != null) style.fontSize = (sz / 100) * fontScale;

    // Font family — Latin face wins. East Asian fallback kicks in at
    // run text inspection time below.
    const face = parsePrimaryTypeface(rPr);
    if (face) style.fontFamily = face;

    const solidFill = child(rPr, 'solidFill');
    if (solidFill) {
      const color = parseColorFromContainer(solidFill, ctx.clrMap);
      if (color) style.color = color;
    }

    // Text highlight (`<a:highlight>` — a:solidFill-like container).
    const highlight = child(rPr, 'highlight');
    if (highlight) {
      const bg = parseColorFromContainer(highlight, ctx.clrMap);
      if (bg) style.backgroundColor = bg;
    }

    // Hyperlink — `r:id` is namespaced; some DOMParsers expose it
    // through `getAttributeNS`, others only via the literal `r:id` form.
    // Try both.
    const hlink = child(rPr, 'hlinkClick');
    if (hlink) {
      const rid =
        hlink.getAttributeNS(NS.R, 'id') || hlink.getAttribute('r:id') || undefined;
      const rel = rid ? ctx.rels?.get(rid) : undefined;
      // Only forward *external* http/https links. Internal slide-jump
      // rels (e.g. `Type=".../slide" Target="slide3.xml"`) are not
      // representable in docs `Inline.style.href`, and untrusted PPTX
      // can embed `javascript:` / `data:` schemes as an XSS vector.
      if (rel?.external && rel.target && isSafeHref(rel.target)) {
        style.href = rel.target;
      }
    }
  }

  return style;
}

/**
 * Allowlist of URL schemes safe to forward as `Inline.style.href`.
 * Everything else (javascript:, data:, vbscript:, file:, ...) is
 * dropped — PPTX is an untrusted format and the docs renderer turns
 * any non-empty `href` into a click target.
 */
function isSafeHref(target: string): boolean {
  // Relative or protocol-relative URLs are safe (they resolve under
  // the host's own origin).
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) return true;
  if (/^mailto:/i.test(target)) return true;
  if (/^https?:/i.test(target)) return true;
  return false;
}

function emptyBlock(): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text: '', style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}
