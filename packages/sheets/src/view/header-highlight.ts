import { Range, Ref, SelectionType } from '../model/core/types';

/**
 * How a row or column header is painted for the current selection:
 *
 * - `full` — the whole row/column is selected (row/column header click,
 *   or select-all). The stronger, syrup-tinted treatment.
 * - `spanned` — some selected range crosses this row/column. Google Sheets
 *   lights every header a selection spans, across all ranges of a
 *   multi-range selection, not only the active cell's.
 * - `none` — untouched.
 */
export type HeaderHighlight = 'none' | 'spanned' | 'full';

/**
 * `headerHighlight` decides the highlight of the header at `index` on
 * `axis`. With no ranges (a bare caret) the active cell alone counts.
 */
export function headerHighlight(
  axis: 'row' | 'column',
  index: number,
  activeCell: Ref,
  selectionType: SelectionType | undefined,
  ranges: readonly Range[],
): HeaderHighlight {
  if (selectionType === 'all') {
    return 'full';
  }

  const key = axis === 'row' ? 'r' : 'c';
  const spans = (range: Range) => {
    const a = range[0][key];
    const b = range[1][key];
    return index >= Math.min(a, b) && index <= Math.max(a, b);
  };

  if (ranges.length === 0) {
    return activeCell[key] === index ? 'spanned' : 'none';
  }
  if (!ranges.some(spans)) {
    return 'none';
  }
  return selectionType === axis ? 'full' : 'spanned';
}
