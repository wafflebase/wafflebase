import {
  LIST_INDENT_PX,
  type Block,
  type BlockCellInfo,
  type Inline,
  type InlineStyle,
} from '../model/types.js';
import {
  blockStyleId,
  resolveStyleInline,
  type DocStyles,
} from '../model/named-styles.js';
import { Theme, ptToPx } from './theme.js';
import type { ResolvedFont, TextMeasurer } from './measurer.js';
import { computeTableLayout, type LayoutTable } from './table-layout.js';

/**
 * Stable string key for a `ResolvedFont`. Used as the prefix of the
 * `measureCache` key — same shape as the old CSS shorthand so cache
 * keys remain readable when debugging.
 */
function fontKey(font: ResolvedFont): string {
  return `${font.style}|${font.weight}|${font.size}|${font.family}|${font.letterSpacing ?? 0}`;
}

/**
 * Per-measurer width cache. Each `TextMeasurer` instance gets its own
 * `Map<fontKey|text, width>` so two measurers (e.g., Canvas + fontkit
 * in tests or a future SSR path) cannot pollute each other's results.
 *
 * A `WeakMap` keyed by the measurer reference means an unused measurer
 * is garbage-collected without explicit cleanup. `clearMeasureCache`
 * still works globally — we keep a separate registry of every
 * per-measurer Map so we can drain them all at once.
 */
const perMeasurerCache = new WeakMap<TextMeasurer, Map<string, number>>();
const perMeasurerOffsetCache = new WeakMap<TextMeasurer, Map<string, number[]>>();
// Tracks every per-measurer Map we've handed out so `clearMeasureCache` can
// drain them all (a WeakMap is not iterable). Both the width cache and the
// char-offset cache register here.
const knownCaches = new Set<{ clear(): void }>();

function cacheFor(measurer: TextMeasurer): Map<string, number> {
  let cache = perMeasurerCache.get(measurer);
  if (!cache) {
    cache = new Map<string, number>();
    perMeasurerCache.set(measurer, cache);
    knownCaches.add(cache);
  }
  return cache;
}

function offsetCacheFor(measurer: TextMeasurer): Map<string, number[]> {
  let cache = perMeasurerOffsetCache.get(measurer);
  if (!cache) {
    cache = new Map<string, number[]>();
    perMeasurerOffsetCache.set(measurer, cache);
    knownCaches.add(cache);
  }
  return cache;
}

export function cachedMeasureText(
  measurer: TextMeasurer,
  text: string,
  font: ResolvedFont,
): number {
  const cache = cacheFor(measurer);
  const key = `${fontKey(font)}\t${text}`;
  let width = cache.get(key);
  if (width === undefined) {
    width = measurer.measureWidth(text, font);
    cache.set(key, width);
  }
  return width;
}

export function clearMeasureCache(): void {
  // Drain every known per-measurer cache. We can't iterate the WeakMap,
  // so the parallel `knownCaches` set tracks each Map we've handed out.
  for (const cache of knownCaches) {
    cache.clear();
  }
}

/**
 * Release a measurer's caches entirely. `clearMeasureCache` only empties the
 * maps; the `knownCaches` set still strongly references them, so without this
 * a per-editor measurer's cache maps would live for the module's lifetime —
 * one leaked pair per disposed editor. Call from a host's dispose path.
 */
export function disposeMeasureCache(measurer: TextMeasurer): void {
  const width = perMeasurerCache.get(measurer);
  if (width) {
    knownCaches.delete(width);
    perMeasurerCache.delete(measurer);
  }
  const offsets = perMeasurerOffsetCache.get(measurer);
  if (offsets) {
    knownCaches.delete(offsets);
    perMeasurerOffsetCache.delete(measurer);
  }
}

/**
 * Convert an `InlineStyle` into the `ResolvedFont` measurement structure
 * used by `TextMeasurer`. Centralised here so layout, table-layout, and
 * hit-testing share the same conversion rules — getting these
 * inconsistent quietly miscalculates line widths.
 *
 * Sup/sub runs measure at 60% of the inline's font size. The flag is
 * derived from the style so callers cannot forget to pass it (header
 * and footer hit-test paths used to omit it, silently measuring
 * superscript text at full size). The pt-based fontSize is converted
 * to pixels via `ptToPx`.
 */
