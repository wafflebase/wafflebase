import type { PageSetup } from '../model/types.js';
import { getEffectiveDimensions } from '../model/types.js';
import type { EditContext } from '../model/document.js';
import type { DocumentLayout, LayoutLine, LayoutRun } from './layout.js';
import { findRowSplitHeight } from './table-layout.js';
import { Theme } from './theme.js';

export interface PageLine {
  blockIndex: number;
  lineIndex: number;
  line: LayoutLine;
  x: number;
  y: number;

  /**
   * 1-based page number this line is laid out on. Surfaced here (rather
   * than only on the enclosing `LayoutPage`) so consumers walking blocks
   * — Markdown serialization, page slicing, the CLI — can read the page
   * for a line without having to keep the parent page in scope.
   *
   * 1-based to match user-facing page-range syntax (`--pages 1-3`); the
   * `LayoutPage.pageIndex` field stays 0-based for renderer math.
   */
  pageIndex: number;

  /** For split table rows: vertical offset into the row where this
      page fragment starts (0 for the first fragment). */
  rowSplitOffset?: number;

  /** For split table rows: height of this fragment on this page.
      When undefined the full row height is used. */
  rowSplitHeight?: number;
}

export interface LayoutPage {
  pageIndex: number;
  lines: PageLine[];
  width: number;
  height: number;
}

export interface PaginatedLayout {
  pages: LayoutPage[];
  pageSetup: PageSetup;
}

export function paginateLayout(
  layout: DocumentLayout,
  pageSetup: PageSetup,
): PaginatedLayout {
  const { width: effectiveWidth, height: effectiveHeight } =
    getEffectiveDimensions(pageSetup);
  const { margins } = pageSetup;
  const contentHeight = effectiveHeight - margins.top - margins.bottom;
  const availableWidth = effectiveWidth - margins.left - margins.right;

  const pages: LayoutPage[] = [];
  let currentLines: PageLine[] = [];
  let currentY = 0;
  let isPageTop = true;

  const startNewPage = () => {
    pages.push({
      pageIndex: pages.length,
      lines: currentLines,
      width: effectiveWidth,
      height: effectiveHeight,
    });
    currentLines = [];
    currentY = 0;
    isPageTop = true;
  };

  for (let bi = 0; bi < layout.blocks.length; bi++) {
    const lb = layout.blocks[bi];
    const block = lb.block;

    // Apply marginTop (skip at page top)
    if (!isPageTop) {
      currentY += block.style.marginTop;
    }

    if (lb.block.type === 'table' && lb.layoutTable) {
      const tl = lb.layoutTable;
      for (let ri = 0; ri < tl.rowHeights.length; ri++) {
        const rowHeight = tl.rowHeights[ri];
        const rowLine = { runs: [] as LayoutRun[], y: tl.rowYOffsets[ri], height: rowHeight, width: availableWidth };

        // Row fits on current page — place whole row
        if (currentY + rowHeight <= contentHeight) {
          currentLines.push({
            blockIndex: bi, lineIndex: ri, line: rowLine,
            x: margins.left, y: margins.top + currentY,
            pageIndex: pages.length + 1,
          });
          currentY += rowHeight;
          isPageTop = false;
          continue;
        }

        // Row doesn't fit — try to split
        const availableForRow = contentHeight - currentY;
        const td = lb.block.tableData;
        const splitHeight = availableForRow > 0
          ? findRowSplitHeight(tl, ri, availableForRow, td ?? undefined)
          : 0;

        if (splitHeight <= 0 && !isPageTop) {
          // No safe split point on this page — push to next page
          startNewPage();
        }

        // Emit fragments across pages
        let consumed = 0;
        while (consumed < rowHeight) {
          if (consumed > 0) startNewPage();
          const remaining = rowHeight - consumed;
          const pageAvail = contentHeight - currentY;

          let fragHeight = remaining;
          if (remaining > pageAvail && pageAvail > 0) {
            const sh = findRowSplitHeight(tl, ri, consumed + pageAvail, td ?? undefined);
            fragHeight = sh > consumed ? sh - consumed : Math.min(remaining, pageAvail);
          }
          if (fragHeight <= 0) fragHeight = Math.min(remaining, contentHeight);

          const needsSplit = consumed > 0 || fragHeight < rowHeight;
          currentLines.push({
            blockIndex: bi, lineIndex: ri, line: rowLine,
            x: margins.left, y: margins.top + currentY,
            pageIndex: pages.length + 1,
            ...(needsSplit ? { rowSplitOffset: consumed, rowSplitHeight: fragHeight } : {}),
          });
          consumed += fragHeight;
          currentY += fragHeight;
          isPageTop = false;
        }
      }

      if (tl.rowHeights.length > 0) {
        currentY += block.style.marginBottom;
      }
    } else {
      for (let li = 0; li < lb.lines.length; li++) {
        const line = lb.lines[li];

        // Check if line fits on current page
        if (currentY + line.height > contentHeight && !isPageTop) {
          startNewPage();
        }

        currentLines.push({
          blockIndex: bi,
          lineIndex: li,
          line,
          x: margins.left,
          y: margins.top + currentY,
          pageIndex: pages.length + 1,
        });

        currentY += line.height;
        isPageTop = false;
      }

      // Page-break: force next content onto a new page
      if (block.type === 'page-break') {
        startNewPage();
      }

      // Apply marginBottom after the block's last line.
      // When a block splits across pages, startNewPage() resets currentY,
      // so marginBottom is naturally applied only on the final page.
      if (lb.lines.length > 0 && block.type !== 'page-break') {
        currentY += block.style.marginBottom;
      }
    }
  }

  // Push final page (guarantee at least 1)
  pages.push({
    pageIndex: pages.length,
    lines: currentLines,
    width: effectiveWidth,
    height: effectiveHeight,
  });

  return { pages, pageSetup };
}

