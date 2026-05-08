import { IconX } from "@tabler/icons-react";
import { BUILT_IN_THEMES, type SlidesStore } from "@wafflebase/slides";
import { applyBuiltInTheme } from "./theme-panel-helpers";
import { ThemeThumbnail } from "./theme-thumbnail";

interface ThemePanelProps {
  store: SlidesStore;
  currentThemeId: string;
  onClose: () => void;
}

/**
 * Right-docked side panel listing the five built-in themes. Clicking
 * a thumbnail batches `addTheme` + `applyTheme` so the change is one
 * undo step. Sized as a fixed-width column; the parent layout puts it
 * to the right of the slides editor.
 */
export function ThemePanel({ store, currentThemeId, onClose }: ThemePanelProps) {
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
    </aside>
  );
}
