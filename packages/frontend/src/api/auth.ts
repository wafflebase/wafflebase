import { User } from "@/types/users";
import { toast } from "sonner";
import { createSingleFlightRunner } from "./single-flight";

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
