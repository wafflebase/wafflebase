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

let isRedirectingToLogin = false;

function redirectToLogin() {
  if (isRedirectingToLogin) return;
  isRedirectingToLogin = true;
  window.location.href = "/login";
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
    redirectToLogin();
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
    redirectToLogin();
    throw new AuthExpiredError();
  }

  return response;
}
