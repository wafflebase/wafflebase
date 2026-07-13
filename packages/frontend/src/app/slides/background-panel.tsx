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
 * Which sub-view the popover is showing. The root is a Google-Slides-style
 * list of rows (Color / Image / Reset / Apply); tapping Color or Image
 * drills one level down to that control, keeping the initial surface simple
 * instead of dumping the whole palette on open. State resets to `root` on
 * each open because the DropdownMenu/Sheet unmounts its content when closed.
 */
type BackgroundView = "root" | "color" | "image";

/**
 * Background popover/sheet body: a drill-in form with Color (via the shared
 * solid+gradient `FillPicker`), Image (upload + opacity), Reset to theme,
 * and Apply to all slides. Shared verbatim by the desktop `RightGlobals`
 * dropdown and the mobile background sheet so the two surfaces stay in
 * lockstep.
 */
export function BackgroundPanel({
  bg,
  theme,
  recentColors,
  upload,
}: BackgroundPanelProps) {
  const [view, setView] = useState<BackgroundView>("root");
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

  const backHeader = (
    <button
      type="button"
      className="mb-1 flex w-full items-center gap-1 rounded px-1 py-1 text-xs font-medium hover:bg-muted"
      onClick={() => setView("root")}
    >
      <IconChevronLeft size={14} className="text-muted-foreground" />
      Background
    </button>
  );

  if (view === "color") {
    return (
      <div className="w-[224px]">
        {backHeader}
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

  if (view === "image") {
    return (
      <div className="w-[224px] space-y-2">
        {backHeader}
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
            <div className="flex items-center gap-2 px-1">
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
              className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              onClick={bg.onRemoveImage}
            >
              Remove image
            </button>
          </>
        )}
      </div>
    );
  }

  // Root: Google-Slides-style row list.
  return (
    <div className="w-[224px] space-y-1">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted"
        onClick={() => setView("color")}
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
      {upload && (
        <button
          type="button"
          className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted"
          onClick={() => setView("image")}
        >
          <span>Image</span>
          <span className="flex items-center gap-1.5">
            {bg.backgroundImage ? (
              <span
                className="h-4 w-4 rounded border bg-cover bg-center"
                style={{ backgroundImage: `url(${bg.backgroundImage.src})` }}
              />
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
            <IconChevronRight size={14} className="text-muted-foreground" />
          </span>
        </button>
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
