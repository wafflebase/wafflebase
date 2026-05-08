import type { Theme } from "@wafflebase/slides";

interface ThemeThumbnailProps {
  theme: Theme;
  selected: boolean;
  onClick: () => void;
}

/**
 * Visual swatch card for one built-in theme. Renders the theme's
 * `aA` heading sample, the six accent colors as a strip, and the
 * theme name underneath. Used inside `ThemePanel`.
 *
 * Inline styles intentionally — every theme paints a different
 * background/text/accent palette, so rolling these into a Tailwind
 * class would still need per-theme inline overrides. Keeping all
 * style sources in one place makes the swatch easy to scan.
 */
export function ThemeThumbnail({ theme, selected, onClick }: ThemeThumbnailProps) {
  const c = theme.colors;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Apply ${theme.name} theme`}
      aria-pressed={selected}
      style={{
        border: selected ? `2px solid ${c.accent1}` : "1px solid #ddd",
        borderRadius: 6,
        padding: 8,
        background: c.background,
        width: "100%",
        height: 90,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        textAlign: "left",
      }}
    >
      <div
        style={{
          color: c.text,
          fontFamily: theme.fonts.heading,
          fontSize: 18,
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        aA
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {[c.accent1, c.accent2, c.accent3, c.accent4, c.accent5, c.accent6].map(
          (color, i) => (
            <span
              key={i}
              style={{
                width: 12,
                height: 12,
                background: color,
                borderRadius: 2,
              }}
            />
          ),
        )}
      </div>
      <div style={{ color: c.textSecondary, fontSize: 11 }}>{theme.name}</div>
    </button>
  );
}
