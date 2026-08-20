// The UI hunter's SENSOR — a closed set of named questions the page will answer
// about itself.
//
// WHY THIS EXISTS. Sheets, docs and slides render to Canvas. A browser-automation
// tool that reads the DOM sees one opaque <canvas> rectangle where all the content
// is: the accessibility tree covers the React chrome (toolbar, menus, dialogs) and
// essentially nothing else. So the standard web-agent approach — snapshot the a11y
// tree, reason about it — is blind to the actual product here. This bridge is what
// replaces it, and it is the primary sensor rather than a convenience.
//
// WHY IT IS A CLOSED REGISTRY AND NOT `page.evaluate(<model-authored JS>)`. The
// caller names a reader; it cannot supply code. An unknown name is refused with the
// list of valid ones. That keeps the eventual model-driven caller (PR 3) bounded by
// code reviewed in this repository rather than by a prompt, which is the same
// property `assertSafeArgv` gives the CLI hunter.
//
// INVARIANT: every reader is a PURE READ. A reader that focused a cell or committed
// an edit would make observation indistinguishable from interaction, and the whole
// pipeline downstream assumes the action list is the complete causal history. If you
// need to change something, that is an action, not a reader.

import type { Block, EditorAPI, InlineStyle, StoredColor } from "@wafflebase/docs";
import { formatValue, parseRef, toSref, type MemStore, type Spreadsheet } from "@wafflebase/sheets";
// TYPE-ONLY, and it has to stay that way. `@wafflebase/slides`'s entry point re-exports
// `importPptx`, so a VALUE import from it drags jszip and the whole PPTX importer into
// whatever loads this module — and this module loads on every surface, including the two
// that have no slides on them. Measured: importing it for a single constant took the hunt
// route past `networkidle` on a cold Vite dev server, and the oracle lane failed on its
// first navigation with a 30s timeout before printing a single check.
//
// `SLIDE_WIDTH` therefore arrives on the handle instead of being imported. The page already
// knows it — it is the number the page sized the canvas against — and taking it from there
// keeps the scale a single fact rather than two that can disagree.
import { worldToScreen, type Element, type MemSlidesStore, type SlidesEditor, type Viewport } from "@wafflebase/slides";

// The bounds predicate lives beside the seed geometry so both are unit-testable without a
// browser. See `isOffSlide` for why this branch was unreachable from the oracle lane.
import { isOffSlide } from "./slides-seed";

export const HUNT_BRIDGE_KEY = "__WB_HUNT__";

export type HuntSurface = "sheet" | "doc" | "slides" | "board";

export type SheetHandle = {
  spreadsheet: Spreadsheet;
  store: MemStore;
  host: HTMLElement;
};

export type DocHandle = {
  editor: EditorAPI;
  host: HTMLElement;
};

/**
 * A board is the slides editor over ONE unbounded plane, so it shares `SlidesEditor` and a
 * `SlidesStore`. What it does not share is the coordinate system: there is no slide rect and
 * no fixed fit-scale, only a `Viewport` the host owns and pans/zooms. Every point reader on
 * this surface has to go through that, which is why the handle carries it rather than a
 * `slideWidth`.
 */
export type BoardHandle = {
  editor: SlidesEditor;
  store: MemSlidesStore;
  host: HTMLElement;
  /** Read fresh on every call — the host mutates this as the user pans and zooms. */
  viewport: () => Viewport;
};

export type SlidesHandle = {
  editor: SlidesEditor;
  store: MemSlidesStore;
  host: HTMLElement;
  /** `SLIDE_WIDTH`, supplied by the page so this module needs no value import from slides. */
  slideWidth: number;
};

/**
 * One element on the current slide, flattened to what a prediction can name.
 *
 * THE `doc.runs` OF THIS SURFACE — the general reader everything else builds on. Frames
 * are reported in SLIDE-LOGICAL pixels (the 1920x1080 coordinate space the model stores),
 * never in screen pixels: the same deck at a different window size would otherwise read
 * differently, and a reader whose value depends on the viewport cannot support a
 * round-trip prediction at all.
 *
 * `text` is the element's plain text, joined the same way `doc.text` joins a document.
 *
 * IT SHOWS COMMITTED TEXT ONLY, and that is a property of the engine rather than of this
 * reader. The slides text editor is a docs editor mounted in the overlay, and it writes
 * back to the store on BLUR — measured: type `XX` into the title and this still reports
 * `"Quarterly review"`; press Escape and it still does, because Escape CANCELS; click
 * another element and it reports `"XXQuarterly review"`. So a prediction about typing has
 * to put a commit between the keystrokes and the read, and a prediction that types and
 * then undoes without committing is asserting against something that never happened.
 * An earlier version of this comment claimed typing was observable directly, and the brief
 * built on it would have produced exactly that empty round trip.
 *
 * Absent on elements that hold no text rather than reported as `""`, because "this shape
 * cannot hold text" and "this box is empty" are different states and #749's whole lesson
 * is that collapsing those is how residue hides.
 *
 * GROUP CHILDREN ARE NOT FLATTENED IN. A group's children live in group-local
 * coordinates, so reporting them beside slide-level elements would put two different
 * coordinate spaces in one list under the same field names — the reader would be lying
 * about `x` for exactly the elements a group operation moves. `childCount` says the
 * children are there without pretending to locate them.
 */
