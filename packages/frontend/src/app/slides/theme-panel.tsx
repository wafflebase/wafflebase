import { IconX } from "@tabler/icons-react";
import { BUILT_IN_THEMES, type SlidesStore } from "@wafflebase/slides";
import { applyBuiltInTheme } from "./theme-panel-helpers";
import { ThemeThumbnail } from "./theme-thumbnail";

interface ThemePanelProps {
  store: SlidesStore;
  currentThemeId: string;
  onClose: () => void;
  /**
   * `drawer` (default) docks as a fixed-width `<aside>` column on the
   * right of the desktop editor. `sheet` returns content-only — no
   * width / border / own header — so a mobile bottom `Sheet` owns the
   * chrome (title + built-in close).
   */
  variant?: "drawer" | "sheet";
}

/**
 * Side panel listing the built-in themes. Clicking a thumbnail batches
 * `addTheme` + `applyTheme` so the change is one undo step. On desktop
 * it docks as a fixed-width column (`variant="drawer"`); on mobile it
 * renders inside a bottom sheet (`variant="sheet"`).
 */
export function ThemePanel({
  store,
  currentThemeId,
  onClose,
  variant = "drawer",
}: ThemePanelProps) {
  const list = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {BUILT_IN_THEMES.map((t) => (
        <ThemeThumbnail
          key={t.id}
          theme={t}
          selected={t.id === currentThemeId}
          onClick={() => applyBuiltInTheme(store, t.id)}
        />
      ))}
    </div>
  );

  if (variant === "sheet") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{list}</div>
    );
  }

  return (
    <aside
      aria-label="Theme picker"
      style={{
        width: 220,
        padding: 12,
        borderLeft: "1px solid var(--border, #e5e5e5)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflowY: "auto",
        flexShrink: 0,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2 style={{ fontSize: 14, margin: 0, fontWeight: 600 }}>Theme</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close theme picker"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 4,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconX size={16} />
        </button>
      </header>
      {list}
    </aside>
  );
}
