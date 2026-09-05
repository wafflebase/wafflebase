import { Link } from "react-router-dom";
import { scrollToHashTarget } from "./hash-scroll";
import { WaffleLogo } from "./primitives/waffle-logo";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

const columns = [
  {
    title: "Product",
    links: [
      // `route: true` renders a router `Link`. This footer also mounts on
      // `/templates` and `/t/:id`, where a bare `#features` fragment points at
      // nothing on the page — and the router carries a `basename`, so a plain
      // `<a href="/#features">` would miss it. Everything else here is a real
      // anchor: `/docs` is a separate VitePress site and the rest is GitHub.
      { label: "Features", href: "/#features", route: true },
      { label: "Documentation", href: "/docs" },
      { label: "REST API", href: "/docs/developers/rest-api" },
      { label: "CLI", href: "/docs/developers/cli" },
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
      {
        label: "License (Apache-2.0)",
        href: `${GITHUB_URL}/blob/main/LICENSE`,
        external: true,
      },
      {
        label: "Changelog",
        href: `${GITHUB_URL}/releases`,
        external: true,
      },
      {
        label: "Contributing",
        href: `${GITHUB_URL}?tab=readme-ov-file#contributing`,
        external: true,
      },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer
      className="bg-[color:var(--wb-bg)] border-t border-[color:var(--wb-rule)] px-6 md:px-8 pt-14 pb-8"
    >
      <div className="max-w-[1200px] mx-auto">
        <div className="grid gap-10 md:gap-12 md:grid-cols-[1.4fr_3fr] mb-10">
          {/* Brand */}
          <div className="flex flex-col gap-3">
            <a
              href="/"
              className="inline-flex items-center gap-2.5 font-display font-semibold text-[19px] tracking-[-0.01em] text-[color:var(--wb-ink)] no-underline"
            >
              <WaffleLogo size={28} />
              Wafflebase
            </a>
            <p className="text-[14px] leading-[1.55] text-[color:var(--wb-sub)] max-w-[280px] m-0">
              Self-hosted collaborative spreadsheets, documents, presentations,
              notes, and boards, with real-time editing and a REST API for
              automation.
            </p>
          </div>

          {/* Columns */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
            {columns.map((col) => (
              <div key={col.title}>
                <h4 className="font-code text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--wb-syrup-deep)] m-0 mb-3">
                  {col.title}
                </h4>
                <ul className="space-y-2 list-none p-0 m-0">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      {"route" in link && link.route ? (
                        <Link
                          to={link.href}
                          // See `hash-scroll.ts`: `Link` alone does not scroll
                          // when the hash is already the current one.
                          onClick={() =>
                            scrollToHashTarget(link.href.split("#")[1])
                          }
                          className="text-[14px] text-[color:var(--wb-sub)] no-underline hover:text-[color:var(--wb-ink)] transition-colors"
                        >
                          {link.label}
                        </Link>
                      ) : (
                        <a
                          href={link.href}
                          {...("external" in link && link.external
                            ? { target: "_blank", rel: "noopener noreferrer" }
                            : {})}
                          className="text-[14px] text-[color:var(--wb-sub)] no-underline hover:text-[color:var(--wb-ink)] transition-colors"
                        >
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-[color:var(--wb-rule)] pt-6 flex flex-col sm:flex-row gap-2 justify-between items-start sm:items-center">
          <span className="font-code text-[12px] text-[color:var(--wb-sub)]">
            © {new Date().getFullYear()} Wafflebase · Apache-2.0
          </span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-code text-[12px] text-[color:var(--wb-sub)] hover:text-[color:var(--wb-ink)] no-underline transition-colors"
          >
            github.com/wafflebase/wafflebase
          </a>
        </div>
      </div>
    </footer>
  );
}
