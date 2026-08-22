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
 *
 * An offset at a soft-wrap boundary belongs to two lines at once — it is
 * both the end of line `i` and the start of line `i + 1` — so the caller's
 * `lineAffinity` decides: `'backward'` resolves it to line `i` (where the
 * caret is drawn), `'forward'` to line `i + 1`. The default is `'forward'`,
 * which is how this helper resolved boundaries before affinity existed.
 */
export function findVisualLine(
  lb: LayoutBlock,
  pos: DocPosition,
  lineAffinity: 'forward' | 'backward' = 'forward',
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
    // The last line has no following line to hand the boundary to, so it
    // always keeps its end offset regardless of affinity.
    const ownsLineEnd = i === lb.lines.length - 1 || lineAffinity === 'backward';
    if (pos.offset >= lineStart && (pos.offset < lineEnd || (ownsLineEnd && pos.offset <= lineEnd))) {
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
