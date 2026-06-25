import { useEffect, useState } from "react";
import type { SlidesEditor, SlidesStore, Theme } from "@wafflebase/slides";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
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
  onToggleBuilderPanel?: () => void;
  builderPanelOpen?: boolean;
  zoomController?: ZoomController | null;
}

/**
 * Morphing slides toolbar shell.
 *
 * Desktop: fixed global zones (undo/redo, slide group on the left;
 * Done/background/theme on the right) plus a contextual middle that
 * swaps between idle / object-selected / text-editing.
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
  onToggleBuilderPanel,
  builderPanelOpen,
  zoomController,
}: SlidesToolbarProps) {
  const isMobile = useIsMobile();
  const [state, setState] = useState<ToolbarState>(() =>
    getToolbarState(editor, store),
  );

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
      />
    );
  }

  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      <UndoRedoGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      <FormatPainterButton editor={editor} />
      <ToolbarSeparator className="mx-1" />
      <ZoomControl controller={zoomController ?? null} />
      <ToolbarSeparator className="mx-1" />
      <SlideGroup store={store} editor={editor} />
      <ToolbarSeparator className="mx-1" />
      <div
        data-testid="toolbar-contextual"
        className="flex flex-1 items-center gap-1"
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
      </div>
      <ToolbarSeparator className="mx-1" />
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
        onToggleBuilderPanel={onToggleBuilderPanel}
        builderPanelOpen={builderPanelOpen}
      />
    </Toolbar>
  );
}
