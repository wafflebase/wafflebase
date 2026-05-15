import { useEffect, useState } from "react";
import type { SlidesEditor, SlidesStore, Theme } from "@wafflebase/slides";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import { getToolbarState, type ToolbarState } from "./state";
import { SlideGroup } from "./slide-group";
import { UndoRedoGroup, RightGlobals } from "./global-controls";
import { IdleSection } from "./idle-section";
import { ObjectSection } from "./object-section";
import { TextEditSection } from "./text-edit-section";

export interface SlidesToolbarProps {
  editor: SlidesEditor | null;
  store?: SlidesStore | null;
  theme?: Theme | null;
  onImagePick: () => void;
  /** Upload pipeline for both Insert and Replace image paths. */
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
  onToggleThemePanel?: () => void;
  themePanelOpen?: boolean;
  onStartPresentation?: (from: "current" | "first") => void;
  slideCount?: number;
}

/**
 * Morphing slides toolbar shell. Renders global controls (undo/redo,
 * slide group, theme toggle, present button) plus a contextual middle
 * slot that will be populated by Tasks 5-11.
 *
 * The old SlidesFormattingToolbar stays mounted in slides-detail.tsx
 * until Task 12 swaps it for this component.
 */
export function SlidesToolbar({
  editor,
  store = null,
  theme,
  onImagePick,
  upload,
  onToggleThemePanel,
  themePanelOpen,
  onStartPresentation,
  slideCount = 0,
}: SlidesToolbarProps) {
  const [state, setState] = useState<ToolbarState>(() =>
    getToolbarState(editor, store),
  );

  useEffect(() => {
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
      store?.onChange?.(refresh) ?? (() => {}),
    ];
    return () => offs.forEach((off) => off());
  }, [editor, store]);

  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      <UndoRedoGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      <SlideGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      {/* Contextual middle — populated by Tasks 5-11 */}
      <div
        data-testid="toolbar-contextual"
        className="flex flex-1 items-center gap-1"
      >
        {state.kind === "idle" && (
          <IdleSection
            editor={editor}
            store={store}
            theme={theme}
            onImagePick={onImagePick}
          />
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
          <TextEditSection state={state} />
        )}
      </div>
      <RightGlobals
        editor={editor}
        store={store}
        isTextEditing={state.kind === "text-edit"}
        onToggleThemePanel={onToggleThemePanel}
        themePanelOpen={themePanelOpen}
        onStartPresentation={onStartPresentation}
        slideCount={slideCount}
      />
    </Toolbar>
  );
}
