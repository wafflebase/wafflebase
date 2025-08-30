import { User } from "@/types/users";
import { toast } from "sonner";

/**
 * Logs out the user by making a POST request to the logout endpoint.
 * Throws an error if the request fails.
 */
export async function logout(): Promise<void> {
  const res = await fetch(
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/logout`,
    {
      method: "POST",
      credentials: "include",
    }
  );

  if (!res.ok) {
    throw new Error("Failed to log out");
  }

  toast.success("Logged out successfully");
  window.location.href = "/login";
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

export async function fetchWithAuth(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
  });

  if (response.status === 401) {
    await logout();
    throw new Error("Unauthorized");
  }

  return response;
}
