/**
 * The `behavior` for a programmatic scroll: smooth, unless the visitor asked
 * the system for reduced motion (WCAG 2.3.3). A jump still lands on the same
 * target, so nothing about where the user ends up changes — only the glide.
 */
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || !window.matchMedia) return "smooth";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
