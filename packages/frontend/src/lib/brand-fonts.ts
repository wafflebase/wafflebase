import { useEffect } from "react";

/**
 * The brand faces (Fraunces / Inter / JetBrains Mono) for the marketing
 * surfaces only — the landing page, sign-in, and the public template gallery.
 *
 * They used to be a render-blocking `<link>` in index.html, which made every
 * route wait on fonts.googleapis.com before first paint, editors included,
 * though the editors and the app shell draw in the system stack and never use
 * them. It also made a self-hosted install call a third party on every load.
 * Now nothing is requested until a brand route is shown.
 *
 * The app shell has one brand-face use left: the sidebar wordmark
 * (`font-display`). It is deliberately not worth a font request on app
 * routes, so there it renders in the stack's serif fallback (`ui-serif,
 * Georgia`) — unless a brand page already loaded the faces earlier in the
 * same session, since the stylesheet stays in the document once added.
 *
 * Fraunces italic is loaded for 500 only: the hero's second line
 * (hero-section.tsx, `font-medium italic`) is the one italic display text. A
 * new italic weight needs its own `1,9..144,<wght>` tuple here;
 * `.font-display` sets `font-synthesis-style: none`, so a missing face
 * renders upright instead of as a browser-slanted fake.
 */
export const BRAND_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";

const STYLESHEET_ID = "wb-brand-fonts";

/**
 * Paths that render a brand page. `/` is the landing page for a signed-out
 * visitor; a signed-in one is redirected on, and pays one stylesheet request
 * for it, which is cheaper than waiting on the auth probe to decide.
 */
export function isBrandPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/templates" ||
    pathname.startsWith("/t/")
  );
}

/**
 * Adds the preconnects and the font stylesheet to `<head>`, once. Inserted
 * from script, the stylesheet does not block rendering; `display=swap` paints
 * the fallback until each face arrives.
 */
export function loadBrandFonts(doc: Document = document): void {
  if (doc.getElementById(STYLESHEET_ID)) return;

  for (const [href, crossOrigin] of [
    ["https://fonts.googleapis.com", false],
    ["https://fonts.gstatic.com", true],
  ] as const) {
    const preconnect = doc.createElement("link");
    preconnect.rel = "preconnect";
    preconnect.href = href;
    if (crossOrigin) preconnect.crossOrigin = "";
    doc.head.appendChild(preconnect);
  }

  const stylesheet = doc.createElement("link");
  stylesheet.id = STYLESHEET_ID;
  stylesheet.rel = "stylesheet";
  stylesheet.href = BRAND_FONTS_HREF;
  doc.head.appendChild(stylesheet);
}

/**
 * Called from `main.tsx` before the app renders, so a cold load of a brand
 * route starts the font fetch in parallel with the route's own chunk rather
 * than after it.
 */
export function loadBrandFontsForPath(pathname: string): void {
  if (isBrandPath(pathname)) loadBrandFonts();
}

/**
 * For brand page components: covers an in-app navigation onto a brand page
 * (the documents list → `/templates`), which `main.tsx` never sees.
 */
export function useBrandFonts(): void {
  useEffect(() => {
    loadBrandFonts();
  }, []);
}