export function resolveInlineFont(style: InlineStyle): ResolvedFont {
  const isSuperOrSub = !!(style.superscript || style.subscript);
  const baseSizePt = style.fontSize ?? Theme.defaultFontSize;
  const sizePt = isSuperOrSub ? baseSizePt * 0.6 : baseSizePt;
  // `family` stays the raw face name (not the resolved CSS chain). Each
  // measurer applies its own resolution: CanvasTextMeasurer routes
  // through `resolveFontFamily` at `fontToCss` time so the Korean
  // fallback splice lands in `ctx.font`; FontkitMeasurer (CLI) keys its
  // font cache on the raw family for direct hits against the registered
  // face. Carrying the chain here would break the CLI cache lookup and
  // bloat the measureCache fontKey.
  const resolved: ResolvedFont = {
    family: style.fontFamily ?? Theme.defaultFontFamily,
    size: ptToPx(sizePt),
    weight: style.bold ? 'bold' : 'normal',
    style: style.italic ? 'italic' : 'normal',
  };
  // Letter spacing is stored in points; convert to px for measurement/paint.
  // Sup/sub runs scale their spacing with the 60% font size too.
  if (style.letterSpacing) {
    resolved.letterSpacing = ptToPx(isSuperOrSub ? style.letterSpacing * 0.6 : style.letterSpacing);
  }
  return resolved;
}

/**
 * Return a block's inlines with its named-style inline defaults merged in as
 * a base layer; explicit inline styles override them. The style's definition
 * comes from the document `docStyles` registry (falling back to the built-in
 * defaults), so a redefined style reflows every block using it without any
 * stored-inline rewrite.
 */
export function resolveBlockInlines(block: Block, docStyles?: DocStyles): Inline[] {
  const defaults = resolveStyleInline(blockStyleId(block), docStyles);
  if (Object.keys(defaults).length === 0) {
    return block.inlines;
  }
  return block.inlines.map((inline) => ({
    text: inline.text,
    style: { ...defaults, ...inline.style },
  }));
}

/**
 * A measured run of text within a line.
 */
export interface LayoutRun {
  inline: Inline;
  text: string;
  x: number;
  width: number;
  inlineIndex: number;
  charStart: number;
  charEnd: number;
  /** Cumulative pixel widths: charOffsets[i] = width of text.slice(0, i+1). Length === text.length. */
  charOffsets: number[];
  /**
   * For image inlines, the pixel height of the (possibly scaled) image.
   * Line height must grow to accommodate this. Undefined for text runs.
   */
  imageHeight?: number;
}

/**
 * A wrapped line within a block.
 */
export interface LayoutLine {
  runs: LayoutRun[];
  y: number;
  height: number;
  width: number;
  nestedTable?: LayoutTable;
}

/**
 * A positioned block in the document layout.
 */
export interface LayoutBlock {
  block: Block;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: LayoutLine[];
  layoutTable?: LayoutTable;
}

/**
 * Full document layout result.
 */
export interface DocumentLayout {
  blocks: LayoutBlock[];
  totalHeight: number;
  blockParentMap: Map<string, BlockCellInfo>;
}

/**
 * Cache of per-block layout results for incremental recomputation.
 */
export interface LayoutCache {
  blocks: Map<string, LayoutBlock>;
  contentWidth: number;
  /**
   * Fingerprint of the named-style registry the cached lines were resolved
   * against. A named-style redefinition changes the inline defaults baked into
   * cached runs without dirtying any block, so the cache must invalidate when
   * this changes (the editor also calls `invalidateLayout`, but this keeps the
   * function self-consistent for any caller that reuses a cache).
   */
  docStylesKey?: string;
}

