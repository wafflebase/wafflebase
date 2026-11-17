import { useEffect, useMemo, useState } from "react";
import type { SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { useCanvasFocusRelease } from "@/components/toolbar-focus-release";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IconGrid3x3, IconChevronDown } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { ZoomController } from "../slides/zoom-controller";
import { getToolbarState, type ToolbarState } from "../slides/toolbar/state";
import { UndoRedoGroup } from "../slides/toolbar/global-controls";
import { ZoomControl } from "../slides/toolbar/zoom-control";
import { ShapeControls } from "../slides/toolbar/shape-controls";
import { ImageControls } from "../slides/toolbar/image-controls";
import { TextElementControls } from "../slides/toolbar/text-element-controls";
import { TextEditSection } from "../slides/toolbar/text-edit-section";
import { ArrangeMenu } from "../slides/toolbar/arrange-menu";
import { canUngroupSelection } from "../slides/toolbar/can-ungroup";
import { isStickyElement } from "./sticky";
import { StickyControls } from "./sticky-controls";
import { BOARD_ZOOM_PRESETS } from "./board-zoom";
import { type BoardGridKind } from "./board-grid";
import { isSectionElement } from "@wafflebase/board";
import { type BoardSections } from "./board-sections";
import { SectionControls, SectionsListMenu } from "./board-section-toolbar";
import { BOARD_LINE_NONE_LABEL } from "./board-vocabulary";
import { TIDY_UP_SHORTCUT, tidyUpSelection } from "./board-tidy";

// Re-exported so a host that lazy-loads the toolbar (the hunt harness) gets
// the dock from the same chunk.
export { BoardToolDock } from "./board-tool-dock";

const GRID_OPTIONS: readonly { value: BoardGridKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "dot", label: "Dot grid" },
  { value: "line", label: "Line grid" },
];

export interface BoardToolbarProps {
  editor: SlidesEditor | null;
  /**
   * The board's `SlidesStore` adapter. Needed by the contextual
   * controls (they read element data through it) and by Undo/Redo.
   */
  store?: SlidesStore | null;
  zoomController?: ZoomController | null;
  /**
   * Background grid mode. A view-local, per-user preference (not board
   * state), so it is owned by `BoardView` and persisted to `localStorage`
   * rather than living in the Yorkie document — see `board-grid.ts`.
   *
   * Required, unlike the optional props above: the dropdown is fully
   * controlled, so a consumer that omitted these would render a menu that
   * shows a selected mode and silently ignores every click.
   */
  gridKind: BoardGridKind;
  onGridKindChange: (kind: BoardGridKind) => void;
  /**
   * Whether move/resize quantize onto the grid. Independent of
   * `gridKind` — `none` still snaps — so it is a checkbox below the mode
   * radio group rather than a fourth mode. Required for the same reason
   * as the two props above.
   */
  gridSnap: boolean;
  onGridSnapChange: (snap: boolean) => void;
  /** Board sections: the sections list and the section controls. */
  sections?: BoardSections | null;
  /** Facilitation controls (timer, Spotlight), after the view controls. */
  collabControls?: React.ReactNode;
}

/**
 * Morphing toolbar for the board infinite canvas.
 *
 * ```text
 * [↶][↷] │ [Zoom ▾][Grid ▾][Sections ▾] │ [Timer][Spotlight] │ ‹contextual›
 * ```
 *
 * The insert tools live in the bottom-centre tool dock
 * (`board-tool-dock.tsx`), FigJam's and Miro's arrangement: this bar keeps
 * the view and the controls for whatever is selected. Table insert is
 * offered in neither: `YorkieBoardStore` throws `notSupported()` on the
 * table-editing ops a table element's handlers call, and board paste
 * strips tables on the way in.
 *
 * The contextual zone reuses the slides toolbar's LEAF controls, routed
 * off the same `getToolbarState`. The slides SHELLS (`SlidesToolbar` /
 * `ObjectSection`) are deliberately not reused: they hardcode the slides
 * `InsertGroup` (with that table picker) and route a `table` selection
 * into `TableControls`.
 */
