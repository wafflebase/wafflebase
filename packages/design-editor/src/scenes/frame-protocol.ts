/**
 * The one typed contract between the editor shell and a scene frame.
 *
 * WHY A MESSAGE PROTOCOL AT ALL. Each frame is a real document (`scene.html`),
 * which means its own JS realm. The consequence is that the host cannot reach
 * into the frame and call a function: there is no shared scope. `postMessage`
 * stops being a convenience and becomes the only channel, so it is worth typing
 * once, here, rather than growing string literals across six files.
 *
 * THE REJECTED ALTERNATIVE was `about:blank` + `createRoot(frame.contentDocument.body)`
 * from the host, which keeps one realm and needs no protocol. It is unsound for
 * this tool: one realm means every module instance is SHARED, and real
 * applications keep module-level mutable state — wafflebase's own docs engine
 * holds a `let activeTheme` behind a `Proxy`, with shared mutable theme objects. A
 * dual-frame visual diff would then paint both sides from the same theme object
 * and show identical colours. The realm split makes that correct by construction
 * instead of by discipline.
 *
 * ORIGIN DISCIPLINE. Every listener must drop a message whose `origin` is not its
 * own. The frame renders real product code; a page that embeds the editor must
 * not be able to drive its selection or its writes.
 *
 * PORTED FROM the prototype's `src/scenes/frame-protocol.ts`, with two changes the
 * shipped host forces. Both are in `sceneFrameUrl` and `FrameSide` — see there.
 */

// Type-only, so `verbatimModuleSyntax` erases it and the browser bundle pays
// nothing for reaching a module that also serves the plugin.
import type { FrameSide } from '../plugin/protocol.ts';
import { BASE } from '../base.ts';

/**
 * Re-exported rather than redeclared.
 *
 * The prototype declared its own `FrameSide` here, and the shipped wire protocol
 * already owns one (`plugin/protocol.ts`) because `?wbFrame=<side>` module ids and
 * the `/plan` route both name it. Two declarations of one wire value is how the
 * two halves start disagreeing about what `'before'` means — the same reason 9a's
 * bridge client imports the server's intent types instead of copying them.
 */
export type { FrameSide };

/** Real widths, never a transform — a scaled frame lies about breakpoints. */
export type ViewportKey = 'mobile' | 'tablet' | 'desktop';

export const VIEWPORT_WIDTH: Record<ViewportKey, number | null> = {
  mobile: 390,
  tablet: 768,
  desktop: null, // null = fill the pane
};

/** A node the frame can talk about: what the stamping transform wrote out. */
export interface StampRef {
  /**
   * `<file>#<root>:<path>` — globally unique, and it has to be.
   *
   * `<root>:<path>` alone is NOT unique across a frame. A scene rendered inside
   * an app shell paints the layout, the sidebar, the nav and the page in ONE
   * document, and `Page` / `default` are common root names — two files can easily
   * both contribute `Page:0.1`. Keying selection on the bare stamp would then
   * highlight a node in the wrong file. See `stampId`.
   */
  id: string;
  /** The walkable root the path belongs to (a key of `SceneMeta.roots`). */
  component: string;
  /** Path in the PATCHED frame — a hint only; `fp` is the identity. */
  path: number[];
  /**
   * `data-wb-fp`. The frame-independent key the host resolves against the
   * BASELINE metadata.
   */
  fp: string;
  tag: string;
  /** Root-relative file the node's source lives in (`data-wb-file`). */
  file: string;
  /**
   * How many DOM elements carry this same id — a `.map()` source node renders N
   * times, and the inspector says "applies to all N".
   */
  instances: number;
}

/** A rect in the frame's own coordinate space (CSS px, frame viewport). */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// host → frame
// ---------------------------------------------------------------------------

export type HostMessage =
  /**
   * Flip the frame's theme. Delegates to the application's OWN theme provider,
   * which is the consumer's code — the editor never owns a theme.
   */
  | { type: 'wb:set-theme'; theme: 'light' | 'dark' }
  /** Draw (or clear) the selection outline. `null` clears. */
  | { type: 'wb:set-selection'; id: string | null }
  /** Draw (or clear) the hover outline, driven from the outline panel. */
  | { type: 'wb:set-hover'; id: string | null }
  /** Ask for a node's rect (the outline panel's scroll-into-view). */
  | { type: 'wb:measure'; id: string; nonce: number }
  /** Turn click-to-select on or off (off while a modal owns the pointer). */
  | { type: 'wb:set-picking'; enabled: boolean }
  /**
   * Live token overrides, as CSS custom properties.
   *
   * A component preview gets these as an inline `style` on a host DOM element
   * (`client/edits.ts#tokenPreviewStyle`), which cannot cross a frame boundary — an
   * iframe is a separate document, so a token edit staged in the Token Editor
   * repainted the component preview and left the scene untouched. The frame
   * applies them to its own `:root` instead, which is also more faithful: a real
   * cascade, so every variable reaches everything that reads it rather than only
   * the names an inline style listed.
   */
  | { type: 'wb:set-token-vars'; vars: Record<string, string> };

// ---------------------------------------------------------------------------
// frame → host
// ---------------------------------------------------------------------------

