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
import { parseRef, toSref, type MemStore, type Spreadsheet } from "@wafflebase/sheets";

export const HUNT_BRIDGE_KEY = "__WB_HUNT__";

export type HuntSurface = "sheet" | "doc";

export type SheetHandle = {
  spreadsheet: Spreadsheet;
  store: MemStore;
  host: HTMLElement;
};

export type DocHandle = {
  editor: EditorAPI;
  host: HTMLElement;
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
    "sheet.rangeStyles": () => requireSheet(state).store.getRangeStyles(),

    "sheet.activeCellStyle": async () => (await requireSheet(state).spreadsheet.getActiveStyle()) ?? null,

    /**
     * Viewport coordinates of a cell's centre.
     *
     * This is how a caller clicks something that only exists as pixels on a canvas:
     * the grid has no DOM node per cell, so only the engine can say where `B2` is.
     * Mirrors `getCellCenterClientPoint` in the interaction harness.
     */
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
  const state: BridgeState = { ready: false, surface: "sheet", sheet: null, doc: null };
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
    dispose: () => {
      state.ready = false;
      state.sheet = null;
      state.doc = null;
      if (owner[HUNT_BRIDGE_KEY] === bridge) delete owner[HUNT_BRIDGE_KEY];
    },
  };
}
