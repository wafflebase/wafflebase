import type { DocPosition } from '../model/types.js';
import type { LayoutBlock } from './layout.js';

export interface VisualLineInfo {
  lineIndex: number;
  totalLines: number;
  lineStart: number;
  lineEnd: number;
}

/**
 * Find which visual (wrapped) line a position falls on within a layout block.
 * Returns line index, total line count, and the character range of that line.
 */
export function findVisualLine(
  lb: LayoutBlock,
  pos: DocPosition,
): VisualLineInfo | undefined {
  if (lb.lines.length === 0) return undefined;

  let charsBefore = 0;
  for (let i = 0; i < lb.lines.length; i++) {
    let lineChars = 0;
    for (const run of lb.lines[i].runs) {
      lineChars += run.charEnd - run.charStart;
    }
    const lineStart = charsBefore;
    const lineEnd = charsBefore + lineChars;
    const isLastLine = i === lb.lines.length - 1;
    if (pos.offset >= lineStart && (pos.offset < lineEnd || (isLastLine && pos.offset <= lineEnd))) {
      return { lineIndex: i, totalLines: lb.lines.length, lineStart, lineEnd };
    }
    charsBefore = lineEnd;
  }

  // Fallback: last line
  const lastLine = lb.lines.length - 1;
  let lastStart = 0;
  for (let i = 0; i < lastLine; i++) {
    for (const run of lb.lines[i].runs) {
      lastStart += run.charEnd - run.charStart;
    }
  }
  let lastChars = 0;
  for (const run of lb.lines[lastLine].runs) {
    lastChars += run.charEnd - run.charStart;
  }
  return { lineIndex: lastLine, totalLines: lb.lines.length, lineStart: lastStart, lineEnd: lastStart + lastChars };
}