export type ElementSnapshot = {
  id: string;
  type: Element["type"];
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  text?: string;
  childCount?: number;
};

/** A flattened text run — one `Inline`, with the style fields worth asserting on. */
export type RunSnapshot = {
  blockIndex: number;
  text: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  href?: string;
  /**
   * Emitted RAW, never resolved to a hex string.
   *
   * `StoredColor` is a union — a bare hex string, `{kind:'srgb'}`, or a
   * `{kind:'role'}` theme reference — and the docs model's own `storedColorsEqual`
   * treats a string and an equivalent `{kind:'srgb'}` as DIFFERENT. Running these
   * through `defaultColorResolver` would collapse that distinction, and collapsing
   * is what hides the defect class this reader exists to expose: #749 is a toggle
   * leaving `italic: false` behind, invisible unless "unset" and "explicitly set"
   * stay distinguishable. `stable()` in `hunt-ui-expect.mjs` refuses to fold
   * `undefined` into `null` for the same reason; a resolving reader would undo it.
   *
   * `doc.styleSummary` already reports colour, but selection-scoped and collapsed to
   * `'mixed'` — no per-run structure, so residue in one run of three reads the same
   * as a clean apply. That is the gap these two fields close.
   */
  color?: StoredColor;
  backgroundColor?: StoredColor;
};

type BridgeState = {
  ready: boolean;
  surface: HuntSurface;
  sheet: SheetHandle | null;
  doc: DocHandle | null;
  slides: SlidesHandle | null;
  board: BoardHandle | null;
};

export type HuntBridge = {
  ready(): boolean;
  surface(): HuntSurface;
  readers(): string[];
  read(name: string, args?: unknown[]): Promise<unknown>;
};

export type HuntBridgeController = {
  bridge: HuntBridge;
  setReady(ready: boolean): void;
  setSurface(surface: HuntSurface): void;
  setSheet(handle: SheetHandle | null): void;
  setDoc(handle: DocHandle | null): void;
  setSlides(handle: SlidesHandle | null): void;
  setBoard(handle: BoardHandle | null): void;
  dispose(): void;
};

/**
 * Thrown when a reader cannot run. Carried across `page.evaluate` as a plain
 * message, which the driver turns into a readable refusal rather than a crash —
 * "you asked for something that does not exist" must not look like "the app broke".
 */
function refuse(message: string): never {
  throw new Error(`[hunt-bridge] ${message}`);
}

function requireSheet(state: BridgeState): SheetHandle {
  if (!state.sheet) {
    refuse(`sheet reader used while surface is "${state.surface}" — goto the sheet surface first`);
  }
  return state.sheet;
}

function requireDoc(state: BridgeState): DocHandle {
  if (!state.doc) {
    refuse(`doc reader used while surface is "${state.surface}" — goto the doc surface first`);
  }
  return state.doc;
}

function requireBoard(state: BridgeState): BoardHandle {
  if (!state.board) {
    refuse(`board reader used while surface is "${state.surface}" — goto the board surface first`);
  }
  return state.board;
}

/** The board's single plane. Its id is synthetic and the store has exactly one. */
function boardPlane(handle: BoardHandle) {
  const slide = handle.store.read().slides[0];
  if (!slide) refuse("the board has no plane — the harness is not mounted correctly");
  return slide;
}

function requireSlides(state: BridgeState): SlidesHandle {
  if (!state.slides) {
    refuse(`slides reader used while surface is "${state.surface}" — goto the slides surface first`);
  }
  return state.slides;
}

function asNumber(args: unknown[], i: number, reader: string): number {
  const v = args[i];
  // `Number.isFinite`, not `typeof === "number"`: `typeof NaN === "number"`, and a NaN
  // coordinate resolves to a finite-looking point that clicks nothing. Same reasoning as
  // the finite check in `resolveTarget`.
  if (typeof v !== "number" || !Number.isFinite(v)) {
    refuse(`${reader} needs a finite number at position ${i}, got ${JSON.stringify(v)}`);
  }
  return v;
}

function asString(args: unknown[], i: number, reader: string): string {
  const v = args[i];
  if (typeof v !== "string" || v === "") {
    refuse(`${reader} needs a non-empty string argument at position ${i}, got ${JSON.stringify(v)}`);
  }
  return v;
}

/**
 * Flatten the body blocks into runs.
 *
 * `getContextBlocks()` is the editor's own notion of "the blocks currently being
 * edited" (body, or header/footer when that context is active), so a reader built on
 * it observes what the user is actually looking at rather than a fixed region.
 */
