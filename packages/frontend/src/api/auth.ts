import { toast } from "sonner";

export async function logout() {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_BACKEND_API_URL}/auth/logout`,
      {
        method: "POST",
        credentials: "include",
      }
    );
    if (response.ok) {
      toast.success("Logged out successfully");
    } else {
      toast.error("Failed to log out");
    }
  } catch (error) {
    toast.error("Error during logout:" + error);
  }
}
