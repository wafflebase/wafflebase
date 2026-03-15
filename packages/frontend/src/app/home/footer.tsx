import { useTheme } from "@/components/theme-provider";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Documentation", href: "/docs" },
      { label: "REST API", href: "/docs/api/rest-api" },
      { label: "CLI", href: "/docs/api/cli" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: GITHUB_URL, external: true },
      { label: "Issues", href: `${GITHUB_URL}/issues`, external: true },
      { label: "Discord", href: "https://discord.gg/m8cfeyPcGr", external: true },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "License (Apache-2.0)", href: `${GITHUB_URL}/blob/main/LICENSE`, external: true },
      { label: "Changelog", href: `${GITHUB_URL}/releases`, external: true },
      { label: "Contributing", href: `${GITHUB_URL}?tab=readme-ov-file#contributing`, external: true },
    ],
  },
] as const;

export function Footer() {
  const { resolvedTheme, setTheme } = useTheme();

  function toggleTheme() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  return (
    <footer className="bg-homepage-dark-bg px-4 md:px-12 pt-12 pb-6">
      <div className="max-w-[960px] mx-auto">
        {/* Column links */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mb-10">
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-homepage-dark-text mb-3">
                {col.title}
              </h4>
              <ul className="space-y-2 list-none p-0 m-0">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...("external" in link && link.external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="text-sm text-homepage-dark-muted no-underline hover:text-homepage-dark-link"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-homepage-dark-card pt-6 flex justify-between items-center">
          <span className="text-homepage-dark-muted text-xs">
            © {new Date().getFullYear()} Wafflebase
          </span>
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