function runsOf(editor: EditorAPI): RunSnapshot[] {
  const blocks: Block[] = editor.getDoc().getContextBlocks();
  const out: RunSnapshot[] = [];
  blocks.forEach((block, blockIndex) => {
    for (const inline of block.inlines) {
      const style: InlineStyle = inline.style ?? {};
      out.push({
        blockIndex,
        text: inline.text,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        strikethrough: style.strikethrough,
        href: style.href,
        color: style.color,
        backgroundColor: style.backgroundColor,
      });
    }
  });
  return out;
}

/** The plain text of an element, or `undefined` when it is not a kind that holds text. */
function textOfElement(element: Element): string | undefined {
  // Only these two carry a body. A table's text lives per cell and a chart's inside its
  // cached series, and inventing a join for either would report a string no single
  // control on the toolbar can change — which is how a reader manufactures a defect.
  const blocks =
    element.type === "text" ? element.data.blocks : element.type === "shape" ? element.data.text?.blocks : undefined;
  if (!blocks) return undefined;
  return blocks.map((b: Block) => b.inlines.map((i) => i.text).join("")).join("\n");
}

/**
 * The slide the editor is currently showing, refusing rather than guessing when there is none.
 *
 * THE MESSAGE CARRIES NO SLIDE ID, AND BLAMES NOBODY. Both were wrong in the first version
 * and each cost something.
 *
 * The id was a GENERATED uuid, so the refusal read differently on every attempt —
 * `uiObservedKey` saw a fresh value each time, replay judged the candidate
 * non-deterministic, and the gate dropped a defect that reproduces 3 times out of 3 (#883:
 * undoing `Add slide` leaves the editor pointing at the removed slide). A volatile value in
 * an observation suppresses findings silently, which is why `scrubUiVolatile` exists for
 * block ids; slide ids simply did not match its pattern. Not naming the id costs nothing —
 * `slides.slideCount` and `slides.currentSlideIndex` are both readable at the same moment
 * and say more.
 *
 * The old wording asserted "the harness is broken, not the product", which is exactly
 * backwards here: the editor legitimately points at a slide the store no longer has,
 * because undo removed it. A refusal that tells the reader where to look must not guess,
 * and this one guessed wrong in the direction that wastes a maintainer's time.
 */
function currentSlide(handle: SlidesHandle) {
  const id = handle.editor.getCurrentSlideId();
  const slide = handle.store.read().slides.find((s) => s.id === id);
  if (!slide) {
    refuse(
      "the editor's current slide is not in the document — it points at a slide the store " +
        "does not have. Read slides.slideCount and slides.currentSlideIndex to see the deck's " +
        "actual state; a null index means the same thing this refusal does.",
    );
  }
  return slide;
}

/**
 * The reader registry.
 *
 * Names are namespaced by surface so the driver can route without guessing, and so
 * `dom.*` readers (which need Playwright locators, not page state) can live in the
 * driver without colliding. Adding a reader here is the intended way to widen what
 * the hunter can observe — adding an escape hatch is not.
 */
