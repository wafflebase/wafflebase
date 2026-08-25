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
  | ViewGesture
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
      /** `stream` is a REFUSED EventSource — by design, unlike a missing `fetch` fixture. */
      kind: 'mount' | 'render' | 'compile' | 'fetch' | 'stream';
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
  | { type: 'wb:deselect' }
  /**
   * The bug reporter armed or disarmed inside this frame.
   *
   * The host uses it to drop out of Pick mode for the duration and put it back
   * after: picking suppresses the product's own click handlers, which is exactly
   * what a reporter aiming at the running interface must not have. It is the
   * frame that knows — the reporter lives there — so this is the only way the
   * shell can find out.
   */
  | { type: 'wb:debug-report'; live: boolean };

/**
 * Per-variant validation, not a `wb:` prefix test.
 *
 * The prefix test accepted `{ type: 'wb:set-theme', theme: 'system' }` and a bare
 * `{ type: 'wb:select' }` — neither of which inhabits the union it narrows to. A
 * listener then reads `msg.node.id` off `undefined`, or applies a theme that is not
 * a theme, having been told by the type system that both are safe. These messages
 * cross a `postMessage` boundary between two documents, so "the other side is our
 * own code" is a claim about the page, not a guarantee.
 *
 * Checked to the depth the listeners read: the discriminator, every required field,
 * and the closed value sets (`theme`, `side`, `kind`). `StampRef` and `FrameRect`
 * are checked field by field because `wb:select` is what becomes an edit anchor.
 */
type Rec = Record<string, unknown>;
const isStr = (v: unknown): boolean => typeof v === 'string';
const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const orNull = (v: unknown, f: (x: unknown) => boolean): boolean => v === null || f(v);
const isStrArray = (v: unknown): boolean => Array.isArray(v) && v.every(isStr);

const isRect = (v: unknown): boolean =>
  isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.width) && isNum(v.height);

const isStampRef = (v: unknown): boolean =>
  isObj(v) &&
  isStr(v.id) &&
  isStr(v.component) &&
  Array.isArray(v.path) &&
  v.path.every((n) => Number.isInteger(n) && (n as number) >= 0) &&
  isStr(v.fp) &&
  isStr(v.tag) &&
  isStr(v.file) &&
  isNum(v.instances);

const HOST_SHAPES: Record<string, (d: Rec) => boolean> = {
  'wb:set-theme': (d) => d.theme === 'light' || d.theme === 'dark',
  'wb:set-selection': (d) => orNull(d.id, isStr),
  'wb:set-hover': (d) => orNull(d.id, isStr),
  'wb:measure': (d) => isStr(d.id) && isNum(d.nonce),
  'wb:set-picking': (d) => typeof d.enabled === 'boolean',
  'wb:set-token-vars': (d) => isObj(d.vars) && Object.values(d.vars).every(isStr),
};

const FRAME_SHAPES: Record<string, (d: Rec) => boolean> = {
  'wb:ready': (d) =>
    isStr(d.scene) && (d.side === 'before' || d.side === 'after') && isStrArray(d.selectable),
  'wb:select': (d) => isStampRef(d.node) && isRect(d.rect) && typeof d.altKey === 'boolean',
  'wb:hover': (d) => orNull(d.node, isStampRef) && orNull(d.rect, isRect),
  'wb:measured': (d) => isNum(d.nonce) && orNull(d.rect, isRect),
  'wb:error': (d) =>
    ['mount', 'render', 'compile', 'fetch', 'stream'].includes(d.kind as string) &&
    isStr(d.message) &&
    (d.url === undefined || isStr(d.url)),
  'wb:classes': (d) => isStrArray(d.classes),
  'wb:route-change': (d) => isStr(d.path),
  'wb:deselect': () => true,
  /*
   * MISSING HERE IS WHY PAN AND ZOOM DID NOTHING.
   *
   * `ViewGesture` was added to the `FrameMessage` union and to the host's switch, and
   * the frame posted it — but `shapedLike` refuses any type this table does not own, so
   * every gesture was dropped at the door. Nothing logged it: an unrecognised message
   * is exactly how a foreign `postMessage` is meant to be treated, so the silence was
   * the guard working. The type-level union is not the runtime contract, and this table
   * is; a new frame message has to be added in both places.
   */
  'wb:view': (d) =>
    (d.kind === 'pan' || d.kind === 'zoom') && isNum(d.dx) && isNum(d.dy) && isNum(d.x) && isNum(d.y),
  'wb:debug-report': (d) => typeof d.live === 'boolean',
};

/** `hasOwnProperty`, so a payload typed `"constructor"` cannot borrow a prototype member. */
const shapedLike = (shapes: Record<string, (d: Rec) => boolean>, d: unknown): boolean =>
  isObj(d) &&
  typeof d.type === 'string' &&
  Object.prototype.hasOwnProperty.call(shapes, d.type) &&
  shapes[d.type](d);

