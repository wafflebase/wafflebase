import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { WbButton } from "@/app/home/primitives/wb-button";

/**
 * What `?error=` on the login page means.
 *
 * `GET /auth/github/callback` refuses a callback whose OAuth state does not
 * match the cookie that started the login, and returns the browser here with
 * `?error=` rather than a JSON 401 it cannot act on. That is reachable with no
 * attacker at all — the state cookie expires, and opening a second login tab
 * can replace the first tab's — so the page has to explain it and offer the
 * retry rather than leave the button looking untouched.
 *
 * A `Map` rather than an object literal because the key is a query parameter,
 * so the lookup is over a string the URL chose. An object literal answers for
 * its prototype too: `?error=toString` returns an inherited function, which
 * React renders as nothing, and `?error=__proto__` returns an object, which
 * React refuses to render at all — so the banner explaining one failed
 * sign-in would become a second one.
 *
 * `login_state` is carried alongside `oauth_state` because the two names for
 * the same refusal have both been in the callback's vocabulary; a build that
 * only knew one would answer the other with the generic message.
 */
const LOGIN_ERRORS = new Map<string, string>([
  [
    "oauth_state",
    "That sign-in link expired or was started in another tab. Please try again.",
  ],
  [
    "login_state",
    "That sign-in link expired or was started in another tab. Please try again.",
  ],
]);

/** Shown for a code this build does not recognise, so none is silent. */
const GENERIC_LOGIN_ERROR =
  "That sign-in could not be completed. Please try again.";

/**
 * Renders the LoginForm component.
 */
export function LoginForm({
  className,
  error,
  returnTo,
  googleEnabled = false,
  ...props
}: React.ComponentPropsWithoutRef<"form"> & {
  error?: string | null;
  /**
   * Whether this deployment has a Google OAuth client configured, per
   * `GET /auth/providers`. Defaults to false: Google is optional, and a
   * button that leads to a 404 is worse than no button.
   */
  googleEnabled?: boolean;
  /**
   * Where to send the browser after a successful login. Forwarded to
   * `GET /auth/github?returnTo=`, which stores it in its own short-lived
   * cookie and re-validates it in the OAuth callback — it is a *request*, not
   * a promise, and the server refuses anything that is not a same-origin path
   * (`packages/backend/src/auth/login-return-path.ts`).
   */
  returnTo?: string | null;
}) {
  // `error` is raw query-string input, so the lookup must not walk the
  // prototype chain — see `LOGIN_ERRORS`.
  const message = error ? (LOGIN_ERRORS.get(error) ?? GENERIC_LOGIN_ERROR) : null;

  // Both buttons carry the same `?returnTo=`: it is the backend that stores
  // and re-validates it, so neither provider needs its own handling.
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  const startUrl = (provider: string) =>
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/${provider}${query}`;

  return (
    <form className={cn("flex flex-col gap-7", className)} {...props}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1
          className="font-display font-semibold text-[28px] tracking-[-0.02em] text-[color:var(--wb-ink)] m-0"
          style={{ fontFeatureSettings: "'ss01' on, 'ss02' on" }}
        >
          Welcome back
        </h1>
        <p className="text-balance text-[14.5px] leading-[1.55] text-[color:var(--wb-sub)] m-0">
          {googleEnabled
            ? "Sign in with your GitHub or Google account to get started."
            : "Sign in with your GitHub account to get started."}
        </p>
      </div>
      {message && (
        <p
          role="alert"
          className="text-balance text-center text-[13.5px] leading-[1.5] text-[color:var(--wb-sub)] rounded-lg border border-[color:var(--wb-rule)] px-4 py-3 m-0"
        >
          {message}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <WbButton asChild variant="primary" size="lg" className="w-full">
          <Link to={startUrl("github")} rel="noopener noreferrer">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="size-4"
              aria-hidden="true"
            >
              <path
                d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                fill="currentColor"
              />
            </svg>
            Continue with GitHub
          </Link>
        </WbButton>
        {googleEnabled && (
          <WbButton asChild variant="ghost" size="lg" className="w-full">
            <Link to={startUrl("google")} rel="noopener noreferrer">
              {/* Google's four-colour mark. Fixed brand colours rather than
                  `currentColor`: the guidelines require the logo be shown in
                  its own colours, and it reads on both themes. */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="size-4"
                aria-hidden="true"
              >
                <path
                  d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.642h6.458a5.52 5.52 0 0 1-2.394 3.622v3.01h3.878c2.269-2.089 3.578-5.165 3.578-8.819"
                  fill="#4285F4"
                />
                <path
                  d="M12 24c3.24 0 5.956-1.075 7.942-2.908l-3.878-3.01c-1.075.72-2.45 1.145-4.064 1.145-3.125 0-5.77-2.11-6.715-4.946H1.276v3.107A11.995 11.995 0 0 0 12 24"
                  fill="#34A853"
                />
                <path
                  d="M5.285 14.281a7.212 7.212 0 0 1 0-4.562V6.612H1.276a12.005 12.005 0 0 0 0 10.776l4.009-3.107"
                  fill="#FBBC05"
                />
                <path
                  d="M12 4.773c1.763 0 3.345.606 4.59 1.795l3.44-3.44C17.951 1.19 15.235 0 12 0 7.31 0 3.251 2.69 1.276 6.612l4.009 3.107C6.23 6.883 8.875 4.773 12 4.773"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </Link>
          </WbButton>
        )}
      </div>
    </form>
  );
}
