import type { PageSetup } from '../model/types.js';
import { getEffectiveDimensions } from '../model/types.js';
import type { DocumentLayout, LayoutLine } from './layout.js';

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

  // Push final page (guarantee at least 1)
  pages.push({
    pageIndex: pages.length,
    lines: currentLines,
    width: effectiveWidth,
    height: effectiveHeight,
  });

  return { pages, pageSetup };
}