/**
 * View-local IME composing text to splice into one block's layout.
 *
 * During IME composition the interim text is *not* written to the
 * document model (so it produces no Yorkie undo unit — see
 * `docs/design/docs/docs-ime-undo-history.md`). Instead it is injected
 * here as a synthetic inline at `offset`, so wrapping / following-text
 * reflow and caret placement stay correct while the model is untouched.
 * It lives only inside the layout pass and is never persisted.
 */
export interface ComposingContext {
  blockId: string;
  /** Character offset within the block where composing text sits. */
  offset: number;
  /** The view-local composing string (empty string = nothing to inject). */
  text: string;
}

/**
 * Splice `text` into `inlines` at character `offset`, inheriting the
 * style at the insertion point (left-biased at an inline boundary, the
 * same rule newly typed text follows). Returns a new array; the inputs
 * are not mutated. Used to render IME composing text view-locally.
 */
export function injectComposingInline(
  inlines: Inline[],
  offset: number,
  text: string,
): Inline[] {
  if (text.length === 0) return inlines;

  const result: Inline[] = [];
  let pos = 0;
  let inserted = false;

  for (const inline of inlines) {
    const len = inline.text.length;
    if (!inserted && offset <= pos + len) {
      const localOffset = offset - pos;
      const before = inline.text.slice(0, localOffset);
      const after = inline.text.slice(localOffset);
      if (before.length > 0) result.push({ ...inline, text: before });
      result.push({ text, style: composingStyleFrom(inline.style) });
      if (after.length > 0) result.push({ ...inline, text: after });
      inserted = true;
    } else {
      result.push(inline);
    }
    pos += len;
  }

  if (!inserted) {
    // Offset at/after the end, or an empty block: append, inheriting the
    // trailing inline's style when there is one.
    const style = inlines.length > 0 ? inlines[inlines.length - 1].style : {};
    result.push({ text, style: composingStyleFrom(style) });
  }

  return result;
}

/**
 * Inherit only the *visual* (text) style for a composing run. Structural
 * metadata — `image` (Object Replacement placeholder) and `pageNumber` —
 * must be dropped: otherwise composing right after an image inline would
 * make `measureSegments` treat the typed preview as an image rather than
 * text, breaking IME layout at image / page-number boundaries.
 */
function composingStyleFrom(style: InlineStyle): InlineStyle {
  const { image: _image, pageNumber: _pageNumber, ...textStyle } = style;
  return textStyle;
}

/**
 * A segment of text with uniform style, ready for measurement.
 * Tracks which inline it came from and character offsets.
 */
interface MeasuredSegment {
  text: string;
  style: InlineStyle;
  width: number;
  inlineIndex: number;
  charStart: number;
  charEnd: number;
  font: ResolvedFont;
  /**
   * Intrinsic image dimensions for image inlines. When present, this segment
   * is treated as unbreakable and rendered as an image run. Width is the
   * intrinsic pixel width (pre-scale); rendering may scale down to fit.
   */
  image?: { width: number; height: number };
  /**
   * Soft line break (`\n` in inline text). Word-processor "Shift+Enter":
   * forces a line wrap inside the current block without splitting the
   * paragraph. The segment's `text` is `'\n'`, `width` is `0`, and
   * `layoutBlock` appends a zero-width run for it (so cursor offsets stay
   * valid) and then flushes the line. The PPTX importer translates
   * `<a:br/>` to a `\n` inline; this flag is also a natural fit for a
   * future Shift+Enter editor binding.
   */
  softBreak?: true;
}

/**
 * Compute the full document layout.
 *
 * When `dirtyBlockIds` and `cache` are provided, only blocks whose IDs
 * appear in the dirty set are re-laid-out; cached line/run data is reused
 * for the rest. Y offsets are always recalculated for every block.
 */