export const isHostMessage = (d: unknown): d is HostMessage => shapedLike(HOST_SHAPES, d);

export const isFrameMessage = (d: unknown): d is FrameMessage => shapedLike(FRAME_SHAPES, d);

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
  // DIGITS ONLY, checked before `Number`. `Number('')` is 0, so `Page:0.` parsed
  // as `[0, 0]` and `Page:.0` likewise — a malformed id resolving to a real but
  // DIFFERENT node, which is the wrong anchor this function exists to refuse. The
  // integer check it replaces could not catch that, and let `Page:1e2` through as
  // `[100]` besides. Ids are emitted as `path.join('.')` over non-negative
  // integers, so `\d+` is exactly the shape, and this subsumes the old check.
  const segments = tail === '' ? [] : tail.split('.');
  if (segments.some((s) => !/^\d+$/.test(s))) return null;
  return { file, component, path: segments.map(Number) };
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

/**
 * The same frame, showing ONE COMPONENT across its variants instead of a route.
 *
 * Reuses `/scene` rather than adding a second document: the frame's whole apparatus —
 * the fetch guard, the picker, the providers, the theme pre-paint — applies unchanged,
 * and only what gets mounted differs. A second HTML entry would have had to keep all of
 * that in step.
 *
 * The axes travel ON THE QUERY STRING, encoded `name:a,b|name:c,d`. The frame cannot
 * read them any other way: `/api/metadata` is a bridge call, and the frame's fetch guard
 * exists precisely to stop it making calls. They are short — two axes of six values is
 * well under any URL limit — and passing them explicitly keeps the frame a pure function
 * of its URL, which is what makes reloading it a reliable reset.
 */
export function componentFrameUrl(args: {
  file: string;
  component: string;
  side: FrameSide;
  theme: 'light' | 'dark';
  axes?: Record<string, string[]>;
  /** Extra classes to apply, used to force an interaction state. */
  forced?: string;
  /** Children for the preview — the words inside the button, not the source. */
  label?: string;
  /** JSON stand-ins for the component's required props. */
  mockProps?: Record<string, unknown>;
  /** Required props that are callbacks; the frame supplies no-ops by name. */
  noopProps?: string[];
  /**
   * Where a stand-in glyph sits inside the component, and which one.
   *
   * A separate field from `label` rather than markup inside it: children have to cross a
   * query string, and a string is the only thing that can. The frame turns the pair back
   * into an `<svg>` — see `preview-icons.tsx` for why it draws its own.
   */
  iconSlot?: string;
  icon?: string;
}): string {
  const p = new URLSearchParams({
    file: args.file,
    component: args.component,
    frame: args.side,
    theme: args.theme,
  });
  const axes = Object.entries(args.axes ?? {});
  if (axes.length) p.set('axes', axes.map(([k, v]) => `${k}:${v.join(',')}`).join('|'));
  if (args.forced) p.set('forced', args.forced);
  if (args.label) p.set('label', args.label);
  // JSON on the query string. Bounded by what a component declares — a handful of keys
  // — and keeping the frame a pure function of its URL is what makes a reload a reset.
  if (args.mockProps && Object.keys(args.mockProps).length) {
    p.set('props', JSON.stringify(args.mockProps));
  }
  if (args.noopProps?.length) p.set('noops', args.noopProps.join(','));
  // `none` is the default and says nothing, so it stays off the URL — keeping the query
  // string a description of what was CHOSEN keeps a shared link short and readable.
  if (args.iconSlot && args.iconSlot !== 'none') {
    p.set('iconSlot', args.iconSlot);
    if (args.icon) p.set('icon', args.icon);
  }
  return `${BASE}/scene?${p.toString()}`;
}

/**
 * A view gesture the FRAME observed and the host must act on.
 *
 * The host cannot see these itself: an iframe consumes the wheel and the pointer, so a
 * drag started over the component never surfaces in the host document. The first attempt
 * put a transparent layer on top to catch them, which worked and cost the thing the
 * preview is for — you could no longer hover the button or click it. Forwarding keeps
 * the component interactive and still lets the canvas pan and zoom.
 *
 * Coordinates are relative to the FRAME's viewport; the host adds the frame's offset to
 * zoom about the cursor rather than the corner.
 */
export interface ViewGesture {
  type: 'wb:view';
  kind: 'pan' | 'zoom';
  /** `pan`: movement in CSS px. `zoom`: wheel delta, negative meaning in. */
  dx: number;
  dy: number;
  x: number;
  y: number;
}

/** Inverse of `componentFrameUrl`'s `axes` encoding. */
export function parseAxes(raw: string | null): Record<string, string[]> {
  if (!raw) return {};
  const out: Record<string, string[]> = {};
  for (const part of raw.split('|')) {
    const at = part.indexOf(':');
    if (at <= 0) continue;
    const values = part.slice(at + 1).split(',').filter(Boolean);
    if (values.length) out[part.slice(0, at)] = values;
  }
  return out;
}
