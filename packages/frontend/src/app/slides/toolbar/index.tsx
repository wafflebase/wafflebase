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
}

/**
 * Morphing slides toolbar shell. Fixed global zones on the outside
 * (undo/redo, slide group on the left; Done/background/theme on the
 * right) plus a contextual middle that swaps between the idle,
 * object-selected, and text-editing sections based on editor state.
 */
export function SlidesToolbar({
  editor,
  store = null,
  theme,
  onImagePick,
  upload,
  onToggleThemePanel,
  themePanelOpen,
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
          <TextEditSection state={state} />
        )}
      </div>
      <ToolbarSeparator className="mx-1" />
      <RightGlobals
        editor={editor}
        store={store}
        theme={theme}
        isTextEditing={state.kind === "text-edit"}
        onToggleThemePanel={onToggleThemePanel}
        themePanelOpen={themePanelOpen}
      />
    </Toolbar>
  );
}