export function computeLayout(
  blocks: Block[],
  measurer: TextMeasurer,
  contentWidth: number,
  dirtyBlockIds?: Set<string>,
  cache?: LayoutCache,
  composingContext?: ComposingContext,
  docStyles?: DocStyles,
): { layout: DocumentLayout; cache: LayoutCache } {
  const availableWidth = contentWidth;
  const docStylesKey = JSON.stringify(docStyles ?? {});
  const canUseCache = cache != null
    && dirtyBlockIds != null
    && cache.contentWidth === contentWidth
    && cache.docStylesKey === docStylesKey;

  const newCacheBlocks = new Map<string, LayoutBlock>();
  const layoutBlocks: LayoutBlock[] = [];
  const blockParentMap = new Map<string, BlockCellInfo>();
  let y = 0;

  for (const block of blocks) {
    y += block.style.marginTop;

    // Apply list indent for list items
    let effectiveBlock = block;
    if (block.type === 'list-item') {
      const listIndent = LIST_INDENT_PX * ((block.listLevel ?? 0) + 1);
      effectiveBlock = {
        ...block,
        style: {
          ...block.style,
          marginLeft: (block.style.marginLeft ?? 0) + listIndent,
        },
      };
    }

    let lines: LayoutLine[];

    if (block.type === 'table' && block.tableData) {
      const tableLayout = computeTableLayout(
        block.tableData, block.id, measurer, availableWidth, composingContext, docStyles,
      );
      // Merge per-table blockParentMap into document-level map
      for (const [k, v] of tableLayout.blockParentMap) {
        blockParentMap.set(k, v);
      }
      lines = [{ runs: [], y: 0, height: tableLayout.totalHeight, width: availableWidth }];
      const lb: LayoutBlock = {
        block,
        x: 0,
        y,
        width: availableWidth,
        height: tableLayout.totalHeight,
        lines,
        layoutTable: tableLayout,
      };
      layoutBlocks.push(lb);
      newCacheBlocks.set(block.id, lb);
      y += tableLayout.totalHeight + block.style.marginBottom;
      continue;
    }

    if (block.type === 'horizontal-rule' || block.type === 'page-break') {
      const HR_HEIGHT = 20;
      lines = [{ runs: [], y: 0, height: HR_HEIGHT, width: availableWidth }];
    } else if (canUseCache && !dirtyBlockIds!.has(block.id) && cache!.blocks.has(block.id)) {
      lines = cache!.blocks.get(block.id)!.lines;
    } else {
      lines = layoutBlock(effectiveBlock, measurer, availableWidth, composingContext, docStyles);
      assignLineHeights(lines, effectiveBlock, docStyles);

      const alignWidth = availableWidth - effectiveBlock.style.marginLeft;
      for (let li = 0; li < lines.length; li++) {
        applyAlignment(lines[li], alignWidth, effectiveBlock.style.alignment, li === lines.length - 1);
      }
    }

    const blockHeight = lines.reduce((sum, l) => sum + l.height, 0);
    const lb: LayoutBlock = {
      block,
      x: 0,
      y,
      width: availableWidth,
      height: blockHeight,
      lines,
    };

    layoutBlocks.push(lb);
    newCacheBlocks.set(block.id, lb);
    y += blockHeight + block.style.marginBottom;
  }

  return {
    layout: { blocks: layoutBlocks, totalHeight: y, blockParentMap },
    cache: { blocks: newCacheBlocks, contentWidth, docStylesKey },
  };
}

/**
 * Compute cumulative character pixel offsets for a run.
 * charOffsets[i] = width of text.slice(0, i + 1).
 *
 * Measured as growing prefixes (not a sum of per-char widths) so kerning and
 * ligatures stay correct. The whole array is memoised per (measurer, font,
 * text): re-laying-out unchanged content — every structural edit, remote
 * change, undo/redo, and resize triggers a full recompute — then costs no
 * canvas measurements. The offsets depend only on font + text, not on layout
 * width, so the cache survives width changes too.
 *
 * The returned array is shared with the cache; callers store it in
 * `LayoutRun.charOffsets` and must treat it as read-only.
 */
