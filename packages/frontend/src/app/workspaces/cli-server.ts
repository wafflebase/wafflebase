/** The CLI's built-in server (packages/cli/src/config/config.ts). */
export const CLI_DEFAULT_SERVER = "https://api.wafflebase.io";

/** The API server this page talks to, as the CLI's `--server` expects it. */
export function apiServer(): string {
  const base = import.meta.env.VITE_BACKEND_API_URL || "/";
  return new URL(base, window.location.origin).href.replace(/\/$/, "");
}
