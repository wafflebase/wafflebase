import { defaultLight } from "@wafflebase/slides";

/**
 * The board plane is a document surface, not app chrome, so it does not
 * follow the app theme.
 *
 * Content on a board resolves its themed colours against `defaultLight`,
 * which `boardToSlidesDocument` (`@wafflebase/board`) pins as the deck's
 * one theme. A plane that went dark with the chrome drew that content —
 * near-black default text and connectors — on near-black, and invited a
 * dark-mode author to "fix" it with white text that a light-mode
 * collaborator could then not see. Every viewer has to see the same board,
 * so the plane takes the deck theme's background in both modes, and
 * everything painted ON the plane (grid, minimap, peer cursors) uses the
 * light variant. Only the toolbar and other chrome follow the app theme —
 * the FigJam / Miro arrangement.
 */
export const BOARD_PLANE_THEME = "light" as const;

/** The plane's fill: the deck theme's background. */
export const BOARD_PLANE_BACKGROUND = defaultLight.colors.background;