export function computeCharOffsets(
  measurer: TextMeasurer,
  text: string,
  font: ResolvedFont,
): number[] {
  if (text.length === 0) return [];
  const cache = offsetCacheFor(measurer);
  const key = `${fontKey(font)}\t${text}`;
  let offsets = cache.get(key);
  if (offsets === undefined) {
    offsets = new Array<number>(text.length);
    for (let i = 0; i < text.length; i++) {
      offsets[i] = measurer.measureWidth(text.slice(0, i + 1), font);
    }
    cache.set(key, offsets);
  }
  return offsets;
}

/**
 * Pixel x of a caret `localOffset` characters into a run, from the run's left
 * edge. Reuses the run's precomputed cumulative `charOffsets`
 * (charOffsets[i] = width of the first i+1 chars) instead of re-measuring
 * `run.text.slice(0, localOffset)` — the same value with no canvas call, so
 * caret and selection painting stays measurement-free every frame.
 *
 * `measurer` is only consulted on the fallback path — a run that somehow
 * lacks a matching offset entry — so callers keep exactly the correctness
 * they had before this optimization. Image runs are resolved by callers
 * (they map the offset to the display width); pass only text runs here.
 */
export function caretOffsetX(
  run: LayoutRun,
  localOffset: number,
  measurer: TextMeasurer,
): number {
  if (localOffset <= 0) return 0;
  const offsets = run.charOffsets;
  if (offsets.length >= localOffset) {
    return offsets[localOffset - 1];
  }
  return measurer.measureWidth(
    run.text.slice(0, localOffset),
    resolveInlineFont(run.inline.style),
  );
}

/**
 * Layout a single block into wrapped lines.
 */
