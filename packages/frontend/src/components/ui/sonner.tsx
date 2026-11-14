import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "@/components/theme-provider";

/**
 * Sonner's own palette is a stock white/near-black pair keyed on its `theme`
 * prop, which defaults to `light` — so without this wrapper every toast was a
 * white card in dark mode. Two things fix it: the app's *resolved* theme (never
 * `system`, which Sonner would re-resolve against the OS and disagree with an
 * explicit light/dark choice), and its CSS variables pointed at the popover
 * tokens, so a toast is the same surface as every other thing that floats.
 */
const toastTokens = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "var(--radius)",
} as CSSProperties;

function Toaster({ style, ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      style={{ ...toastTokens, ...style }}
      {...props}
    />
  );
}

export { Toaster };
