import { useTheme } from "@/components/theme-provider";

export function Footer() {
  const { resolvedTheme, setTheme } = useTheme();

  function toggleTheme() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  return (
    <footer className="bg-homepage-dark-bg px-4 md:px-12 py-6">
      <div className="max-w-[960px] mx-auto flex justify-between items-center">
        <span className="text-homepage-dark-muted text-xs">© 2026 Wafflebase</span>
        <div className="flex items-center gap-5">
          <a href="https://github.com/wafflebase/wafflebase" target="_blank" rel="noopener noreferrer" className="text-homepage-dark-muted text-sm no-underline hover:text-homepage-dark-text transition-colors">GitHub</a>
          <button
            onClick={toggleTheme}
            aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
            className="relative bg-homepage-dark-card border-0 rounded-full w-11 h-6 cursor-pointer"
          >
            <div
              className={`absolute top-0.75 left-0.75 size-4.5 rounded-full bg-homepage-dark-link transition-transform flex items-center justify-center text-[10px] ${
                resolvedTheme === "dark" ? "translate-x-5" : ""
              }`}
            >
              {resolvedTheme === "dark" ? "🌙" : "☀️"}
            </div>
          </button>
        </div>
      </div>
    </footer>
  );
}