export function layoutBlock(
  block: Block,
  measurer: TextMeasurer,
  maxWidth: number,
  composingContext?: ComposingContext,
  docStyles?: DocStyles,
): LayoutLine[] {
  // Resolve named-style inline defaults into inlines before measurement
  const resolved = resolveBlockInlines(block, docStyles);
  // Splice in view-local IME composing text for this block, if any, so it
  // reflows like real text without being written to the document model.
  const inlines = composingContext?.blockId === block.id
    ? injectComposingInline(resolved, composingContext.offset, composingContext.text)
    : resolved;
  // Measure all segments (word-level)
  const segments = measureSegments(inlines, measurer);

  if (segments.length === 0) {
    // Empty block — one empty line
    return [{ runs: [], y: 0, height: 0, width: 0 }];
  }

  const marginLeft = block.style.marginLeft ?? 0;
  const textIndent = block.style.textIndent ?? 0;

  // Word-wrap into lines
  const lines: LayoutLine[] = [];
  let currentRuns: LayoutRun[] = [];
  let lineWidth = 0;
  let lineStartX = marginLeft + textIndent;
  let effectiveWidth = maxWidth - marginLeft - textIndent;

  const flushLine = () => {
    lines.push({
      runs: currentRuns,
      y: 0,
      height: 0,
      width: lineWidth,
    });
    currentRuns = [];
    lineWidth = 0;
    lineStartX = marginLeft;
    effectiveWidth = maxWidth - marginLeft;
  };

  // Tracks whether the most recent segment was a soft line break. A
  // trailing `\n` should produce an empty visual line after the
  // content so the cursor can sit on it (PowerPoint's Shift+Enter
  // behavior). Without this, a block of just `"abc\n"` would render
  // as one line and lose the empty trailing line.
  let lastWasSoftBreak = false;

  for (const seg of segments) {
    // Soft line break (`\n`): append a zero-width run for the `\n` so
    // cursor / selection offsets remain valid (a click at end-of-line
    // hits the `\n` run instead of falling off the end), then flush the
    // line. Two consecutive `\n`s therefore produce one fully empty
    // visual line between content lines — exactly PowerPoint's
    // `<a:br/><a:br/>` rendering. `flushLine` already resets
    // `lineStartX`/`effectiveWidth` to drop `textIndent`, which is
    // first-line only.
    if (seg.softBreak) {
      currentRuns.push({
        inline: inlines[seg.inlineIndex],
        text: '\n',
        x: lineStartX + lineWidth,
        width: 0,
        inlineIndex: seg.inlineIndex,
        charStart: seg.charStart,
        charEnd: seg.charEnd,
        charOffsets: [0],
      });
      flushLine();
      lastWasSoftBreak = true;
      continue;
    }
    lastWasSoftBreak = false;
    // Image segments are unbreakable. Scale down to fit the effective line
    // width if necessary, then emit a single run carrying the image height.
    if (seg.image) {
      let displayWidth = seg.image.width;
      let displayHeight = seg.image.height;
      if (effectiveWidth > 0 && displayWidth > effectiveWidth) {
        const scale = effectiveWidth / displayWidth;
        displayWidth = effectiveWidth;
        displayHeight = seg.image.height * scale;
      }
      // Wrap to next line if the scaled image won't fit next to existing runs.
      if (lineWidth + displayWidth > effectiveWidth && currentRuns.length > 0) {
        flushLine();
      }
      currentRuns.push({
        inline: inlines[seg.inlineIndex],
        text: seg.text,
        x: lineStartX + lineWidth,
        width: displayWidth,
        inlineIndex: seg.inlineIndex,
        charStart: seg.charStart,
        charEnd: seg.charEnd,
        // Single-character placeholder: charOffsets has one entry equal to width.
        charOffsets: seg.text.length > 0 ? [displayWidth] : [],
        imageHeight: displayHeight,
      });
      lineWidth += displayWidth;
      continue;
    }

    // If adding this segment exceeds effective width and line is not empty,
    // wrap to next line
    if (lineWidth + seg.width > effectiveWidth && currentRuns.length > 0) {
      flushLine();
    }

    // Character-level fallback for segments wider than effectiveWidth
    if (seg.width > effectiveWidth && seg.text.length > 1) {
      // `seg.font` was resolved with the same sup/sub adjustment as the
      // word-level measurement, so re-using it here keeps character
      // widths consistent with the segment's nominal width.
      const charFont = seg.font;
      let charIdx = 0;
      while (charIdx < seg.text.length) {
        let endIdx = charIdx + 1;
        let runWidth = measurer.measureWidth(seg.text.slice(charIdx, endIdx), charFont);
        while (endIdx < seg.text.length) {
          const nextWidth = measurer.measureWidth(seg.text.slice(charIdx, endIdx + 1), charFont);
          if (lineWidth + nextWidth > effectiveWidth && endIdx > charIdx + 1) break;
          runWidth = nextWidth;
          endIdx++;
        }
        // If even a single char exceeds effectiveWidth and line is not empty, flush first
        if (lineWidth + runWidth > effectiveWidth && currentRuns.length > 0) {
          flushLine();
          continue; // Re-measure from charIdx on fresh line
        }
        const sliceText = seg.text.slice(charIdx, endIdx);
        currentRuns.push({
          inline: inlines[seg.inlineIndex],
          text: sliceText,
          x: lineStartX + lineWidth,
          width: runWidth,
          inlineIndex: seg.inlineIndex,
          charStart: seg.charStart + charIdx,
          charEnd: seg.charStart + endIdx,
          charOffsets: computeCharOffsets(measurer, sliceText, charFont),
        });
        lineWidth += runWidth;
        charIdx = endIdx;
        if (lineWidth >= effectiveWidth && charIdx < seg.text.length) {
          flushLine();
        }
      }
      continue;
    }

    currentRuns.push({
      inline: inlines[seg.inlineIndex],
      text: seg.text,
      x: lineStartX + lineWidth,
      width: seg.width,
      inlineIndex: seg.inlineIndex,
      charStart: seg.charStart,
      charEnd: seg.charEnd,
      charOffsets: computeCharOffsets(measurer, seg.text, seg.font),
    });
    lineWidth += seg.width;
  }

  // Flush remaining runs, OR an empty trailing line when the block
  // ended on a soft break (`\n`). The trailing empty line carries the
  // cursor / selection position users expect after pressing
  // Shift+Enter at the end of a block.
  if (currentRuns.length > 0) {
    lines.push({
      runs: currentRuns,
      y: 0,
      height: 0,
      width: lineWidth,
    });
  } else if (lastWasSoftBreak) {
    lines.push({ runs: [], y: 0, height: 0, width: 0 });
  }

  return lines;
}

