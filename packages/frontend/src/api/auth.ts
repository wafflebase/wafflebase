import { User } from "@/types/users";
import { toast } from "sonner";
import { createSingleFlightRunner } from "./single-flight";
import { eraseOfflineDataOnLogout } from "@/lib/offline-erase";

export class AuthExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "AuthExpiredError";
  }
}

/**
 * Returns true when the thrown error represents an expired auth session.
 */
export function isAuthExpiredError(error: unknown): error is AuthExpiredError {
  return error instanceof Error && error.name === "AuthExpiredError";
}

type LogoutOptions = {
  redirect?: boolean;
  showSuccessToast?: boolean;
  suppressFailure?: boolean;
  /**
   * Whether this sign-out also erases what offline persistence wrote to this
   * device. Defaults to true, because a person choosing "Log out" on a shared
   * machine is exactly who that erase is for.
   *
   * The 401 arm of {@link fetchWithAuth} passes `false`, and that is the whole
   * reason the option exists — see the comment there.
   */
  eraseLocalData?: boolean;
};

let isRedirecting = false;
let redirectRelease: ReturnType<typeof setTimeout> | null = null;

/**
 * How long a started redirect suppresses another one. Long enough to absorb
 * the burst of 401s a page full of concurrent requests produces, short enough
 * that a refused navigation is retryable on the very next request.
 */
const REDIRECT_LATCH_MS = 2000;

/**
 * Sends the browser to `path`, at most once per attempt.
 *
 * The latch exists to dedupe that burst, and it is released again on a timer
 * because this navigation is *refusable*: a `beforeunload` handler — the
 * unsaved-changes guard this app registers on a document with unsent edits —
 * makes the browser ask first, and the browser reports a refusal with no event
 * at all. The page simply keeps running. Latched permanently, one "Cancel" on
 * that prompt would turn session eviction off for the rest of the tab: every
 * later 401 would throw `AuthExpiredError` while silently leaving the user
 * sitting in an app whose session is gone.
 *
 * The timer is the inverse test. If the navigation commits, the page is torn
 * down and the callback never observably runs; if it is refused, the page
 * survives, the callback fires, and the next 401 asks again. (The prompt
 * blocks the main thread, so the callback lands just after the user answers
 * rather than while the dialog is up.)
 */
function redirectTo(path: string) {
  if (isRedirecting) return;
  isRedirecting = true;
  if (redirectRelease !== null) clearTimeout(redirectRelease);
  redirectRelease = setTimeout(() => {
    redirectRelease = null;
    isRedirecting = false;
  }, REDIRECT_LATCH_MS);
  window.location.href = path;
}