function buildReaders(state: BridgeState): Record<string, (args: unknown[]) => unknown> {
  return {
    // --- docs -------------------------------------------------------------
    "doc.text": () =>
      requireDoc(state)
        .editor.getDoc()
        .getContextBlocks()
        .map((b) => b.inlines.map((i) => i.text).join(""))
        .join("\n"),

    "doc.blockCount": () => requireDoc(state).editor.getDoc().getContextBlocks().length,

    /** Every run with its style — the general reader most doc expectations build on. */
    "doc.runs": () => runsOf(requireDoc(state).editor),

    /**
     * Font size per run, in document order.
     *
     * Derived from `doc.runs` rather than stored separately so the two can never
     * disagree. This is the reader issue #343 turns on: "increase font size on a
     * mixed-size selection" must raise every entry, and the bug is that it collapses
     * them all to the minimum.
     */
    "doc.fontSizes": () => runsOf(requireDoc(state).editor).map((r) => r.fontSize),

    "doc.blockTypes": () =>
      requireDoc(state)
        .editor.getDoc()
        .getContextBlocks()
        .map((b) => b.type),

    /** What the toolbar itself reads — `number | 'mixed' | undefined` per property. */
    "doc.styleSummary": () => requireDoc(state).editor.getRangeStyleSummary(),

    "doc.selection": () => {
      const sel = requireDoc(state).editor.getActiveSelection();
      if (!sel) return null;
      return {
        anchor: { blockId: sel.anchor.blockId, offset: sel.anchor.offset },
        focus: { blockId: sel.focus.blockId, offset: sel.focus.offset },
      };
    },

    "doc.linkCount": () => runsOf(requireDoc(state).editor).filter((r) => typeof r.href === "string").length,

    /**
     * Can this surface undo right now?
     *
     * Exposed because the two in-memory stores DISAGREE, and a caller that assumes
     * otherwise produces a confident false finding. Measured live:
     *
     *   MemDocStore  real snapshot-based undo/redo stacks (docs/src/store/memory.ts)
     *   MemStore     `undo()` returns {success:false}; `canUndo()` returns false,
     *                marked "No-op for memory store (no history tracking)"
     *
     * So "I edited, then undid, so the value came back" is a sound prediction on the
     * doc surface and an unsound one on the sheet surface — not because the product
     * is broken, but because the sheet mount is a test double without history. The
     * real app uses a Yorkie-backed store that has it. Asking before predicting is
     * the difference between a finding and noise.
     */
    "doc.canUndo": () => requireDoc(state).editor.getStore().canUndo(),

    // --- sheets -----------------------------------------------------------
    /**
     * The value a cell STORES — `cell.v`, before any number format is applied.
     *
     * NOT the string on screen, despite what this reader was called for its first year.
     * Number formats live in the style (`nf`/`dp`/`cu`) and are applied at PAINT time by
     * `formatValue`, so `Increase decimal places` and `Format as percent` correctly leave
     * `cell.v` byte-identical. Measured: a live run clicked those controls, watched
     * `sheet.activeCellStyle` go `null -> {dp:1,nf:"number"} -> {nf:"number",dp:3}` while
     * this reader stayed `"100"`, and proposed "number formats never reach the displayed
     * value" on four grounded predictions. The app was right and the reader's own
     * description had promised the wrong thing.
     *
     * `sheet.activeCellDisplay` is the one that answers "what does it say on screen".
     */
    "sheet.cellValue": async (args) => {
      const sref = asString(args, 0, "sheet.cellValue");
      const cell = await requireSheet(state).store.get(parseRef(sref));
      return cell?.v ?? null;
    },

    "sheet.cellFormula": async (args) => {
      const sref = asString(args, 0, "sheet.cellFormula");
      const cell = await requireSheet(state).store.get(parseRef(sref));
      return cell?.f ?? null;
    },

    "sheet.activeCell": () => {
      const active = requireSheet(state).spreadsheet.getActiveCell();
      return active ? toSref(active) : null;
    },

    "sheet.selectionRange": () => {
      const range = requireSheet(state).spreadsheet.getSelectionRangeOrActiveCell();
      if (!range) return null;
      return { start: toSref(range[0]), end: toSref(range[1]) };
    },

    /** See `doc.canUndo`. Reports `false` here, because `MemStore` has no history. */
    "sheet.canUndo": () => requireSheet(state).store.canUndo(),

    /**
     * Every RANGE STYLE PATCH the sheet holds — where toolbar styling actually lands.
     *
     * The obvious reader here was a per-cell one, and it was wrong. `Sheet.setRangeStyle`
     * appends a patch and then calls `applyStylePatchToExistingCells`, which skips any
     * cell that does not ALREADY carry its own style:
     *
     *     const existing = await this.store.get(anchor);
     *     if (!existing?.s) continue;
     *
     * So selecting a populated, unstyled cell and clicking Bold leaves `cell.s` null and
     * puts the style in this list instead. Measured while building the oracle check for
     * this: `sheet.activeCellStyle` reported `{b:true}` and a per-cell reader reported
     * `null`, for a cell holding "Label" — the style was applied and simply was not there
     * to read. A reader whose common case is a silent null is a trap, not a sensor.
     *
     * Patches are `{range, style}` and ACCUMULATE: toggling Bold on and off appends two,
     * `{b:true}` then `{b:false}`, rather than removing the first. That is the shape a
     * round trip should be predicted against here, and whether the growth is a defect is
     * exactly the kind of question this reader exists to make askable.
     */
    /**
     * What the active cell READS AS ON SCREEN — `cell.v` with its number format applied.
     *
     * Composed rather than borrowed: `Sheet.toDisplayString` does exactly this but lives
     * on the `Sheet`, and `Spreadsheet` exposes no accessor for it. Every piece needed is
     * already public — `getActiveCell`, `getActiveStyle`, and `formatValue` from the
     * package — so this needs no product change to serve a harness.
     *
     * ACTIVE CELL ONLY, for the same reason `sheet.activeCellStyle` is: the effective
     * style of an arbitrary ref is not reachable from here, and a per-ref version would
     * need a new public method on the engine.
     *
     * Without this, an entire toolbar section — `Format as percent`, `Format as
     * currency`, `Increase`/`Decrease decimal places`, `More formats` — was reachable and
     * unobservable, which is worse than unreachable: the explorer clicks the controls,
     * sees the STORED value correctly not move, and proposes a defect that is not there.
     */
    "sheet.activeCellDisplay": async () => {
      const { spreadsheet, store } = requireSheet(state);
      const active = spreadsheet.getActiveCell();
      if (!active) return null;
      const cell = await store.get(active);
      // Empty cells answer `""`, mirroring `Sheet.toDisplayString`'s own guard rather
      // than inventing a second convention: the product shows nothing for an empty
      // cell, and a reader that said `null` here would make "empty" and "no active
      // cell" the same reading. Without this, `formatValue(undefined, ...)` returns
      // `undefined`, which `isUnusableValue` treats as unevaluable for ever — caught
      // by the registry check on the seed's empty B2.
      if (!cell || !cell.v) return "";
      const style = await spreadsheet.getActiveStyle();
      return formatValue(cell.v, style?.nf, style?.dp, { currency: style?.cu });
    },

    "sheet.rangeStyles": () => requireSheet(state).store.getRangeStyles(),

    "sheet.activeCellStyle": async () => (await requireSheet(state).spreadsheet.getActiveStyle()) ?? null,

    /**
     * Viewport coordinates of a cell's centre.
     *
     * This is how a caller clicks something that only exists as pixels on a canvas:
     * the grid has no DOM node per cell, so only the engine can say where `B2` is.
     * Mirrors `getCellCenterClientPoint` in the interaction harness.
     */
    // --- board -------------------------------------------------------------
    //
    // Deliberately mirrors the slides readers, because it is the same engine over one
    // unbounded plane. The difference is entirely in the point readers: a board has no slide
    // rect and no fixed fit-scale, so world->screen goes through the live `Viewport`.

    /** Every element on the board's single plane, in WORLD coordinates. */
    "board.elements": (): ElementSnapshot[] =>
      boardPlane(requireBoard(state)).elements.map((el) => {
        const snapshot: ElementSnapshot = {
          id: el.id,
          type: el.type,
          x: el.frame.x,
          y: el.frame.y,
          w: el.frame.w,
          h: el.frame.h,
          rotation: el.frame.rotation,
        };
        const text = textOfElement(el);
        if (text !== undefined) snapshot.text = text;
        if (el.type === "group") snapshot.childCount = el.data.children.length;
        return snapshot;
      }),

    "board.selection": () => [...requireBoard(state).editor.getSelection()],

    "board.elementCount": () => boardPlane(requireBoard(state)).elements.length,

    /** See `doc.canUndo`. Real here — the board store keeps undo stacks. */
    "board.canUndo": () => requireBoard(state).store.canUndo(),

    /**
     * Where the view is looking: pan in screen px, zoom as world px -> screen px.
     *
     * EXPOSED BECAUSE IT IS STATE THE USER CHANGES. On a bounded slide the transform is a
     * constant and worth hiding; on an unbounded plane it is the thing scrolling and zooming
     * alter, so a prediction about "did the view move" needs to name it. It is also what makes
     * an off-screen refusal explicable rather than mysterious.
     */
    "board.viewport": () => {
      const { panX, panY, zoom } = requireBoard(state).viewport();
      return { panX, panY, zoom };
    },

    /**
     * Viewport coordinates of a WORLD point.
     *
     * Uses the engine's own `worldToScreen` rather than re-deriving it. The slides equivalent
     * had to invert `clientToLogical` by hand and carry a comment pinning the two together;
     * here the forward transform is exported, so there is nothing to keep in step.
     */
    "board.pointAt": (args) => {
      const wx = asNumber(args, 0, "board.pointAt");
      const wy = asNumber(args, 1, "board.pointAt");
      const handle = requireBoard(state);
      const canvas = handle.host.querySelector("canvas");
      if (!canvas) refuse("board.pointAt has no canvas to measure against — is the editor mounted?");
      const origin = canvas.getBoundingClientRect();
      const local = worldToScreen(handle.viewport(), { x: wx, y: wy });
      const point = { x: Math.round(origin.left + local.x), y: Math.round(origin.top + local.y) };
      if (isOffSlide(point, origin)) {
        const vp = handle.viewport();
        refuse(
          `board.pointAt(${wx}, ${wy}) is off-screen at (${point.x}, ${point.y}). A board is ` +
            "UNBOUNDED, so most of it is off-screen at any moment — this is the normal state of a " +
            `point you have not scrolled to, NOT a defect. The view is at pan (${Math.round(vp.panX)}, ` +
            `${Math.round(vp.panY)}) zoom ${vp.zoom}; scroll toward it, or read board.elements and ` +
            "aim at something that is on screen.",
        );
      }
      return point;
    },

    /** An element's centre, in viewport coordinates. Same refusal reasoning as `board.pointAt`. */
    "board.elementCenter": (args) => {
      const id = asString(args, 0, "board.elementCenter");
      const handle = requireBoard(state);
      const element = boardPlane(handle).elements.find((el) => el.id === id);
      if (!element) {
        const available = boardPlane(handle)
          .elements.map((el) => el.id)
          .join(", ");
        refuse(
          `board.elementCenter(${JSON.stringify(id)}) — no element with that id on the board. ` +
            `Available: ${available || "(the board is empty)"}. Read board.elements for the list.`,
        );
      }
      const canvas = handle.host.querySelector("canvas");
      if (!canvas) refuse(`board.elementCenter(${id}) has no canvas to measure against`);
      const origin = canvas.getBoundingClientRect();
      const local = worldToScreen(handle.viewport(), {
        x: element.frame.x + element.frame.w / 2,
        y: element.frame.y + element.frame.h / 2,
      });
      const point = { x: Math.round(origin.left + local.x), y: Math.round(origin.top + local.y) };
      if (isOffSlide(point, origin)) {
        refuse(
          `board.elementCenter(${id}) is off-screen at (${point.x}, ${point.y}) — the element is ` +
            "outside the current view. Scroll to bring it into view; clicking there would land on nothing.",
        );
      }
      return point;
    },

    /** A selection handle's centre. Identical to the slides reader — handles are the same DOM nodes. */
    "board.handleCenter": (args) => {
      const kind = asString(args, 0, "board.handleCenter");
      const handle = requireBoard(state);
      const nodes = [...handle.host.querySelectorAll<HTMLElement>("[data-handle]")];
      const found = nodes.find((n) => n.dataset.handle === kind);
      if (!found) {
        const available = nodes.map((n) => n.dataset.handle).join(", ");
        refuse(
          `board.handleCenter(${JSON.stringify(kind)}) — no such handle. ` +
            (available ? `Available: ${available}.` : "Nothing is selected, so there are no handles; click an element first."),
        );
      }
      const rect = found.getBoundingClientRect();
      const point = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      const canvas = handle.host.querySelector("canvas");
      if (!canvas) refuse(`board.handleCenter(${kind}) has no canvas to measure against`);
      if (isOffSlide(point, canvas.getBoundingClientRect())) {
        refuse(`board.handleCenter(${kind}) is off-screen at (${point.x}, ${point.y}) — scroll its element into view.`);
      }
      return point;
    },

    // --- slides ------------------------------------------------------------
    /**
     * Every element on the current slide — the general reader slides predictions build on.
     *
     * Slide-logical coordinates, so a round trip is predictable: `Bring forward` then
     * `Send backward` must return this list to the reading taken before, and a nudge of
     * one arrow key must move exactly one element by exactly one step. Both are
     * properties, which is what makes them worth predicting.
     */
    "slides.elements": (): ElementSnapshot[] =>
      currentSlide(requireSlides(state)).elements.map((el) => {
        const snapshot: ElementSnapshot = {
          id: el.id,
          type: el.type,
          x: el.frame.x,
          y: el.frame.y,
          w: el.frame.w,
          h: el.frame.h,
          rotation: el.frame.rotation,
        };
        const text = textOfElement(el);
        if (text !== undefined) snapshot.text = text;
        if (el.type === "group") snapshot.childCount = el.data.children.length;
        return snapshot;
      }),

    /**
     * The ids currently selected, in the editor's own order.
     *
     * AN ARRAY, and the coverage memory understands that shape as of #847 — an empty list
     * is `none`, one id is `element`, more is `element-multi`. Selection here is a SET of
     * objects rather than a span, which is why neither the doc nor the sheet shape fits.
     */
    "slides.selection": () => [...requireSlides(state).editor.getSelection()],

    "slides.slideCount": () => requireSlides(state).store.read().slides.length,

    /**
     * WHICH slide is showing, as a 1-based index rather than its id.
     *
     * Ids are opaque and the seed's are only stable because this harness fixes them; an
     * index is what a prediction about `Next slide` can actually name, and it stays
     * meaningful when a slide is inserted before the current one.
     */
    "slides.currentSlideIndex": () => {
      const handle = requireSlides(state);
      const id = handle.editor.getCurrentSlideId();
      const at = handle.store.read().slides.findIndex((s) => s.id === id);
      return at < 0 ? null : at + 1;
    },

    /** See `doc.canUndo`. Reports TRUTHFULLY here — `MemSlidesStore` has real undo stacks. */
    "slides.canUndo": () => requireSlides(state).store.canUndo(),

    /**
     * Viewport coordinates of an element's centre — how a caller clicks something that
     * exists only as pixels on a canvas.
     *
     * THE INVERSE OF THE EDITOR'S OWN `clientToLogical`, deliberately spelled out the same
     * way round rather than approximated:
     *
     *     logical = (client - rect.left) / scale - offset      // editor.ts
     *     client  = rect.left + (logical + offset) * scale     // here
     *
     * with `scale = hostWidth / SLIDE_WIDTH` and the offsets zero, because this harness
     * sizes the canvas to the slide exactly (no pasteboard). If that ever stops being
     * true, this reader is the thing that breaks, and it breaks by selecting the wrong
     * element — which is why it verifies the hit rather than trusting the arithmetic.
     *
     * ROTATION IS IGNORED ON PURPOSE: rotation is around the frame centre, so the centre
     * is the one point on an element that rotation cannot move.
     */
    /**
     * Viewport coordinates of an arbitrary point on the slide, named in SLIDE-LOGICAL
     * coordinates — the 1920x1080 space the model stores.
     *
     * THE DESTINATION VOCABULARY A DRAG NEEDS. Every other target is a control or an
     * element's centre, so "move this 200px right" was inexpressible: there was nowhere to
     * drag TO. This is the smallest addition that fixes that, and it is deliberately not a
     * screen-pixel escape hatch — slide-logical keeps a plan meaning the same thing at any
     * window size, which is the whole reason the harness pins its canvas to half of
     * 1920x1080.
     *
     * Refuses off-slide for the reason `slides.elementCenter` does: a point outside the
     * canvas is finite, clickable-looking, and lands on nothing.
     */
    "slides.pointAt": (args) => {
      const x = asNumber(args, 0, "slides.pointAt");
      const y = asNumber(args, 1, "slides.pointAt");
      const handle = requireSlides(state);
      const canvas = handle.host.querySelector("canvas");
      if (!canvas) refuse("slides.pointAt has no slide canvas to measure against — is the editor mounted?");
      const origin = canvas.getBoundingClientRect();
      const scale = origin.width / handle.slideWidth;
      const point = { x: Math.round(origin.left + x * scale), y: Math.round(origin.top + y * scale) };
      if (isOffSlide(point, origin)) {
        refuse(
          `slides.pointAt(${x}, ${y}) is off-slide — a slide is ${handle.slideWidth} wide in these ` +
            "coordinates, so that point is outside it. Clicking or dragging there would land on " +
            "nothing, which is NOT a defect.",
        );
      }
      return point;
    },

    /**
     * Viewport coordinates of a selection handle's centre, by kind.
     *
     * Read from the handle's OWN `getBoundingClientRect`, not from its `style.left`/`top`.
     * Those are the top-LEFT corner (`left = cx - HANDLE_SIZE / 2`), so treating them as the
     * centre aims half a handle off — close enough to work inside the hit tolerance, which is
     * exactly the kind of nearly-right that fails once on a small handle and looks like a
     * product bug. The rect is also correct regardless of what the CSS does next.
     *
     * Handles exist only while something is selected, and which ones exist depends on WHAT is
     * selected — a connector has `start`/`end`/`bend`, a parametric shape has `adjust-N`, a
     * plain element has the eight resize handles plus `rotate`. So the refusal lists what is
     * actually there rather than the theoretical set.
     */
    "slides.handleCenter": (args) => {
      const kind = asString(args, 0, "slides.handleCenter");
      const handle = requireSlides(state);
      const nodes = [...handle.host.querySelectorAll<HTMLElement>("[data-handle]")];
      const found = nodes.find((n) => n.dataset.handle === kind);
      if (!found) {
        const available = nodes.map((n) => n.dataset.handle).join(", ");
        refuse(
          `slides.handleCenter(${JSON.stringify(kind)}) — no such handle. ` +
            (available
              ? `Available: ${available}.`
              : "Nothing is selected, so there are no handles; click an element first."),
        );
      }
      const rect = found.getBoundingClientRect();
      const point = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      const canvas = handle.host.querySelector("canvas");
      if (!canvas) refuse(`slides.handleCenter(${kind}) has no slide canvas to measure against`);
      if (isOffSlide(point, canvas.getBoundingClientRect())) {
        refuse(
          `slides.handleCenter(${kind}) is off-slide at (${point.x}, ${point.y}) — the handle sits ` +
            "outside the visible canvas, which happens when its element is flush against the slide " +
            "edge. Move the element inward, or use a handle on the other side.",
        );
      }
      return point;
    },

    "slides.elementCenter": (args) => {
      const id = asString(args, 0, "slides.elementCenter");
      const handle = requireSlides(state);
      const element = currentSlide(handle).elements.find((el) => el.id === id);
      if (!element) {
        const available = currentSlide(handle)
          .elements.map((el) => el.id)
          .join(", ");
        refuse(
          `slides.elementCenter(${JSON.stringify(id)}) — no element with that id on the current slide. ` +
            `Available: ${available || "(the slide is empty)"}. Read slides.elements for the list.`,
        );
      }
      const canvas = handle.host.querySelector("canvas");
      if (!canvas) {
        refuse(`slides.elementCenter(${id}) has no slide canvas to measure against — is the editor mounted?`);
      }
      const origin = canvas.getBoundingClientRect();
      const scale = origin.width / handle.slideWidth;
      const x = Math.round(origin.left + (element.frame.x + element.frame.w / 2) * scale);
      const y = Math.round(origin.top + (element.frame.y + element.frame.h / 2) * scale);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        refuse(`slides.elementCenter(${id}) resolved to a non-finite point (${x}, ${y}) — is the slide laid out?`);
      }
      // OFF-SLIDE ELEMENTS REFUSE, for the reason `sheet.cellCenter` does. An element
      // dragged past the slide edge resolves to a perfectly finite point outside the
      // canvas; clicking there selects nothing and reports no error, so the caller sees a
      // click that "did not work" and cannot tell that from a broken app. The first sheet
      // run proposed exactly that as a major defect.
      if (isOffSlide({ x, y }, origin)) {
        refuse(
          `slides.elementCenter(${id}) is off-slide at (${x}, ${y}) — its centre lies outside the visible ` +
            `canvas (${Math.round(origin.left)},${Math.round(origin.top)})-(${Math.round(origin.right)},${Math.round(origin.bottom)}). ` +
            "Clicking there would select nothing, which is NOT a defect. Move it back on-slide, or use an element that is visible.",
        );
      }
      return { x, y };
    },

    "sheet.cellCenter": (args) => {
      const sref = asString(args, 0, "sheet.cellCenter");
      const { spreadsheet, host } = requireSheet(state);
      const rect = spreadsheet.getCellRect(parseRef(sref));
      // Origin is the GRID CANVAS, not the mount container. `getCellRect` is
      // canvas-relative, and the engine paints a band of its own chrome above the
      // canvas — measured at 43px here (container top 41, canvas top 84). Adding the
      // container's origin instead puts every point that many pixels high, which
      // silently lands clicks one or two rows off: asking for C3 selected C1.
      //
      // `getCellCenterClientPoint` in the interaction harness has the same formula
      // and the same error; it goes unnoticed there because that lane only ever
      // `mouse.move`s to the point for a wheel event, and a scroll does not care
      // which row it starts on. Nothing in this repo has clicked a cell by
      // coordinate before, so this is the first use that could expose it.
      const canvas = host.querySelector("canvas");
      if (!canvas) {
        refuse(`sheet.cellCenter(${sref}) has no grid canvas to measure against — is the sheet mounted?`);
      }
      const origin = canvas.getBoundingClientRect();
      const x = Math.round(origin.left + rect.left + rect.width / 2);
      const y = Math.round(origin.top + rect.top + rect.height / 2);
      // Refuse here rather than hand back NaN. A caller clicking at NaN gets an
      // opaque Playwright error pointing at the mouse, not at the cell reference or
      // the unmeasurable host that actually caused it.
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        refuse(`sheet.cellCenter(${sref}) resolved to a non-finite point (${x}, ${y}) — is the grid laid out?`);
      }
      // REFUSE A POINT THAT IS NOT ON THE GRID.
      //
      // A scrolled-away cell resolves to a perfectly finite coordinate outside the
      // canvas — negative `y` for anything above the viewport. Clicking there lands
      // on nothing, selects nothing, and reports no error, so the caller sees a click
      // that "did not work" and has no way to tell that from a broken app.
      //
      // Measured: the first live sheet run scrolled, clicked C20/C25/C5 — all of them
      // now above the viewport at y between -365 and -710 — and proposed "after the
      // grid is scrolled, mouse clicks no longer select any cell", major severity,
      // ground A, reproducing deterministically because the coordinates are stable.
      // Clicks after a scroll are fine; the cells were simply not there any more.
      // Only a verifier timeout stopped it being reported.
      //
      // So this refuses instead, and says what to do about it. A readable refusal
      // costs one action; a false report costs a maintainer's trust.
      if (x < origin.left || x > origin.right || y < origin.top || y > origin.bottom) {
        refuse(
          `sheet.cellCenter(${sref}) is off-screen at (${x}, ${y}) — the grid is scrolled ` +
            `so that cell is outside the visible canvas (${Math.round(origin.left)},${Math.round(origin.top)})-` +
            `(${Math.round(origin.right)},${Math.round(origin.bottom)}). Clicking there would land on nothing ` +
            "and select nothing, which is NOT a defect. Scroll it back into view, or use a cell that is visible.",
        );
      }
      return { x, y };
    },
  };
}

