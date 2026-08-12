import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

/**
 * `localStorage` is not merely empty in Safari private mode, with blocked
 * third-party storage, or in a sandboxed iframe — touching it throws
 * SecurityError. This provider wraps the whole app, and the read below runs
 * during render, so an unguarded throw would blank every route instead of
 * losing a theme preference.
 */
function readStoredTheme(storageKey: string): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeStoredTheme(storageKey: string, theme: Theme): void {
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // Same environments as above, plus a full quota. The theme still applies
    // for this session; it just does not survive a reload.
  }
}

const initialState: ThemeProviderState = {
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => null,
};

export const ThemeProviderContext =
  createContext<ThemeProviderState>(initialState);

/**
 * Renders the ThemeProvider component.
 */
export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const isIframe = window.self !== window.top;
  const [theme, setThemeState] = useState<Theme>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTheme = params.get("theme");
    if (urlTheme === "light" || urlTheme === "dark") return urlTheme;
    return (readStoredTheme(storageKey) as Theme) || defaultTheme;
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    let newResolvedTheme: ResolvedTheme;

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      newResolvedTheme = systemTheme;
      root.classList.add(systemTheme);
    } else {
      newResolvedTheme = theme as ResolvedTheme;
      root.classList.add(theme);
    }

    setResolvedTheme(newResolvedTheme);
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      if (theme === "system") {
        const root = window.document.documentElement;
        const systemTheme: ResolvedTheme = mediaQuery.matches
          ? "dark"
          : "light";

        root.classList.remove("light", "dark");
        root.classList.add(systemTheme);
        setResolvedTheme(systemTheme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "theme-change") {
        const t = e.data.theme;
        if (t === "light" || t === "dark") {
          setThemeState(t);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const value = {
    theme,
    resolvedTheme,
    setTheme: (newTheme: Theme) => {
      if (!isIframe) {
        writeStoredTheme(storageKey, newTheme);
      }
      setThemeState(newTheme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

/**
 * Reads the current theme context.
 */
export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
