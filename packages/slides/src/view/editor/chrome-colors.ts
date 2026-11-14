import { palette } from '@wafflebase/core/tokens';

/**
 * Editor chrome colors for the slides overlay — selection frames, resize and
 * rotate handles, connector endpoints, the lasso, the hover outline and the
 * table cell-range wash.
 *
 * Syrup is the one accent that carries selection across the suite
 * (DESIGN.md), so these come from the core palette instead of the stock
 * green / Google blue the overlay used to inline. The overlay sits on the
 * slide itself, whose paper is the deck's own theme rather than the app's
 * light/dark mode, so a single value serves both modes.
 */

/** Selection frame, handle fill, connector endpoints and sites. */
export const SELECTION_COLOR = palette.syrup;

/** Faint dashed outline: group-member frames and the drill-in context box. */
export const SELECTION_FAINT = `rgba(${palette.syrupRgb}, 0.5)`;

/** Hover preview outline — the selection hue at half strength. */
export const HOVER_OUTLINE = `rgba(${palette.syrupRgb}, 0.5)`;

/** Lasso marquee fill. */
export const LASSO_FILL = `rgba(${palette.syrupRgb}, 0.1)`;

/**
 * Table cell-range wash — the butter selection wash the sheets grid paints
 * for a cell range (`selectionBGColor`, light), so a selected range reads the
 * same in a slide table as in a spreadsheet.
 */
export const CELL_RANGE_FILL = `rgba(${palette.butterRgb}, 0.18)`;
