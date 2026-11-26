/**
 * Where a visitor who is already signed in goes instead of `/login`: its
 * `returnTo` when that is a path on this site, the app's root otherwise. A
 * protocol-relative `//host` or a backslash variant would leave the site, so
 * only a single leading `/` counts. The backend re-validates `returnTo` for
 * the sign-in flow itself; this is only the in-app redirect.
 */
export function signedInTarget(returnTo: string | null): string {
  if (returnTo && /^\/(?![/\\])/.test(returnTo)) return returnTo;
  return "/";
}