/**
 * Get the absolute Y offset of a page's top edge on the canvas.
 */
export function getPageYOffset(
  paginatedLayout: PaginatedLayout,
  pageIndex: number,
): number {
  const pageHeight = paginatedLayout.pages[0]?.height ?? 0;
  return Theme.pageGap + pageIndex * (pageHeight + Theme.pageGap);
}

/**
 * Reconstruct the canvas Y where the table's logical row 0 would sit
 * for rendering or hit-testing on the page that contains `pl`.
 *
 * For a non-split row the math is just `pageY + pl.y - rowYOffsets[lineIndex]`;
 * for a split-fragment continuation we additionally subtract
 * `rowSplitOffset` so the fragment lines up with where the row was
 * already drawn on the previous page. Renderer and resolver share this
 * helper so they cannot drift apart on split fragments.
 */
export function getTableOriginYForPageLine(
  pageY: number,
  pl: PageLine,
  rowYOffsets: number[],
): number {
  if (pl.lineIndex < 0 || pl.lineIndex >= rowYOffsets.length) {
    // An out-of-bounds lineIndex would silently yield NaN and corrupt
    // every downstream coordinate (renderer + hit-test). Fail loudly
    // so a future split-rendering bug surfaces immediately instead of
    // turning into invisible widgets or off-by-N misclicks.
    throw new RangeError(
      `getTableOriginYForPageLine: lineIndex ${pl.lineIndex} out of bounds (rowYOffsets length ${rowYOffsets.length})`,
    );
  }
  const splitOffset = pl.rowSplitOffset ?? 0;
  return pageY + pl.y - rowYOffsets[pl.lineIndex] - splitOffset;
}

/**
 * Get the total scrollable height of the paginated document.
 */
export function getTotalHeight(paginatedLayout: PaginatedLayout): number {
  const { pages } = paginatedLayout;
  if (pages.length === 0) return 0;
  const pageHeight = pages[0].height;
  return pages.length * pageHeight + (pages.length + 1) * Theme.pageGap;
}

/**
 * Get horizontal offset for centering pages on canvas.
 */
export function getPageXOffset(
  paginatedLayout: PaginatedLayout,
  canvasWidth: number,
): number {
  const pageWidth = paginatedLayout.pages[0]?.width ?? 0;
  return Math.max(0, (canvasWidth - pageWidth) / 2);
}

/**
 * Get the absolute Y start position for the header on a given page.
 */
export function getHeaderYStart(
  paginatedLayout: PaginatedLayout,
  pageIndex: number,
  marginFromEdge: number,
): number {
  const pageY = getPageYOffset(paginatedLayout, pageIndex);
  return pageY + marginFromEdge;
}

/**
 * Get the absolute Y start position for the footer on a given page.
 */
