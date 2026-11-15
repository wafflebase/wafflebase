/**
 * First path segments of the routes `App.tsx` mounts under `PrivateRoute`.
 * Used only to decide whether to prefetch the guard's chunk, so a route
 * missing here costs one round trip, not correctness.
 */
const PRIVATE_SEGMENTS = new Set([
  "w",
  "documents",
  "datasources",
  "admin",
  "settings",
  "invite",
  "d",
  "p",
  "s",
  "f",
  "n",
  "b",
]);

/**
 * Whether `pathname` is a signed-in route. `basename` is the router's
 * (`VITE_FRONTEND_BASENAME`), stripped before matching.
 */
export function isPrivatePath(
  pathname: string,
  basename: string = import.meta.env.VITE_FRONTEND_BASENAME ?? "",
): boolean {
  const base = basename.replace(/\/+$/, "");
  const path =
    base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const first = path.split("/").filter(Boolean)[0];
  return first !== undefined && PRIVATE_SEGMENTS.has(first);
}
