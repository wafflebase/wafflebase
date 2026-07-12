import { useRef } from "react";
import type { Theme } from "@wafflebase/slides";
import { FillPicker } from "./fill-picker";
import type { useSlideBackground } from "./use-slide-background";

export interface BackgroundPanelProps {
  /**
   * The single `useSlideBackground` instance, owned by the caller (e.g.
   * `RightGlobals` on desktop, a mobile sheet's own state). Presentational
   * only — this component never calls the hook itself, so a
   * DropdownMenu/Sheet close handler can flush the gradient draft via
   * `bg.onFlushGradientDraft()` without a second, out-of-sync instance.
   */
  bg: ReturnType<typeof useSlideBackground>;
  theme: Theme;
  recentColors?: readonly string[];
  /** Upload pipeline for the "Choose/Replace image…" flow. Omit to hide it. */
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
}

/**
 * Background popover/sheet body: Color (via the shared solid+gradient
 * `FillPicker`), Image upload, and Reset to theme. Shared verbatim by the
 * desktop `RightGlobals` dropdown and the mobile background sheet so the
 * two surfaces stay in lockstep.
 */
export function BackgroundPanel({
  bg,
  theme,
  recentColors,
  upload,
}: BackgroundPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = async (file: File) => {
    if (!upload) return;
    const { url } = await upload(file);
    bg.onChooseImage(url);
  };

  return (
    <div className="w-[224px] space-y-2">
      <FillPicker
        fill={bg.gradientDraft ?? bg.backgroundFill}
        theme={theme}
        recentColors={recentColors}
        onChangeSolid={bg.onChangeSolid}
        onChangeGradient={bg.onChangeGradient}
        onClear={bg.onResetToTheme}
      />
      {upload && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPickFile(file);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className="w-full rounded border px-2 py-1 text-xs hover:bg-muted"
            onClick={() => fileRef.current?.click()}
          >
            {bg.backgroundImage ? "Replace image…" : "Choose image…"}
          </button>
          {bg.backgroundImage && (
            <button
              type="button"
              className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              onClick={bg.onRemoveImage}
            >
              Remove image
            </button>
          )}
        </>
      )}
      <button
        type="button"
        className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        onClick={bg.onResetToTheme}
      >
        Reset to theme
      </button>
      <button
        type="button"
        className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        onClick={bg.onApplyToAll}
      >
        Apply to all slides
      </button>
    </div>
  );
}
