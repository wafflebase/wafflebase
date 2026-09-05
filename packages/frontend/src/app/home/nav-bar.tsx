import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { scrollToHashTarget } from "./hash-scroll";
import { WaffleLogo } from "./primitives/waffle-logo";
import { ThemeToggle } from "./primitives/theme-toggle";
import { WbButton } from "./primitives/wb-button";

const SCROLL_BORDER_THRESHOLD = 8;

export function NavBar({
  workspacePath,
  signInTo = "/login",
}: {
  workspacePath: string | null;
  /**
   * Where the signed-out CTA goes. `/templates` overrides it to carry a
   * `returnTo`, so a visitor who signs in from the gallery comes back to the
   * gallery instead of being dropped at a workspace root.
   */
  signInTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > SCROLL_BORDER_THRESHOLD);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav
      className={cn(
        "sticky top-0 z-50 px-4 md:px-12 py-3.5 backdrop-blur-md transition-colors border-b",
        scrolled
          ? "border-[color:var(--wb-rule)]/60"
          : "border-transparent",
      )}
      style={{
        background: "color-mix(in srgb, var(--wb-bg) 80%, transparent)",
      }}
    >
      <div className="flex justify-between items-center max-w-[1200px] mx-auto">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-[19px] font-display font-semibold text-[color:var(--wb-ink)] tracking-[-0.01em] no-underline"
        >
          <WaffleLogo size={28} />
          Wafflebase
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-7 text-[14.5px] text-[color:var(--wb-sub)]">
          {/* `Link to="/#features"`, not `<a href="#features">`: this nav also
              mounts on `/templates` and `/t/:id`, where a bare fragment points
              at nothing. A raw `<a href="/#features">` would be wrong too —
              the router has a `basename`, and only `Link` applies it. See
              `hash-scroll.ts` for what the swap costs and why both callers
              are needed. */}
          <Link
            to="/#features"
            onClick={() => scrollToHashTarget("features")}
            className="no-underline hover:text-[color:var(--wb-ink)] transition-colors"
          >
            Features
          </Link>
          {/* `Link`, not `<a href>`: this is an in-SPA route, so it must go
              through the router's basename. The `/docs` link beside it is an
              anchor because it is a separate VitePress site. */}
          <Link
            to="/templates"
            className="no-underline hover:text-[color:var(--wb-ink)] transition-colors"
          >
            Templates
          </Link>
          <a
            href="/docs"
            className="no-underline hover:text-[color:var(--wb-ink)] transition-colors"
          >
            Documentation
          </a>
          <a
            href="https://github.com/wafflebase/wafflebase"
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline hover:text-[color:var(--wb-ink)] transition-colors"
          >
            GitHub
          </a>
        </div>

        <div className="flex items-center gap-2.5">
          <ThemeToggle className="hidden md:inline-flex" />
          <WbButton asChild variant="primary" className="hidden md:inline-flex">
            <Link to={workspacePath ?? signInTo}>
              {workspacePath ? "Go to Workspace" : "Get Started"}
            </Link>
          </WbButton>
          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="md:hidden p-1.5 text-[color:var(--wb-ink)] cursor-pointer"
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="mobile-menu"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div
          id="mobile-menu"
          className="md:hidden mt-4 pb-2 flex flex-col gap-3 border-t border-[color:var(--wb-rule)] pt-4"
        >
          <Link
            to="/#features"
            onClick={() => {
              setOpen(false);
              scrollToHashTarget("features");
            }}
            className="text-sm text-[color:var(--wb-sub)] no-underline hover:text-[color:var(--wb-ink)]"
          >
            Features
          </Link>
          <Link
            to="/templates"
            onClick={() => setOpen(false)}
            className="text-sm text-[color:var(--wb-sub)] no-underline hover:text-[color:var(--wb-ink)]"
          >
            Templates
          </Link>
          <a
            href="/docs"
            onClick={() => setOpen(false)}
            className="text-sm text-[color:var(--wb-sub)] no-underline hover:text-[color:var(--wb-ink)]"
          >
            Documentation
          </a>
          <a
            href="https://github.com/wafflebase/wafflebase"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="text-sm text-[color:var(--wb-sub)] no-underline hover:text-[color:var(--wb-ink)]"
          >
            GitHub
          </a>
          <div className="flex items-center gap-3 pt-2">
            <ThemeToggle />
            <WbButton asChild variant="primary" className="flex-1">
              <Link
                to={workspacePath ?? signInTo}
                onClick={() => setOpen(false)}
              >
                {workspacePath ? "Go to Workspace" : "Get Started"}
              </Link>
            </WbButton>
          </div>
        </div>
      )}
    </nav>
  );
}
