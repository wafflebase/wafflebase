import { useEffect, useState } from "react";
import { BUILT_IN_THEMES, type SlidesStore } from "@wafflebase/slides";
import { applyBuiltInTheme, isThemeModified } from "./theme-panel-helpers";
import { ThemeThumbnail } from "./theme-thumbnail";
import { ThemeBuilderPanel } from "./theme-builder-panel";

interface ThemePanelProps {
  store: SlidesStore;
  currentThemeId: string;
  onClose: () => void;
  /**
   * `drawer` (default) docks as a fixed-width column on the right of the
   * desktop editor. `sheet` returns content-only — no width / border /
   * own header — so a mobile bottom `Sheet` owns the chrome.
   */
  variant?: "drawer" | "sheet";
}

type View = "themes" | "customize";

/**
 * Theme side panel with two tabs:
 *  - **Themes** — pick a built-in theme (batches addTheme + applyTheme as
 *    one undo step).
 *  - **Customize** — the in-editor theme builder (colors / fonts / master
 *    background), embedded so the deck's "what does it look like?" controls
 *    live behind a single toolbar button.
 *
 * On desktop it docks as a fixed-width column (`variant="drawer"`); on
 * mobile it renders inside a bottom sheet (`variant="sheet"`).
 */
export function ThemePanel({
  store,
  currentThemeId,
  onClose,
  variant = "drawer",
}: ThemePanelProps) {
  const [view, setView] = useState<View>("themes");

  // Re-render on any store change so the live "In this presentation"
  // thumbnail and modified state track customizations (which change theme
  // colors without changing meta.themeId, so the parent's currentThemeId
  // sync alone wouldn't refresh this panel).
  const [tick, setTick] = useState(0);
  useEffect(() => store.onChange?.(() => setTick((t) => t + 1)), [store]);
  void tick;

  const doc = store.read();
  const active = doc.themes.find((t) => t.id === currentThemeId);
  const activeIsBuiltin =
    !!active && BUILT_IN_THEMES.some((t) => t.id === active.id);
  // The active theme gets its own "In this presentation" entry when it is
  // not a pristine built-in: an edited built-in, or a non-built-in
  // (PPTX-imported) theme. Otherwise it is just selected in the list.
  const showInPresentation =
    !!active && (!activeIsBuiltin || isThemeModified(active));

  const tabs = (
    <div
      role="tablist"
      aria-label="Theme view"
      className="flex gap-1 rounded-md bg-muted p-0.5"
    >
      {(["themes", "customize"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => setView(v)}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium capitalize transition-colors ${
            view === v
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );

  const body =
    view === "themes" ? (
      <div className="flex flex-col gap-3 p-3">
        {showInPresentation && active && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground">
              In this presentation
            </h3>
            {/* Already active — clicking is a no-op; reset/switch happens
                via the built-ins below or the Customize tab. */}
            <ThemeThumbnail theme={active} selected onClick={() => {}} />
          </section>
        )}
        <section className="flex flex-col gap-2">
          {showInPresentation && (
            <h3 className="text-xs font-semibold text-muted-foreground">
              Themes
            </h3>
          )}
          {BUILT_IN_THEMES.map((t) => (
            <ThemeThumbnail
              key={t.id}
              theme={t}
              selected={!showInPresentation && t.id === currentThemeId}
              onClick={() => applyBuiltInTheme(store, t.id)}
            />
          ))}
        </section>
      </div>
    ) : (
      <ThemeBuilderPanel store={store} currentThemeId={currentThemeId} />
    );

  if (variant === "sheet") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-1">{tabs}</div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">{body}</div>
      </div>
    );
  }

  return (
    <aside
      aria-label="Theme"
      className="flex w-72 shrink-0 flex-col border-l bg-background"
    >
      <header className="flex items-center justify-between border-b p-2">
        <h2 className="text-sm font-semibold">Theme</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close theme panel"
          className="rounded p-1 hover:bg-muted"
        >
          ×
        </button>
      </header>
      <div className="p-2">{tabs}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </aside>
  );
}
