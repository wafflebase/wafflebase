import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { fetchAuthProviders, fetchMeOptional } from "@/api/auth";
import { Loader } from "@/components/loader";
import { LoginForm } from "@/components/login-form";
import { WaffleLogo } from "@/app/home/primitives/waffle-logo";
import { RulerBackdrop } from "@/app/home/primitives/ruler-backdrop";
import { ThemeToggle } from "@/app/home/primitives/theme-toggle";
import { useBrandFonts } from "@/lib/brand-fonts";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

/**
 * Where a visitor who is already signed in goes instead: `returnTo` when it
 * is a path on this site, the app's root otherwise. A protocol-relative
 * `//host` or a backslash variant would leave the site, so only a single
 * leading `/` counts.
 */
function signedInTarget(returnTo: string | null): string {
  if (returnTo && /^\/(?![/\\])/.test(returnTo)) return returnTo;
  return "/";
}

/**
 * Renders the login page.
 */
export default function LoginPage() {
  const [searchParams] = useSearchParams();
  useBrandFonts();
  // A visitor who is already signed in has nothing to do here. The desktop
  // shell opens /login at launch, so this is what takes a signed-in user
  // straight to their documents.
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ["me-optional"],
    queryFn: fetchMeOptional,
    retry: false,
  });
  // Which providers this deployment actually has — Google is optional and
  // configured server-side. Starts false so the page renders GitHub straight
  // away rather than waiting on a request; the call never rejects, so an
  // unreachable backend degrades to GitHub only.
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    document.title = "Sign in — Wafflebase";
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAuthProviders().then((providers) => {
      if (!cancelled) setGoogleEnabled(providers.google);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (userLoading) return <Loader />;
  if (user) {
    return <Navigate to={signedInTarget(searchParams.get("returnTo"))} replace />;
  }

  return (
    <div className="relative min-h-svh bg-[color:var(--wb-bg)] text-[color:var(--wb-ink)] overflow-hidden flex flex-col">
      {/* Header — mirrors the homepage NavBar layout for consistent logo
          placement when navigating between / and /login. */}
      <header className="relative z-10 px-4 md:px-12 py-3.5">
        <div className="flex justify-between items-center max-w-[1200px] mx-auto">
          <Link
            to="/"
            className="wordmark inline-flex items-center gap-2.5 text-[19px] text-[color:var(--wb-ink)] no-underline"
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
            {/* `?returnTo=` is forwarded to the backend, which re-validates
                it and refuses anything that is not a same-origin path — so a
                crafted /login?returnTo= URL cannot make this an open
                redirect. Used by /t/:id so a template link survives sign-in. */}
            <LoginForm
              error={searchParams.get("error")}
              returnTo={searchParams.get("returnTo")}
              googleEnabled={googleEnabled}
            />
          </div>

          <p className="text-center text-[12.5px] font-code text-[color:var(--wb-sub)] mt-6">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline hover:text-[color:var(--wb-ink)] transition-colors"
            >
              GitHub
            </a>
            <span className="mx-2 opacity-50">·</span>
            {/* A page navigation, not a <Link>: the docs are a separate site
                served under /docs, not a route of this app. */}
            <a
              href="/docs/"
              className="no-underline hover:text-[color:var(--wb-ink)] transition-colors"
            >
              Docs
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
