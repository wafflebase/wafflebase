import { User } from "@/types/users";
import { toast } from "sonner";

export async function logout() {
  try {
    const res = await fetch(
      `${import.meta.env.VITE_BACKEND_API_URL}/auth/logout`,
      {
        method: "POST",
        credentials: "include",
      }
    );
    if (res.ok) {
      toast.success("Logged out successfully");
    } else {
      toast.error("Failed to log out");
    }
  } catch (error) {
    toast.error("Error during logout:" + error);
  }
}

export async function fetchMe(): Promise<User | undefined> {
  try {
    const res = await fetch(`${import.meta.env.VITE_BACKEND_API_URL}/auth/me`, {
      method: "GET",
      credentials: "include",
    });

    if (res.ok) {
      return await res.json();
    }
  } catch (error) {
    toast.error("Failed to fetch user:" + error);
  }
}