export function getFooterYStart(
  paginatedLayout: PaginatedLayout,
  pageIndex: number,
  footerHeight: number,
  marginFromEdge: number,
): number {
  const pageY = getPageYOffset(paginatedLayout, pageIndex);
  const pageHeight = paginatedLayout.pages[pageIndex]?.height ?? 0;
  return pageY + pageHeight - marginFromEdge - footerHeight;
}

/**
 * Find which page a given blockId + offset falls on.
 */
export function findPageForPosition(
  paginatedLayout: PaginatedLayout,
  blockId: string,
  offset: number,
  layout: DocumentLayout,
  lineAffinity: 'forward' | 'backward' = 'backward',
): { pageIndex: number; pageLine: PageLine } | undefined {
  const blockIndex = layout.blocks.findIndex(
    (lb) => lb.block.id === blockId,
  );
  if (blockIndex === -1) return undefined;

  const lb = layout.blocks[blockIndex];
  let charCount = 0;
  let targetLineIndex = 0;
  for (let li = 0; li < lb.lines.length; li++) {
    const lineChars = lb.lines[li].runs.reduce(
      (sum, r) => sum + (r.charEnd - r.charStart),
      0,
    );
    if (charCount + lineChars >= offset) {
      // At a line boundary, 'forward' affinity means the cursor
      // belongs to the next visual line (e.g., after moveRight).
      if (lineAffinity === 'forward'
          && charCount + lineChars === offset
          && li < lb.lines.length - 1) {
        // Skip this line — the next iteration will pick it up
        charCount += lineChars;
        targetLineIndex = li;
        continue;
      }
      targetLineIndex = li;
      break;
    }
    charCount += lineChars;
    targetLineIndex = li;
  }

  // For non-table blocks, return the first matching PageLine.
  // For table rows that split across pages, multiple PageLines share the same
  // blockIndex + lineIndex; return the last fragment so the cursor lands on the
  // most-recently-visible portion of the row (continuation pages).
  const isTableBlock = lb.block.type === 'table';
  let result: { pageIndex: number; pageLine: PageLine } | undefined;

  for (const page of paginatedLayout.pages) {
    for (const pl of page.lines) {
      if (pl.blockIndex === blockIndex && pl.lineIndex === targetLineIndex) {
        if (!isTableBlock) {
          return { pageIndex: page.pageIndex, pageLine: pl };
        }
        // For table blocks, keep scanning to find the last fragment.
        result = { pageIndex: page.pageIndex, pageLine: pl };
      }
    }
  }

  return result;
}

/**
 * Convert absolute canvas pixel coordinates to a document position.
 */
