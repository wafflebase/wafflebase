import { useEffect, useId, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import type { SlidesEditor, SlidesStore, Theme } from "@wafflebase/slides";
import { useSlideBackground } from "./use-slide-background";
import { FillPicker } from "./fill-picker";

export interface BackgroundSidePanelProps {
  store: SlidesStore;
  editor: SlidesEditor;
  theme: Theme;
  /** Upload pipeline for the "Choose/Replace image…" flow. Omit to hide it. */
  upload?: (file: File) => Promise<{ url: string; w: number; h: number }>;
  onClose: () => void;
  /**
   * `drawer` (default) docks as a fixed-width column on desktop;
   * `sheet` returns content-only for a mobile bottom `Sheet` that owns
   * the chrome (title + built-in close).
   */
  variant?: "drawer" | "sheet";
}

/**
 * Background panel — Theme/Motion/Format-panel-parity right-side surface
 * for the slide background (Color / Image), replacing the old toolbar
 * `DropdownMenu` + bespoke mobile sheet. Unlike those, this panel stays
 * open across edits (no `onCommit` passed to `useSlideBackground`) and
 * lays its controls out as expanded sections rather than a drill-in list,
 * matching the Format panel's shape.
 *
 * Background is per-slide, not per-selection, so reactivity is wired to
 * `editor.onCurrentSlideChange` (fires when the active slide changes) in
 * addition to `store.onChange` (fires on any document mutation) — NOT
 * `editor.onSelectionChange`, which the Format panel uses because its
 * content depends on the selected element(s).
 */
export function BackgroundSidePanel({
  store,
  editor,
  theme,
  upload,
  onClose,
  variant = "drawer",
}: BackgroundSidePanelProps) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const u1 = store.onChange?.(force);
    const u2 = editor.onCurrentSlideChange(force);
    return () => {
      u1?.();
      u2();
    };
  }, [store, editor]);

  const slideId = editor.getCurrentSlideId();
  const bg = useSlideBackground(store, slideId, theme);

  // Flush any uncommitted gradient-drag draft when the panel goes away, no
  // matter which of its several close paths fired: the drawer's `×`, the
  // user switching to a different right panel, or the mobile Sheet being
  // dismissed (overlay click / swipe / Escape) — that last case is driven
  // by `slides-detail.tsx`'s shared Sheet, which doesn't hold a reference
  // to this hook instance, so unmount is the one signal every path shares.
  // A ref keeps the cleanup closure looking at the latest `bg` without
  // re-subscribing the effect on every render.
  const bgRef = useRef(bg);
  bgRef.current = bg;
  useEffect(() => {
    return () => bgRef.current.onFlushGradientDraft();
  }, []);

  const fileRef = useRef<HTMLInputElement>(null);
  const opacityId = useId();

  const onPickFile = async (file: File) => {
    if (!upload) return;
    try {
      const { url } = await upload(file);
      bg.onChooseImage(url);
    } catch (err) {
      console.error("Failed to upload background image", err);
      toast.error("Failed to upload image");
    }
  };

  // Live-drag local value: mirrors the gradient-draft pattern — a store
  // write on every `input` event would spam the CRDT undo history with one
  // entry per pointermove, so the slider only touches the store on release
  // (pointerup / keyup), and the visible value is held here in the meantime.
  const imageOpacity = bg.backgroundImage?.opacity ?? 1;
  const [opacityDraft, setOpacityDraft] = useState(imageOpacity);
  useEffect(() => setOpacityDraft(imageOpacity), [imageOpacity]);

  const content = (
    <div className="space-y-4 p-3">
      <section>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
          Color
        </div>
        <FillPicker
          fill={bg.gradientDraft ?? bg.backgroundFill}
          theme={theme}
          recentColors={store.read().meta.recentColors}
          onChangeSolid={bg.onChangeSolid}
          onChangeGradient={bg.onChangeGradient}
          onClear={bg.onResetToTheme}
        />
      </section>
      {upload && (
        <section>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            Image
          </div>
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
            className="flex w-full items-center justify-between rounded border px-2 py-1.5 text-xs hover:bg-muted"
            onClick={() => fileRef.current?.click()}
          >
            <span>
              {bg.backgroundImage ? "Replace image…" : "Choose image…"}
            </span>
            {bg.backgroundImage && (
              <span
                className="h-4 w-4 rounded border bg-cover bg-center"
                style={{ backgroundImage: `url(${bg.backgroundImage.src})` }}
              />
            )}
          </button>
          {bg.backgroundImage && (
            <>
              <div className="mt-2 flex items-center gap-2">
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
                className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
                onClick={bg.onRemoveImage}
              >
                Remove image
              </button>
            </>
          )}
        </section>
      )}
      <div className="space-y-1 border-t pt-2">
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
    </div>
  );

  if (variant === "sheet") {
    return <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>;
  }

  return (
    <aside
      aria-label="Background"
      className="flex w-72 shrink-0 flex-col border-l bg-background"
    >
      <header className="flex items-center justify-between border-b p-2">
        <h2 className="text-sm font-semibold">Background</h2>
        <button
          type="button"
          aria-label="Close background options"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">{content}</div>
    </aside>
  );
}