export function BoardToolbar({
  editor,
  store = null,
  zoomController = null,
  gridKind,
  onGridKindChange,
  gridSnap,
  onGridSnapChange,
  sections = null,
  collabControls,
}: BoardToolbarProps) {
  const [state, setState] = useState<ToolbarState>(() =>
    getToolbarState(editor, store),
  );

  // Hand focus back to the board after a pointer interaction with the
  // toolbar (issue #882), as the slides toolbar does. The hook leaves a
  // keyboard user's Tab focus alone, so Space on a toggle reached by Tab
  // still activates it; after a mouse click, Space pans — FigJam's
  // behaviour, and what a board user reaches for.
  useCanvasFocusRelease();

  // Contextual state: which leaf controls the selection/text-edit state
  // calls for. `onCurrentSlideChange` / `onCellSelectionChange` are
  // deliberately not subscribed (unlike `SlidesToolbar`): a board has one
  // fixed synthetic slide and never has tables.
  useEffect(() => {
    if (!editor) {
      setState(getToolbarState(null, store));
      return;
    }
    const refresh = () => setState(getToolbarState(editor, store));
    refresh();
    const offs = [
      editor.onSelectionChange(refresh),
      editor.onTextEditingChange(refresh),
      store?.onChange?.(refresh) ?? (() => {}),
    ];
    return () => offs.forEach((off) => off());
  }, [editor, store]);

  // The board's synthetic deck pins `defaultLight` (see
  // `boardToSlidesDocument`), which is also what the renderer resolves
  // themed colours against — so the picker's swatches and the painted
  // result agree. A board has no theme switcher.
  //
  // Memoized on `store` to skip the READ, not for reference stability:
  // `defaultLight` is a module-level const, so `themes[0]` is already
  // referentially stable. `YorkieBoardStore.read()` drops its `cachedDoc`
  // on every change and this toolbar re-renders on that same change
  // (`store.onChange` above), so an unmemoized read would redo the full
  // per-element deep unwrap of the whole board once per edit just to
  // reach a constant.
  const theme = useMemo(() => store?.read().themes[0] ?? null, [store]);

  // A selection made only of sticky notes gets the sticky palette instead
  // of the rectangle controls (see `StickyControls`); a MIXED selection
  // that contains stickies keeps its own controls plus the sticky colour
  // row for the stickies in it. Recomputed on each render, which
  // `store.onChange` above already drives.
  const stickyIds =
    state.kind === "object"
      ? (() => {
          const elements = store?.read().slides[0]?.elements ?? [];
          return state.ids.filter((id) =>
            isStickyElement(elements.find((e) => e.id === id)),
          );
        })()
      : [];
  const allStickies =
    state.kind === "object" &&
    state.selectionType === "shape" &&
    state.ids.length > 0 &&
    stickyIds.length === state.ids.length;

  // Likewise a selection made only of sections gets the section controls.
  const allSections =
    state.kind === "object" &&
    state.selectionType === "shape" &&
    state.ids.length > 0 &&
    (() => {
      const elements = store?.read().slides[0]?.elements ?? [];
      return state.ids.every((id) =>
        isSectionElement(elements.find((e) => e.id === id)),
      );
    })();

  // Both settings are spoken here: the icon is identical in every mode
  // and says nothing at all about snapping, so the trigger's label is
  // the only place either state is available without opening the menu.
  const gridLabel =
    (GRID_OPTIONS.find((option) => option.value === gridKind)?.label ?? "None") +
    (gridSnap ? ", snap on" : "");

  return (
    <Toolbar data-canvas-toolbar="">
      <UndoRedoGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      <ZoomControl controller={zoomController} presets={BOARD_ZOOM_PRESETS} />

      {/* Grid ▾ — the background grid mode, next to Zoom because both are
          view controls that change nothing in the document. Deliberately
          NOT gated on `disabled`/`editor`: it is a per-user view
          preference, so it stays usable while the workspace is still
          resolving and on a board the user cannot edit. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                // The icon is identical in all three modes (as it is in
                // Miro), so the current one has to be spoken somewhere —
                // otherwise a screen-reader user cannot tell whether the
                // grid is on without opening the menu.
                aria-label={`Grid: ${gridLabel}`}
              >
                {/* Dimmed only when the grid does NOTHING. `None` + snap
                    on is a supported combination, and a dimmed icon there
                    would be the one always-visible affordance claiming a
                    feature that is in fact active. */}
                <IconGrid3x3
                  size={16}
                  className={
                    gridKind === "none" && !gridSnap ? "opacity-50" : undefined
                  }
                />
                <IconChevronDown size={12} aria-hidden="true" className="opacity-50" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Grid: {gridLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={gridKind}
            onValueChange={(value) => onGridKindChange?.(value as BoardGridKind)}
          >
            {GRID_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {/* Below the separator because it is not a fourth mode: snapping
              is independent of what is drawn, so `None` + snap on is a
              valid (and useful) combination. */}
          <DropdownMenuCheckboxItem
            checked={gridSnap}
            onCheckedChange={(checked) => onGridSnapChange(checked === true)}
          >
            Snap to grid
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sections ▾ — frames a section on click: navigation, so it sits
          with the view controls rather than in the tool dock. */}
      <SectionsListMenu sections={sections} store={store} />

      {collabControls && (
        <>
          <ToolbarSeparator className="mx-1" />
          {collabControls}
        </>
      )}

      {state.kind === "object" && (
        <>
          <ToolbarSeparator className="mx-1" />
          {allStickies && (
            <StickyControls editor={editor} store={store} ids={state.ids} />
          )}
          {!allStickies && stickyIds.length > 0 && (
            <>
              <StickyControls editor={editor} store={store} ids={stickyIds} colorsOnly />
              <ToolbarSeparator className="mx-1" />
            </>
          )}
          {allSections && (
            <SectionControls sections={sections} store={store} editor={editor} ids={state.ids} />
          )}
          {!allStickies && !allSections &&
            (state.selectionType === "shape" ||
            state.selectionType === "connector") && (
            <ShapeControls
              editor={editor}
              store={store}
              theme={theme}
              ids={state.ids}
              lineNoneLabel={BOARD_LINE_NONE_LABEL}
            />
          )}
          {state.selectionType === "image" && (
            // No `upload` on purpose: the Replace affordance stays inert
            // on a board this pass — the tool dock's Image button is
            // the board's image path.
            <ImageControls editor={editor} store={store} ids={state.ids} />
          )}
          {state.selectionType === "text-element" && (
            <TextElementControls
              editor={editor}
              store={store}
              theme={theme}
              ids={state.ids}
            />
          )}
          {/* `table` renders nothing: a board never creates tables (no
              picker, paste strips them) and `YorkieBoardStore` throws
              `notSupported` on every table op. */}
          <ArrangeMenu
            editor={editor}
            selectionSize={state.ids.length}
            canUngroup={canUngroupSelection(editor, store, state.ids)}
            minAlignSelection={2}
            onTidyUp={
              editor && store ? () => tidyUpSelection(editor, store) : undefined
            }
            tidyUpShortcut={TIDY_UP_SHORTCUT}
          />
        </>
      )}
      {state.kind === "text-edit" && (
        <>
          <ToolbarSeparator className="mx-1" />
          <TextEditSection state={state} editor={editor} />
        </>
      )}
    </Toolbar>
  );
}

export default BoardToolbar;
