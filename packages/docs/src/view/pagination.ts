import type { PageSetup } from '../model/types.js';
import { getEffectiveDimensions } from '../model/types.js';
import type { DocumentLayout, LayoutLine } from './layout.js';
import { Theme } from './theme.js';

export interface PageLine {
  blockIndex: number;
  lineIndex: number;
  line: LayoutLine;
  x: number;
  y: number;
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
        if (currentY + rowHeight > contentHeight && !isPageTop) {
          startNewPage();
        }
        currentLines.push({
          blockIndex: bi,
          lineIndex: ri,
          line: { runs: [], y: tl.rowYOffsets[ri], height: rowHeight, width: availableWidth },
          x: margins.left,
          y: margins.top + currentY,
        });
        currentY += rowHeight;
        isPageTop = false;
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
        });

        currentY += line.height;
        isPageTop = false;
      }

      // Apply marginBottom after the block's last line.
      // When a block splits across pages, startNewPage() resets currentY,
      // so marginBottom is naturally applied only on the final page.
      if (lb.lines.length > 0) {
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

  for (const page of paginatedLayout.pages) {
    for (const pl of page.lines) {
      if (pl.blockIndex === blockIndex && pl.lineIndex === targetLineIndex) {
        return { pageIndex: page.pageIndex, pageLine: pl };
      }
    }
  }

  return undefined;
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

  // Find the target line on this page by Y
  let targetPL = targetPage.lines[0];
  for (const pl of targetPage.lines) {
    if (localY >= pl.y) {
      targetPL = pl;
    } else {
      break;
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
      const charWidth = run.width / Math.max(1, run.text.length);
      const localRunX = localX - run.x;
      const charOffset = Math.round(localRunX / charWidth);
      const clampedOffset = Math.min(Math.max(0, charOffset), run.text.length);
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