/**
 * Set `line.y` and `line.height` for each line based on the block's
 * lineHeight multiplier, the tallest run font size, and image runs.
 *
 * Body paragraphs and cell paragraphs both use this so wrapped-line
 * heights are computed identically.
 */
export function assignLineHeights(lines: LayoutLine[], block: Block, docStyles?: DocStyles): void {
  // Floor at 1.0: a sub-1.0 multiplier collapses the line below the font's
  // own pixel height, so characters from adjacent lines overlap. The DOCX
  // import path can plant such values when <w:spacing w:line="N"
  // w:lineRule="exact|atLeast"/> is read as a 240ths-of-a-line multiplier.
  const lineHeightMultiplier = Math.max(1, block.style.lineHeight ?? 1.5);
  let blockY = 0;
  for (const line of lines) {
    const maxFontSize = getLineMaxFontSizePx(line, block, docStyles);
    let lineHeight = lineHeightMultiplier * maxFontSize;
    for (const run of line.runs) {
      if (run.imageHeight !== undefined && run.imageHeight > lineHeight) {
        lineHeight = run.imageHeight;
      }
    }
    line.y = blockY;
    line.height = lineHeight;
    blockY += lineHeight;
  }
}

/**
 * Break inlines into word-level segments and measure each.
 */
function measureSegments(
  inlines: Inline[],
  measurer: TextMeasurer,
): MeasuredSegment[] {
  const segments: MeasuredSegment[] = [];

  for (let i = 0; i < inlines.length; i++) {
    const inline = inlines[i];
    // Superscript/subscript runs use 60% of the original font size for
    // measurement; resolveInlineFont derives that flag from the style.
    const font = resolveInlineFont(inline.style);

    // Image inlines are a single unbreakable segment spanning the entire
    // inline text (the Object Replacement Character placeholder). Width
    // comes from the image metadata rather than text measurement; any
    // scale-to-fit is applied later in layoutBlock.
    if (inline.style.image) {
      const image = inline.style.image;
      segments.push({
        text: inline.text,
        style: inline.style,
        width: image.width,
        inlineIndex: i,
        charStart: 0,
        charEnd: inline.text.length,
        font,
        image: { width: image.width, height: image.height },
      });
      continue;
    }

    // Split on word boundaries (keep spaces attached to preceding word)
    // and on `\n` (each newline becomes its own zero-width word).
    const words = splitWords(inline.text);
    let charPos = 0;

    for (const word of words) {
      if (word === '\n') {
        // Soft line break — see `MeasuredSegment.softBreak`. Width is 0
        // so the line metrics ignore it; `layoutBlock` recognises the
        // flag and flushes the current line after appending a 0-width
        // run carrying the `\n` for cursor / offset continuity.
        segments.push({
          text: '\n',
          style: inline.style,
          width: 0,
          inlineIndex: i,
          charStart: charPos,
          charEnd: charPos + 1,
          font,
          softBreak: true,
        });
      } else {
        const width = cachedMeasureText(measurer, word, font);
        segments.push({
          text: word,
          style: inline.style,
          width,
          inlineIndex: i,
          charStart: charPos,
          charEnd: charPos + word.length,
          font,
        });
      }
      charPos += word.length;
    }
  }

  return segments;
}

/**
 * Split text into words, keeping trailing spaces with the word.
 *
 * `\n` is also a split boundary AND is emitted as its own one-character
 * "word" so `measureSegments` can tag it as a soft line break. Anything
 * accumulated before the `\n` flushes first; anything after starts a new
 * word. Multiple consecutive `\n` therefore produce one `\n` word each,
 * which `layoutBlock` translates into one flushed line per break.
 */