export type FrameMessage =
  /**
   * The scene mounted. `selectable` is the runtime `clickSelectable` upgrade: the
   * ids that actually reached the DOM. A component that does not spread
   * `{...props}` swallows the attribute, and that cannot be known from the source
   * — so the metadata's guess is conservative and this corrects it.
   */
  | { type: 'wb:ready'; scene: string; side: FrameSide; selectable: string[] }
  | { type: 'wb:select'; node: StampRef; rect: FrameRect; altKey: boolean }
  | { type: 'wb:hover'; node: StampRef | null; rect: FrameRect | null }
  | { type: 'wb:measured'; nonce: number; rect: FrameRect | null }
  /**
   * Four distinguishable failures, because the recovery differs:
   *   `mount`   — a missing mock or fixture. An EDITOR problem; the scene never
   *               rendered. Fix the manifest or the fixture file.
   *   `render`  — the scene threw while rendering. Usually a DESIGN problem
   *               (the staged edit is wrong).
   *   `compile` — the module did not transform. OUR WRITE broke the file, so the
   *               host offers an inline `POST /undo`.
   *   `fetch`   — an unmocked URL hit the kill-switch. Names the URL, because the
   *               alternative is an afternoon spent on a blank scene.
   */
  | {
      type: 'wb:error';
      kind: 'mount' | 'render' | 'compile' | 'fetch';
      message: string;
      url?: string;
    }
  /**
   * Classes the frame actually rendered, so the host can register Tailwind
   * candidates for them. A class composed at runtime has NO CSS rule until
   * Tailwind is told about it, and the frame shares the host's stylesheet.
   */
  | { type: 'wb:classes'; classes: string[] }
  /**
   * The user navigated (picking OFF, a real link or `navigate()`) to a path other
   * than the scene's own route. A shell scene's in-memory router has just one real
   * page route, so anywhere else is, by construction, an attempt to reach a
   * DIFFERENT scene. The host matches `path` against the scene manifest and
   * switches scene, which is a real frame reload onto that scene's module.
   */
  | { type: 'wb:route-change'; path: string }
  /**
   * A click (picking ON) landed on a non-selectable area — clear the selection.
   * `wb:select` intentionally has no "clear" form of its own (`node: StampRef` is
   * non-nullable, since a selection always names a real node), so an explicit
   * clear needs its own message.
   */
  | { type: 'wb:deselect' };

export const isHostMessage = (d: unknown): d is HostMessage =>
  !!d &&
  typeof d === 'object' &&
  typeof (d as HostMessage).type === 'string' &&
  (d as HostMessage).type.startsWith('wb:');

export const isFrameMessage = (d: unknown): d is FrameMessage =>
  !!d &&
  typeof d === 'object' &&
  typeof (d as FrameMessage).type === 'string' &&
  (d as FrameMessage).type.startsWith('wb:');

/**
 * `<file>#<root>:<path>`.
 *
 * The DOM keeps the file and the stamp in two separate attributes
 * (`data-wb-file` + `data-wb-node`) rather than one combined value, so that the
 * `data-wb-node` contract the stamper verifies — "the stamped set equals the
 * metadata's node set" — stays a straight comparison against `SceneNodeMeta.path`.
 * The combined form exists only in messages, where uniqueness is what matters.
 */
export const stampId = (file: string, component: string, path: number[]): string =>
  `${file}#${component}:${path.join('.')}`;

/** Inverse of `stampId`. Returns null for anything malformed. */
export function parseStampId(
  id: string,
): { file: string; component: string; path: number[] } | null {
  const hash = id.indexOf('#');
  if (hash <= 0) return null;
  const file = id.slice(0, hash);
  const rest = id.slice(hash + 1);
  // A root name cannot contain `:`, but a path can be empty (`"Page:"`), so split
  // on the LAST colon.
  const colon = rest.lastIndexOf(':');
  if (colon <= 0) return null;
  const component = rest.slice(0, colon);
  const tail = rest.slice(colon + 1);
  const path = tail === '' ? [] : tail.split('.').map(Number);
  if (path.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return { file, component, path };
}

/**
 * The URL a frame is loaded from. Built here so host and frame cannot drift.
 *
 * `${BASE}/scene`, NOT the prototype's `/scene.html`. In the prototype the editor
 * *was* the Vite app — its own root, two HTML entries — so a root-relative
 * `/scene.html` resolved. The shipped plugin serves both documents under its own
 * mount, and `shellServer` maps exactly `/scene` onto `scene.html`. Measured
 * against a live consumer dev server:
 *
 *   404  /scene.html                (never reaches the shell middleware at all)
 *   ---  /__design-editor/scene     (reaches it; serves the built document)
 *
 * So the prototype's URL does not 404 *in the shell* — it 404s in the CONSUMER's
 * app, which is the one place a wrong answer looks like the consumer's own routing
 * bug rather than ours.
 */
export function sceneFrameUrl(args: {
  scene: string;
  side: FrameSide;
  theme: 'light' | 'dark';
  /**
   * The Mock Data toggle — every array in every fixture becomes `[]`. Read once
   * at frame load, so toggling it is a reload, not a `postMessage`.
   */
  mockDataEmpty?: boolean;
}): string {
  const p = new URLSearchParams({ scene: args.scene, frame: args.side, theme: args.theme });
  if (args.mockDataEmpty) p.set('empty', '1');
  return `${BASE}/scene?${p.toString()}`;
}
