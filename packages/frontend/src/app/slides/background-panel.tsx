import { useEffect, useId, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { Theme } from "@wafflebase/slides";
import { representativeColor, resolveColor } from "@wafflebase/slides";
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
 * Background popover/sheet body: a Google-Slides-style root list — a
 * **Color** row that opens the shared solid+gradient `FillPicker` (like the
 * toolbar Fill button), an **Image** row that opens the file chooser
 * directly (with Opacity + Remove inline once an image is set), plus Reset
 * to theme and Apply to all slides. Keeping the initial surface a compact
 * list instead of the full palette matches Google Slides and reads far
 * simpler on open. Shared verbatim by the desktop `RightGlobals` dropdown
 * and the mobile background sheet so the two surfaces stay in lockstep.
 */
export function BackgroundPanel({
  bg,
  theme,
  recentColors,
  upload,
}: BackgroundPanelProps) {
  // Color drills one level down into the FillPicker; resets to the root list
  // on each open because the DropdownMenu/Sheet unmounts its content on close.
  const [showColor, setShowColor] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const opacityId = useId();

  const onPickFile = async (file: File) => {
    if (!upload) return;
    const { url } = await upload(file);
    bg.onChooseImage(url);
  };

  // Live-drag local value: mirrors the gradient-draft pattern — a store
  // write on every `input` event would spam the CRDT undo history with one
  // entry per pointermove, so the slider only touches the store on release
  // (pointerup / keyup), and the visible value is held here in the meantime.
  const imageOpacity = bg.backgroundImage?.opacity ?? 1;
  const [opacityDraft, setOpacityDraft] = useState(imageOpacity);
  useEffect(() => setOpacityDraft(imageOpacity), [imageOpacity]);

  // Representative solid for the Color row's swatch — a gradient collapses
  // to its dominant stop, matching the toolbar trigger swatch.
  const swatch = bg.backgroundFill
    ? resolveColor(representativeColor(bg.backgroundFill), theme)
    : undefined;

  // Color sub-view: press-to-reveal FillPicker, like the toolbar Fill button.
  if (showColor) {
    return (
      <div className="w-[224px]">
        <button
          type="button"
          className="mb-1 flex w-full items-center gap-1 rounded px-1 py-1 text-xs font-medium hover:bg-muted"
          onClick={() => setShowColor(false)}
        >
          <IconChevronLeft size={14} className="text-muted-foreground" />
          Background
        </button>
        <FillPicker
          fill={bg.gradientDraft ?? bg.backgroundFill}
          theme={theme}
          recentColors={recentColors}
          onChangeSolid={bg.onChangeSolid}
          onChangeGradient={bg.onChangeGradient}
          onClear={bg.onResetToTheme}
        />
      </div>
    );
  }

  return (
    <div className="w-[224px] space-y-1">
      {/* Color → opens the FillPicker on press. */}
      <button
        type="button"
        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted"
        onClick={() => setShowColor(true)}
      >
        <span>Color</span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-4 w-4 rounded border"
            style={swatch ? { background: swatch } : undefined}
          />
          <IconChevronRight size={14} className="text-muted-foreground" />
        </span>
      </button>

      {/* Image → opens the file chooser directly; opacity + remove appear
          inline below once an image is set. */}
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
            className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted"
            onClick={() => fileRef.current?.click()}
          >
            <span>Image</span>
            {bg.backgroundImage ? (
              <span
                className="h-4 w-4 rounded border bg-cover bg-center"
                style={{ backgroundImage: `url(${bg.backgroundImage.src})` }}
              />
            ) : (
              <span className="text-xs text-muted-foreground">Choose…</span>
            )}
          </button>
          {bg.backgroundImage && (
            <>
              <div className="flex items-center gap-2 px-2 py-1">
                <label
                  htmlFor={opacityId}
                  className="text-xs text-muted-foreground"
                >
                  Opacity
                </label>
                <input
                  id={opacityId}
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
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
                onClick={bg.onRemoveImage}
              >
                Remove image
              </button>
            </>
          )}
        </>
      )}

      <div className="my-1 border-t" />
      <button
        type="button"
        className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
        onClick={bg.onResetToTheme}
      >
        Reset to theme
      </button>
      <button
        type="button"
        className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
        onClick={bg.onApplyToAll}
      >
        Apply to all slides
      </button>
    </div>
  );
}