const refreshSession = createSingleFlightRunner(async (): Promise<boolean> => {
  try {
    const res = await fetch(`${import.meta.env.VITE_BACKEND_API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
});

/**
 * Logs out the user by making a POST request to the logout endpoint.
 * Throws an error if the request fails.
 */
export async function logout(options: LogoutOptions = {}): Promise<void> {
  const {
    redirect = true,
    showSuccessToast = true,
    suppressFailure = false,
    eraseLocalData = true,
  } = options;
  let res: Response | null = null;

  try {
    res = await fetch(`${import.meta.env.VITE_BACKEND_API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (error) {
    if (!suppressFailure) {
      throw error;
    }
  }

  // Offline persistence writes document content to this device's disk, and
  // signing out is where it must stop outliving the session — the whole point
  // of the setting being per device is that the device may be shared. Awaited
  // before the redirect so the erase is not raced by the page unloading, and
  // never able to fail the sign-out itself.
  //
  // Only when the person asked to sign out. An involuntary expiry runs the
  // same function with `eraseLocalData: false`, because this erase is
  // destructive in a way nothing else here is: it deletes the archives, which
  // are by this feature's own design the *only* remaining copy of work the SDK
  // could not reconcile.
  if (eraseLocalData) {
    await eraseOfflineDataOnLogout();
  }

  if (res && !res.ok && !suppressFailure) {
    throw new Error("Failed to log out");
  }

  if (showSuccessToast && res?.ok) {
    toast.success("Logged out successfully");
  }

  if (redirect) {
    redirectTo("/");
  }
}

/**
 * Fetches the current authenticated user.
 * Throws an error if the request fails.
 */
export async function fetchMe(): Promise<User> {
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/me`,
    {
      method: "GET",
      credentials: "include",
    }
  );

  if (!res.ok) {
    throw new Error("Failed to fetch user");
  }

  return res.json();
}

/**
 * Fetches the current authenticated user if present.
 * Returns null when there is no valid session.
 */
export async function fetchMeOptional(): Promise<User | null> {
  const requestMe = () =>
    fetch(`${import.meta.env.VITE_BACKEND_API_URL}/auth/me`, {
      method: "GET",
      credentials: "include",
    });

  let res = await requestMe();

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      return null;
    }

    res = await requestMe();
    if (res.status === 401) {
      return null;
    }
  }

  if (!res.ok) {
    throw new Error("Failed to fetch user");
  }

  return res.json();
}

/** Which OAuth providers this deployment can sign somebody in with. */
export type AuthProviders = {
  github: boolean;
  google: boolean;
};

/**
 * Asks the backend which sign-in buttons to offer.
 *
 * Google OAuth is optional and configured per deployment, so a build-time
 * `VITE_` flag could not answer this — a self-hosted image is built once and
 * configured per install. Unauthenticated, like the login page itself.
 *
 * Never throws: a login page that cannot reach this should still offer
 * GitHub rather than render an error, so a failed call degrades to "GitHub
 * only" — which is what every deployment has today.
 */
export async function fetchAuthProviders(): Promise<AuthProviders> {
  const fallback: AuthProviders = { github: true, google: false };
  try {
    const res = await fetch(
      `${import.meta.env.VITE_BACKEND_API_URL}/auth/providers`
    );
    if (!res.ok) {
      return fallback;
    }
    const body = (await res.json()) as Partial<AuthProviders>;
    return {
      github: body.github !== false,
      google: body.google === true,
    };
  } catch {
    return fallback;
  }
}

/**
 * Performs an authenticated fetch and redirects to login on 401 responses.
 */
export async function fetchWithAuth(
  input: RequestInfo,
  init?: RequestInit,
  skipRefresh = false
) {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
  });

  if (response.status === 401 && !skipRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return fetchWithAuth(input, init, true);
    }
  }

  if (response.status === 401) {
    await logout({
      redirect: false,
      showSuccessToast: false,
      suppressFailure: true,
      // Nobody asked for this. A 401 whose refresh failed is a session that
      // expired, a cookie a browser dropped, or a backend that restarted — and
      // the user is about to log straight back in on the same device. Erasing
      // here would destroy this device's locally persisted unsent work,
      // including the archives that hold changes the server never took, on an
      // event the user neither chose nor can undo. Signing out deliberately
      // still erases; this path only ends the session.
      eraseLocalData: false,
    });
    redirectTo("/login");
    throw new AuthExpiredError();
  }

  return response;
}

/**
 * Fetches a short-lived Yorkie auth-webhook token for the current session,
 * for the Yorkie client's `authTokenInjector`. Routes through `fetchWithAuth`
 * so an expired session refreshes (or redirects to login) transparently.
 */
export async function fetchYorkieToken(): Promise<string> {
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/yorkie-token`,
    { method: "GET", credentials: "include" }
  );
  if (!res.ok) {
    throw new Error("Failed to fetch Yorkie token");
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}

/**
 * Fetches a Yorkie auth-webhook token for an anonymous share-link visitor.
 * The webhook validates the wrapped share token (existence, expiry, role).
 */
export async function fetchYorkieShareToken(
  shareToken: string
): Promise<string> {
  // POST with the token in the body (not the URL) so this access-granting
  // token stays out of request URLs and server access logs.
  const res = await fetch(
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/yorkie-token/share`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: shareToken }),
    }
  );
  if (!res.ok) {
    throw new Error("Failed to fetch Yorkie share token");
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}
