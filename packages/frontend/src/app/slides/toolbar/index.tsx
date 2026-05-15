import { useEffect, useState } from "react";
import type { SlidesEditor, SlidesStore, Theme } from "@wafflebase/slides";
import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import { getToolbarState, type ToolbarState } from "./state";
import { SlideGroup } from "./slide-group";
import { UndoRedoGroup, RightGlobals } from "./global-controls";

export interface SlidesToolbarProps {
  editor: SlidesEditor | null;
  store?: SlidesStore | null;
  theme?: Theme | null;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  theme,
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
    const storeWithChange = store as { onChange?: (cb: () => void) => () => void } | null;
    const offs = [
      editor.onSelectionChange(refresh),
      editor.onCurrentSlideChange(refresh),
      editor.onTextEditingChange(refresh),
      storeWithChange?.onChange?.(refresh) ?? (() => {}),
    ];
    return () => offs.forEach((off) => off());
  }, [editor, store]);

  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      <UndoRedoGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      <SlideGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      {/* Contextual middle — placeholder until Tasks 5-11 fill it in */}
      <div
        data-testid="toolbar-contextual"
        className="flex flex-1 items-center gap-1"
      >
        {/* state.kind === 'idle' / 'object' / 'text-edit' — render nothing for now */}
        {state.kind === "idle" && null}
        {state.kind === "object" && null}
        {state.kind === "text-edit" && null}
      </div>
      <RightGlobals
        editor={editor}
        store={store}
        onToggleThemePanel={onToggleThemePanel}
        themePanelOpen={themePanelOpen}
        onStartPresentation={onStartPresentation}
        slideCount={slideCount}
      />
    </Toolbar>
  );
}