/**
 * Install the bridge on `window` and return the handles the page uses to keep it
 * current. The page owns mounting; this owns answering questions about what is
 * mounted.
 */
export function installHuntBridge(): HuntBridgeController {
  const state: BridgeState = { ready: false, surface: "sheet", sheet: null, doc: null, slides: null, board: null };
  const readers = buildReaders(state);

  const bridge: HuntBridge = {
    ready: () => state.ready,
    surface: () => state.surface,
    readers: () => Object.keys(readers).sort(),
    read: async (name, args = []) => {
      // `Object.hasOwn`, not `readers[name]`. A plain object literal inherits from
      // Object.prototype, so `readers["toString"]`, `["constructor"]` and
      // `["valueOf"]` all resolve to inherited FUNCTIONS and were invoked instead of
      // refused. Harmless in effect here — nothing dangerous is reachable that way —
      // but a reader registry whose membership test is a prototype-chain lookup is not
      // the closed set this design claims, and the closed set is the safety property.
      // `hasOwnProperty.call`, not `Object.hasOwn` — this file compiles under a
      // pre-ES2022 lib target.
      if (!Object.prototype.hasOwnProperty.call(readers, name)) {
        refuse(`unknown reader ${JSON.stringify(name)}. Valid readers: ${Object.keys(readers).sort().join(", ")}`);
      }
      const reader = readers[name];
      // Awaited here so a rejected reader surfaces as a refusal from `read` rather
      // than as an unhandled rejection inside the page — which the crash oracle
      // would then report as a defect in the app under test.
      return await reader(Array.isArray(args) ? args : []);
    },
  };

  const owner = window as unknown as Record<string, unknown>;
  owner[HUNT_BRIDGE_KEY] = bridge;

  return {
    bridge,
    setReady: (ready) => {
      state.ready = ready;
    },
    setSurface: (surface) => {
      state.surface = surface;
    },
    setSheet: (handle) => {
      state.sheet = handle;
    },
    setDoc: (handle) => {
      state.doc = handle;
    },
    setSlides: (handle) => {
      state.slides = handle;
    },
    setBoard: (handle) => {
      state.board = handle;
    },
    dispose: () => {
      state.ready = false;
      state.sheet = null;
      state.doc = null;
      state.slides = null;
      state.board = null;
      if (owner[HUNT_BRIDGE_KEY] === bridge) delete owner[HUNT_BRIDGE_KEY];
    },
  };
}
