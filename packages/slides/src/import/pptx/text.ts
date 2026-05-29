import type { Block, BlockStyle, Inline, InlineStyle } from '@wafflebase/docs';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '@wafflebase/docs';
import { parseColorFromContainer, type ClrMap } from './color';
import { containsHangul, parsePrimaryTypeface } from './font';
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
  const { style, list } = parseParagraphProperties(pPr);

  const inlines: Inline[] = [];
  for (let i = 0; i < p.childNodes.length; i++) {
    const n = p.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.localName === 'r') inlines.push(parseRun(el, fontScale, ctx));
    else if (el.localName === 'br') inlines.push({ text: '\n', style: {} });
    else if (el.localName === 'fld') {
      // `<a:fld>` is a field (slide number, date, …). v1 dumps the
      // pre-rendered text and ignores the field semantics.
      const t = child(el, 't');
      if (t) inlines.push(parseRun(el, fontScale, ctx, textOf(t)));
    }
  }

  // Empty paragraphs need a placeholder inline so layout doesn't NaN —
  // docs's `computeLayout` requires at least one inline per block.
  if (inlines.length === 0) inlines.push({ text: '', style: {} });

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
  return block;
}

/** PPTX bullet config extracted from `<a:pPr>`. */
interface ListInfo {
  kind: 'ordered' | 'unordered';
  level: number;
}

function parseParagraphProperties(pPr: Element | undefined): {
  style: BlockStyle;
  list: ListInfo | undefined;
} {
  const style: BlockStyle = { ...DEFAULT_BLOCK_STYLE };
  if (!pPr) return { style, list: undefined };

  const algn = attr(pPr, 'algn');
  if (algn === 'ctr') style.alignment = 'center';
  else if (algn === 'r') style.alignment = 'right';
  else if (algn === 'just') style.alignment = 'justify';
  else if (algn === 'l') style.alignment = 'left';

  // Line spacing — PPTX exposes either percentage (1000ths) or absolute pts.
  const lnSpc = child(pPr, 'lnSpc');
  if (lnSpc) {
    const pct = child(lnSpc, 'spcPct');
    if (pct) {
      const v = attrInt(pct, 'val');
      if (v != null) style.lineHeight = v / 100_000;
    }
    // spcPts (absolute points) is rare; ignore for v1 — design doc says
    // docs's lineHeight is a ratio, not an absolute, so the closest
    // faithful translation is keeping the default 1.5.
  }

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
  const lvl = attrInt(pPr, 'lvl') ?? 0;
  if (child(pPr, 'buAutoNum')) list = { kind: 'ordered', level: lvl };
  else if (child(pPr, 'buChar')) list = { kind: 'unordered', level: lvl };
  // `<a:buNone/>` and absence both mean "no list" — leave list undefined.

  return { style, list };
}

function parseRun(
  r: Element,
  fontScale: number,
  ctx: TextParseContext,
  textOverride?: string,
): Inline {
  const rPr = child(r, 'rPr');
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
    if (u && u !== 'none') style.underline = true;
    if (attr(rPr, 'strike') === 'sngStrike' || attr(rPr, 'strike') === 'dblStrike') {
      style.strikethrough = true;
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

  const text = textOverride ?? textOf(child(r, 't') ?? r);

  // Korean-script fallback — only when the explicit Latin face is one of
  // the well-known Latin-only fonts that we know don't render Hangul.
  if (!style.fontFamily && containsHangul(text)) {
    style.fontFamily = 'Noto Sans KR';
  }

  return { text, style };
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
