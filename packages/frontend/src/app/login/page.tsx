import { useEffect } from "react";
import { Link } from "react-router-dom";

import { LoginForm } from "@/components/login-form";
import { WaffleLogo } from "@/app/home/primitives/waffle-logo";
import { RulerBackdrop } from "@/app/home/primitives/ruler-backdrop";
import { ThemeToggle } from "@/app/home/primitives/theme-toggle";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

/**
 * Renders the login page.
 */
export default function LoginPage() {
  useEffect(() => {
    document.title = "Login — Wafflebase";
  }, []);

  return (
    <div className="relative min-h-svh bg-[color:var(--wb-bg)] text-[color:var(--wb-ink)] overflow-hidden flex flex-col">
      {/* Header — mirrors the homepage NavBar layout for consistent logo
          placement when navigating between / and /login. */}
      <header className="relative z-10 px-4 md:px-12 py-3.5">
        <div className="flex justify-between items-center max-w-[1200px] mx-auto">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 font-display font-semibold text-[19px] tracking-[-0.01em] text-[color:var(--wb-ink)] no-underline"
          >
            <WaffleLogo size={28} />
            Wafflebase
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {/* Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-10 md:py-16">
        <RulerBackdrop className="opacity-40 dark:opacity-25" />
        <div className="relative z-10 w-full max-w-[400px]">
          <div
            className="rounded-2xl border border-[color:var(--wb-rule)] bg-[color:var(--wb-paper)] px-7 py-8 md:px-9 md:py-10"
            style={{
              boxShadow:
                "0 1px 0 rgba(42,30,18,0.04), 0 30px 60px -32px rgba(42,30,18,0.22)",
            }}
          >
            <LoginForm />
          </div>

          <p className="text-center text-[12.5px] font-code text-[color:var(--wb-sub)] mt-6">
            <a
              href={`${GITHUB_URL}/blob/main/LICENSE`}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline hover:text-[color:var(--wb-ink)] transition-colors"
            >
              Apache-2.0
            </a>
            <span className="mx-2 opacity-50">·</span>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline hover:text-[color:var(--wb-ink)] transition-colors"
            >
              GitHub
            </a>
            <span className="mx-2 opacity-50">·</span>
            <Link
              to="/docs"
              className="no-underline hover:text-[color:var(--wb-ink)] transition-colors"
            >
              Docs
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
