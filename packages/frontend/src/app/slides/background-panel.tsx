import { useEffect, useRef, useState } from "react";
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

  // Live-drag local value: mirrors the gradient-draft pattern above — a
  // store write on every `input` event would spam the CRDT undo history
  // with one entry per pointermove, so the slider only touches the store
  // on release (pointerup / keyup), and the visible value is held here in
  // the meantime.
  const imageOpacity = bg.backgroundImage?.opacity ?? 1;
  const [opacityDraft, setOpacityDraft] = useState(imageOpacity);
  useEffect(() => setOpacityDraft(imageOpacity), [imageOpacity]);

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
            <>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                onClick={bg.onRemoveImage}
              >
                Remove image
              </button>
              <div className="flex items-center gap-2 px-1">
                <label htmlFor="bg-image-opacity" className="text-xs text-muted-foreground">
                  Opacity
                </label>
                <input
                  id="bg-image-opacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={opacityDraft}
                  onChange={(e) => setOpacityDraft(Number(e.target.value))}
                  onPointerUp={(e) =>
                    bg.onChangeImageOpacity(Number(e.currentTarget.value))
                  }
                  onKeyUp={(e) =>
                    bg.onChangeImageOpacity(Number(e.currentTarget.value))
                  }
                  className="flex-1"
                />
                <span className="w-9 shrink-0 text-right text-xs text-muted-foreground">
                  {Math.round(opacityDraft * 100)}%
                </span>
              </div>
            </>
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