export function paginatedPixelToPosition(
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  px: number,
  py: number,
  canvasWidth: number,
): { blockId: string; offset: number; lineAffinity: 'forward' | 'backward' } | undefined {
  if (paginatedLayout.pages.length === 0) return undefined;

  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;
  const pageHeight = paginatedLayout.pages[0].height;

  // Find which page was clicked
  let targetPage = paginatedLayout.pages[0];
  for (const page of paginatedLayout.pages) {
    const pageTop = getPageYOffset(paginatedLayout, page.pageIndex);
    if (py >= pageTop && py < pageTop + pageHeight) {
      targetPage = page;
      break;
    }
    if (py >= pageTop) targetPage = page;
  }

  if (targetPage.lines.length === 0) {
    if (layout.blocks.length === 0) return undefined;
    return { blockId: layout.blocks[0].block.id, offset: 0, lineAffinity: 'backward' };
  }

  const pageTop = getPageYOffset(paginatedLayout, targetPage.pageIndex);
  const localY = py - pageTop;
  const localX = px - pageX - margins.left;

  // Find the target line on this page by Y.
  // For split table rows, use rowSplitHeight so a tiny first-fragment
  // doesn't claim the space that belongs to the next line below it.
  let targetPL = targetPage.lines[0];
  for (const pl of targetPage.lines) {
    const visibleHeight = pl.rowSplitHeight ?? pl.line.height;
    if (localY >= pl.y && localY < pl.y + visibleHeight) {
      targetPL = pl;
      break;
    }
    if (localY >= pl.y) {
      targetPL = pl;
    }
  }

  const lb = layout.blocks[targetPL.blockIndex];
  const line = targetPL.line;

  if (line.runs.length === 0) {
    return { blockId: lb.block.id, offset: 0, lineAffinity: 'backward' };
  }

  // Count chars before this line in the block
  let charsBeforeLine = 0;
  for (let li = 0; li < targetPL.lineIndex; li++) {
    for (const r of lb.lines[li].runs) {
      charsBeforeLine += r.charEnd - r.charStart;
    }
  }

  // Affinity is determined by which visual line was clicked:
  // if the resolved offset equals the boundary between two lines,
  // 'forward' keeps the cursor on the clicked (later) line.
  const affinityForOffset = (offset: number): 'forward' | 'backward' =>
    targetPL.lineIndex > 0 && offset === charsBeforeLine ? 'forward' : 'backward';

  // Before start of line (clicked in left margin)
  const firstRun = line.runs[0];
  if (localX < firstRun.x) {
    const offset = charsBeforeLine;
    return {
      blockId: lb.block.id,
      offset,
      lineAffinity: affinityForOffset(offset),
    };
  }

  // Find character within the line
  let charsBeforeRun = 0;
  for (const run of line.runs) {
    if (localX >= run.x && localX <= run.x + run.width) {
      // Binary search on pre-computed charOffsets
      const localRunX = localX - run.x;
      let charOffset = 0;
      const offsets = run.charOffsets;
      if (offsets.length > 0 && localRunX > 0) {
        // Binary search for the character boundary closest to localRunX
        let lo = 0;
        let hi = offsets.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (offsets[mid] < localRunX) {
            lo = mid + 1;
          } else {
            hi = mid;
          }
        }
        // lo is now the first index where offsets[lo] >= localRunX.
        // Snap to nearest: compare midpoint between prev and current char.
        const prev = lo > 0 ? offsets[lo - 1] : 0;
        charOffset = (localRunX - prev < offsets[lo] - localRunX) ? lo : lo + 1;
      }
      const clampedOffset = Math.min(charOffset, run.text.length);
      const offset = charsBeforeLine + charsBeforeRun + clampedOffset;
      return {
        blockId: lb.block.id,
        offset,
        lineAffinity: affinityForOffset(offset),
      };
    }
    charsBeforeRun += run.text.length;
  }

  // Past end of line
  const lineCharCount = line.runs.reduce(
    (sum, r) => sum + (r.charEnd - r.charStart),
    0,
  );
  let endOffset = charsBeforeLine + lineCharCount;

  // For wrapped lines (non-last), exclude trailing spaces
  const isLastLineInBlock = targetPL.lineIndex === lb.lines.length - 1;
  if (!isLastLineInBlock && line.runs.length > 0) {
    const lastRun = line.runs[line.runs.length - 1];
    let trim = 0;
    for (let i = lastRun.text.length - 1; i >= 0; i--) {
      if (lastRun.text[i] === ' ') trim++;
      else break;
    }
    endOffset -= trim;
  }

  return {
    blockId: lb.block.id,
    offset: endOffset,
    lineAffinity: 'backward',
  };
}

/**
 * Determine whether a click at absolute (px, py) targets the header, footer, or body.
 */
export function resolveClickTarget(
  paginatedLayout: PaginatedLayout,
  px: number,
  py: number,
  canvasWidth: number,
  hasHeader: boolean,
  hasFooter: boolean,
): EditContext {
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;

  for (const page of paginatedLayout.pages) {
    const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
    if (py < pageY || py > pageY + page.height) continue;
    if (px < pageX || px > pageX + page.width) continue;

    const localY = py - pageY;

    if (hasHeader && localY < margins.top) {
      return 'header';
    }
    if (hasFooter && localY > page.height - margins.bottom) {
      return 'footer';
    }
    return 'body';
  }
  return 'body';
}

/**
 * Find the first PageLine matching a given blockIndex and lineIndex.
 * Returns the PageLine together with its pageIndex and absolute pageY,
 * or undefined if no match is found.
 */
export function findPageLine(
  paginatedLayout: PaginatedLayout,
  blockIndex: number,
  lineIndex: number,
): { pageLine: PageLine; pageIndex: number; pageY: number } | undefined {
  for (const page of paginatedLayout.pages) {
    for (const pl of page.lines) {
      if (pl.blockIndex === blockIndex && pl.lineIndex === lineIndex) {
        return {
          pageLine: pl,
          pageIndex: page.pageIndex,
          pageY: getPageYOffset(paginatedLayout, page.pageIndex),
        };
      }
    }
  }
  return undefined;
}
