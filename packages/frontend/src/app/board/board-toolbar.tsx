import { useEffect, useMemo, useRef, useState } from "react";
import type { InsertKind, SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { Toggle } from "@/components/ui/toggle";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  IconPointer,
  IconLetterT,
  IconNote,
  IconPhoto,
  IconGrid3x3,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ShapePicker } from "../slides/shape-picker";
import { LinePicker } from "../slides/line-picker";
import { isLineToolKind } from "../slides/line-picker-helpers";
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
import { STICKY_COLORS } from "./sticky";
import { type BoardGridKind } from "./board-grid";

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
  disabled?: boolean;
  /** Drop a sticky of the given fill color at the viewport center. */
  onInsertSticky?: (colorValue: string) => void;
  /** Upload + insert the picked/pasted/dropped file at the viewport center. */
  onInsertImage?: (file: File) => void;
}

/**
 * Morphing toolbar for the board infinite canvas.
 *
 * ```text
 * [↶][↷] │ [Zoom ▾][Grid ▾] │ [Select][Text][Sticky▾][Image][Shape▾][Line▾] │ ‹contextual›
 * ```
 *
 * The insert block mirrors `slides/toolbar/insert-group.tsx`'s wiring
 * against the reused `SlidesEditor`'s `setInsertMode` / `getInsertMode` /
 * `onInsertModeChange` API, minus the one control that doesn't apply to a
 * board:
 *
 * - Table insert is deliberately never exposed here: `YorkieBoardStore`
 *   throws `notSupported()` on the table-editing ops (`insertTableRow`
 *   etc.) a table element's handlers call, and board paste already
 *   strips tables on the way in. Surfacing `<TablePicker>` would let a
 *   user create a table that then crashes as soon as it's edited.
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
  disabled,
  onInsertSticky,
  onInsertImage,
}: BoardToolbarProps) {
  const [insertMode, setInsertMode] = useState<InsertKind | null>(null);
  const [state, setState] = useState<ToolbarState>(() =>
    getToolbarState(editor, store),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Color chosen from the palette, applied in `onCloseAutoFocus` (below) so
  // the sticky is created only after Radix has finished closing the menu —
  // and with focus restoration prevented, so the new sticky's text caret
  // keeps focus instead of the dropdown trigger stealing it back.
  const pendingStickyColor = useRef<string | null>(null);

  useEffect(() => {
    if (!editor) return;
    setInsertMode(editor.getInsertMode());
    return editor.onInsertModeChange(() => setInsertMode(editor.getInsertMode()));
  }, [editor]);

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

  // Both settings are spoken here: the icon is identical in every mode
  // and says nothing at all about snapping, so the trigger's label is
  // the only place either state is available without opening the menu.
  const gridLabel =
    (GRID_OPTIONS.find((option) => option.value === gridKind)?.label ?? "None") +
    (gridSnap ? ", snap on" : "");

  return (
    <Toolbar>
      <UndoRedoGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      <ZoomControl controller={zoomController} />

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
                <span aria-hidden>▾</span>
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

      <ToolbarSeparator className="mx-1" />
      {/* Select — pressed when insertMode === null (Esc/default state).
          onClick rather than onPressedChange so a second click while
          already in select mode is a no-op instead of toggling to
          undefined. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={insertMode === null}
            onClick={() => editor?.setInsertMode(null)}
            aria-label="Select"
            disabled={disabled || !editor}
          >
            <IconPointer size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Select (Esc)</TooltipContent>
      </Tooltip>

      {/* Text box */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={insertMode === "text"}
            onPressedChange={(pressed) =>
              editor?.setInsertMode(pressed ? "text" : null)
            }
            aria-label="Text box"
            disabled={disabled || !editor}
          >
            <IconLetterT size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Text box</TooltipContent>
      </Tooltip>

      {/* Sticky note ▾ — main click drops the first (yellow) color;
          chevron opens the 6-color palette. Placement + text-edit entry
          is board-local (dropStickyAtViewportCenter), not an editor
          InsertKind, so the slides editor is untouched. */}
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              aria-label="Sticky note"
              disabled={disabled || !editor}
              onClick={() => onInsertSticky?.(STICKY_COLORS[0].value)}
            >
              <IconNote size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sticky note</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-5 px-0"
              aria-label="Sticky note color"
              disabled={disabled || !editor}
            >
              <span aria-hidden>▾</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="flex gap-1 p-1"
            onCloseAutoFocus={(e) => {
              const color = pendingStickyColor.current;
              if (!color) return;
              pendingStickyColor.current = null;
              // Skip Radix's default focus restore to the trigger — otherwise
              // it steals focus from the sticky's text caret that
              // `dropStickyAtViewportCenter` (via onInsertSticky) just entered.
              e.preventDefault();
              onInsertSticky?.(color);
            }}
          >
            {STICKY_COLORS.map((c) => (
              <DropdownMenuItem
                key={c.value}
                aria-label={c.name}
                title={c.name}
                className="h-6 w-6 rounded border border-black/10 p-0"
                style={{ backgroundColor: c.value }}
                onSelect={() => {
                  // Defer the actual insert to onCloseAutoFocus; onSelect just
                  // records the choice and lets Radix close the menu.
                  pendingStickyColor.current = c.value;
                }}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Image — opens a file picker; upload + insert is board-view's
          onInsertImage (reuses the slides upload + insert pipeline). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={false}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Insert image"
            disabled={disabled || !editor || !onInsertImage}
          >
            <IconPhoto size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Insert image</TooltipContent>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onInsertImage?.(file);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />

      {/* Shape ▾ — active when insertMode is a ShapeKind (not text, and
          not a line-tool kind: connectors / scribble live in Line ▾) */}
      <ShapePicker
        activeKind={
          insertMode && insertMode !== "text" && !isLineToolKind(insertMode)
            ? insertMode
            : null
        }
        onSelect={(kind) => editor?.setInsertMode(kind)}
        disabled={disabled || !editor}
      />

      {/* Line ▾ — connectors + the freehand scribble */}
      <LinePicker
        activeKind={isLineToolKind(insertMode) ? insertMode : null}
        onSelect={(kind) => editor?.setInsertMode(kind)}
        disabled={disabled || !editor}
      />

      {state.kind === "object" && (
        <>
          <ToolbarSeparator className="mx-1" />
          {(state.selectionType === "shape" ||
            state.selectionType === "connector") && (
            <ShapeControls
              editor={editor}
              store={store}
              theme={theme}
              ids={state.ids}
            />
          )}
          {state.selectionType === "image" && (
            // No `upload` on purpose: the Replace affordance stays inert
            // on a board this pass — the insert block's Image button is
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
