import { useEffect, useState } from "react";
import type { SlidesEditor, SlidesStore, Theme } from "@wafflebase/slides";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import { useCanvasFocusRelease } from "@/components/toolbar-focus-release";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ZoomController } from "../zoom-controller";
import { getToolbarState, type ToolbarState } from "./state";
import { SlideGroup } from "./slide-group";
import { FormatPainterButton } from "./format-painter";
import { ZoomControl } from "./zoom-control";
import { UndoRedoGroup, RightGlobals } from "./global-controls";
import { IdleSection } from "./idle-section";
import { ObjectSection } from "./object-section";
import { TextEditSection } from "./text-edit-section";
import { MobileSlidesToolbar } from "./mobile-toolbar";
import { ToolbarOverflow } from "./toolbar-overflow";

export interface SlidesToolbarProps {
  editor: SlidesEditor | null;
  store?: SlidesStore | null;
  theme?: Theme | null;
  onImagePick: () => void;
  /** Upload pipeline for both Insert and Replace image paths. */
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
  onToggleThemePanel?: () => void;
  themePanelOpen?: boolean;
  onToggleFormatPanel?: () => void;
  formatPanelOpen?: boolean;
  onToggleMotionPanel?: () => void;
  motionPanelOpen?: boolean;
  onToggleBackgroundPanel?: () => void;
  backgroundPanelOpen?: boolean;
  zoomController?: ZoomController | null;
}

/**
 * Morphing slides toolbar shell.
 *
 * Desktop: fixed global zones (undo/redo, slide group on the left;
 * the Format / Motion / Background / Theme panel toggles pinned on the
 * right) plus a contextual middle that swaps between idle /
 * object-selected / text-editing and folds into a More menu when the
 * row is too narrow.
 *
 * Mobile (<768px): the state machine is the same but the renderer is
 * `MobileSlidesToolbar`, which collapses contextual controls into
 * bottom sheets (see `./mobile-toolbar.tsx`).
 */
export function SlidesToolbar({
  editor,
  store = null,
  theme,
  onImagePick,
  upload,
  onToggleThemePanel,
  themePanelOpen,
  onToggleFormatPanel,
  formatPanelOpen,
  onToggleMotionPanel,
  motionPanelOpen,
  onToggleBackgroundPanel,
  backgroundPanelOpen,
  zoomController,
}: SlidesToolbarProps) {
  const isMobile = useIsMobile();
  const [state, setState] = useState<ToolbarState>(() =>
    getToolbarState(editor, store),
  );
  // A used toolbar control must not keep the keyboard: the slide canvas
  // reads shortcuts from a document-level listener that ignores events
  // targeting a focused <button> (issue #882). The desktop `<Toolbar>`
  // below opts in with `data-canvas-toolbar` (= `CANVAS_TOOLBAR_ATTR`).
  useCanvasFocusRelease();

  useEffect(() => {
    // The Google Fonts <link> is injected by useGoogleFontsLink() in
    // slides-view.tsx; nothing to do here. Toolbar effect now only
    // owns editor-state synchronization.
    if (!editor) {
      setState(getToolbarState(null, store));
      return;
    }
    const refresh = () => setState(getToolbarState(editor, store));
    refresh();
    const offs = [
      editor.onSelectionChange(refresh),
      editor.onCurrentSlideChange(refresh),
      editor.onTextEditingChange(refresh),
      editor.onCellSelectionChange(refresh),
      store?.onChange?.(refresh) ?? (() => {}),
    ];
    return () => offs.forEach((off) => off());
  }, [editor, store]);

  if (isMobile) {
    return (
      <MobileSlidesToolbar
        editor={editor}
        store={store}
        state={state}
        theme={theme}
        onImagePick={onImagePick}
        upload={upload}
        onToggleThemePanel={onToggleThemePanel}
        onToggleFormatPanel={onToggleFormatPanel}
        onToggleMotionPanel={onToggleMotionPanel}
        onToggleBackgroundPanel={onToggleBackgroundPanel}
      />
    );
  }

  return (
    // Two strips in one row. The left one scrolls as a last resort and
    // folds its contextual tail into a ⋮ More menu (`ToolbarOverflow`)
    // when the window is too narrow; the right one — the panel toggles —
    // sits outside it, so a narrow window can never push them out of
    // reach. The `data-canvas-toolbar` opt-in on the shared parent
    // covers both. `@container/slides-toolbar` sits on that parent too,
    // so the panel toggles' label thresholds (see `PanelToggle` in
    // ./global-controls.tsx) key on the whole row, not on the right
    // strip; the left strip's fold re-measures when the labels change
    // the right strip's width, since that resizes the left strip.
    <div
      data-canvas-toolbar=""
      className="@container/slides-toolbar flex border-b bg-background"
    >
      <Toolbar className="min-w-0 flex-1 border-b-0 [&>*]:shrink-0">
        <UndoRedoGroup store={store} />
        <ToolbarSeparator />
        <FormatPainterButton editor={editor} />
        <ToolbarSeparator />
        <ZoomControl controller={zoomController ?? null} />
        <ToolbarSeparator />
        <SlideGroup store={store} editor={editor} />
        <ToolbarSeparator />
        <ToolbarOverflow
          resetKey={state.kind === "object" ? `object:${state.selectionType}` : state.kind}
          keepTextEdit={state.kind === "text-edit"}
        >
          {state.kind === "idle" && (
            <IdleSection editor={editor} onImagePick={onImagePick} />
          )}
          {state.kind === "object" && (
            <ObjectSection
              state={state}
              editor={editor}
              store={store}
              theme={theme}
              onImagePick={onImagePick}
              upload={upload}
            />
          )}
          {state.kind === "text-edit" && (
            <TextEditSection state={state} editor={editor} />
          )}
        </ToolbarOverflow>
      </Toolbar>
      <Toolbar className="shrink-0 border-b-0 pl-0">
        <ToolbarSeparator />
        <RightGlobals
          editor={editor}
          store={store}
          theme={theme}
          onToggleThemePanel={onToggleThemePanel}
          themePanelOpen={themePanelOpen}
          onToggleFormatPanel={onToggleFormatPanel}
          formatPanelOpen={formatPanelOpen}
          onToggleMotionPanel={onToggleMotionPanel}
          motionPanelOpen={motionPanelOpen}
          onToggleBackgroundPanel={onToggleBackgroundPanel}
          backgroundPanelOpen={backgroundPanelOpen}
          contextWidth={state.kind === "idle" ? "compact" : "full"}
        />
      </Toolbar>
    </div>
  );
}
