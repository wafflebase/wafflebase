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
 * so the plane takes the deck theme's background in both modes (dimmed in
 * dark mode, see {@link BOARD_PLANE_DIMMED_BACKGROUND}), and
 * everything painted ON the plane (grid, minimap, peer cursors) uses the
 * light variant. Only the toolbar and other chrome follow the app theme —
 * the FigJam / Miro arrangement.
 */
export const BOARD_PLANE_THEME = "light" as const;

/** The plane's fill: the deck theme's background. */
export const BOARD_PLANE_BACKGROUND = defaultLight.colors.background;

/**
 * The plane's fill while the APP is in dark mode: the same light plane,
 * dimmed. A full-white plane inside dark chrome glared; a dark plane would
 * break the rule above. A neutral grey takes half the light out and keeps
 * default text at 9.1:1, so every viewer still sees the same board,
 * and pastel stickies now read as paper on a desk. View-only: exports stay
 * on {@link BOARD_PLANE_BACKGROUND}.
 */
export const BOARD_PLANE_DIMMED_BACKGROUND = "#BBBCB8";

/** The plane's fill for the app theme the viewer is in. */
export function boardPlaneBackground(appTheme: "light" | "dark"): string {
  return appTheme === "dark" ? BOARD_PLANE_DIMMED_BACKGROUND : BOARD_PLANE_BACKGROUND;
}