function splitWords(text: string): string[] {
  if (text.length === 0) return [];

  const words: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      // Flush whatever we accumulated before the break, then emit the
      // `\n` as its own word. Doing this first ensures a leading or
      // mid-line `\n` is always a distinct word even when the prior
      // characters didn't trigger the space-split rule below.
      if (current.length > 0) {
        words.push(current);
        current = '';
      }
      words.push('\n');
      continue;
    }
    current += ch;
    // Break after space if the next char is neither space nor newline.
    // (Treating `\n` here would attach the trailing space to the prior
    // word AND a `\n` word — we want the space to stick to the word and
    // the `\n` to remain a standalone segment.)
    if (
      ch === ' '
      && i + 1 < text.length
      && text[i + 1] !== ' '
      && text[i + 1] !== '\n'
    ) {
      words.push(current);
      current = '';
    }
  }

  if (current.length > 0) {
    words.push(current);
  }

  return words;
}

/**
 * Apply horizontal alignment to a line's runs.
 */
export function applyAlignment(
  line: LayoutLine,
  maxWidth: number,
  alignment: string,
  isLastLine: boolean,
): void {
  if (alignment === 'left' || line.runs.length === 0) return;

  if (alignment === 'justify') {
    // Don't justify the last line of a block
    if (isLastLine || line.runs.length <= 1) return;
    const extraSpace = maxWidth - line.width;
    if (extraSpace <= 0) return;
    const gaps = line.runs.length - 1;
    const perGap = extraSpace / gaps;
    for (let i = 1; i < line.runs.length; i++) {
      line.runs[i].x += perGap * i;
    }
    line.width = maxWidth;
    return;
  }

  const offset =
    alignment === 'center'
      ? (maxWidth - line.width) / 2
      : maxWidth - line.width; // right

  for (const run of line.runs) {
    run.x += offset;
  }
}

/**
 * Get the maximum font size across all runs in a line.
 * Falls back to the block's first inline or the theme default.
 */
function getLineMaxFontSizePx(line: LayoutLine, block: Block, docStyles?: DocStyles): number {
  let max = 0;
  for (const run of line.runs) {
    const size = ptToPx(run.inline.style.fontSize ?? Theme.defaultFontSize);
    if (size > max) max = size;
  }
  if (max > 0) return max;

  // For empty lines, resolve font size from the block's named-style default,
  // overridden by an explicit size on the (empty) first inline.
  let fallbackSize = resolveStyleInline(blockStyleId(block), docStyles).fontSize;
  if (block.inlines.length > 0 && block.inlines[0].style.fontSize) {
    fallbackSize = block.inlines[0].style.fontSize;
  }
  return ptToPx(fallbackSize ?? Theme.defaultFontSize);
}

/**
 * Compute display numbers for ordered list items.
 * Returns a map of blockId → display number string.
 * Consecutive ordered list-items at the same level share a counter.
 */
export function computeListCounters(blocks: Block[]): Map<string, string> {
  const counters = new Map<string, string>();
  const levelCounters: number[] = [];

  for (const block of blocks) {
    if (block.type !== 'list-item' || block.listKind !== 'ordered') {
      levelCounters.length = 0; // Reset on non-list block
      continue;
    }
    const level = block.listLevel ?? 0;
    // Trim counters above this level
    levelCounters.length = Math.max(levelCounters.length, level + 1);
    if (levelCounters[level] === undefined) levelCounters[level] = 0;
    levelCounters[level]++;
    // Reset deeper levels
    for (let i = level + 1; i < levelCounters.length; i++) {
      levelCounters[i] = 0;
    }
    counters.set(block.id, formatOrderedMarker(levelCounters[level], level));
  }
  return counters;
}

function formatOrderedMarker(num: number, level: number): string {
  const format = level % 3;
  if (format === 0) return `${num}.`;
  if (format === 1) return `${String.fromCharCode(96 + ((num - 1) % 26) + 1)}.`;
  // lower-roman for level 2, 5, 8...
  return `${toRoman(num)}.`;
}

function toRoman(num: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) {
      result += syms[i];
      num -= vals[i];
    }
  }
  return result;
}

