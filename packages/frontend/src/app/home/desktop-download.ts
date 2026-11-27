/**
 * Where the desktop app downloads from, and which one a visitor is offered
 * first.
 *
 * The asset names are pinned by `scripts/test/desktop-release.test.mjs`: the
 * release workflow uploads exactly these, and `releases/latest/download/…`
 * follows every server release because the app ships with it. Change them
 * there first.
 */
const RELEASES = "https://github.com/wafflebase/wafflebase/releases/latest/download";

export const MAC_DOWNLOAD_URL = `${RELEASES}/Wafflebase_universal.dmg`;
export const WINDOWS_DOWNLOAD_URL = `${RELEASES}/Wafflebase_x64-setup.exe`;

/**
 * Install notes in the docs site. A plain `<a href>`, never a router `Link`:
 * `/docs` is a separate VitePress site, and `Link` would route it into the SPA.
 */
export const DESKTOP_GUIDE_PATH = "/docs/start/desktop";

/** The visitor's platform, as far as choosing a download goes. */
export type DesktopPlatform = "mac" | "windows" | "mobile" | "other";

/** The parts of `navigator` the choice reads; a parameter so tests can pass one. */
export type PlatformProbe = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean };
};

/**
 * Pick the download to lead with. Phones and tablets get neither: the app is
 * for macOS and Windows, and pushing a `.dmg` at someone on an iPhone is
 * noise. Linux and anything unrecognized get both, unranked.
 *
 * iPadOS reports itself as a Mac (`MacIntel`, a desktop Safari UA), so a Mac
 * with a touch screen is read as an iPad: no Mac has one.
 */
export function detectDesktopPlatform(nav: PlatformProbe | undefined): DesktopPlatform {
  if (!nav) return "other";
  const ua = nav.userAgent ?? "";
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
    return "mobile";
  }
  // Client hints first: `navigator.platform` is frozen and deprecated, but it
  // is all Safari and Firefox offer.
  const platform = nav.userAgentData?.platform || nav.platform || "";
  if (/^mac/i.test(platform) || (!platform && /Macintosh/.test(ua))) {
    return (nav.maxTouchPoints ?? 0) > 1 ? "mobile" : "mac";
  }
  if (/^win/i.test(platform) || (!platform && /Windows/.test(ua))) {
    return "windows";
  }
  return "other";
}

export function currentDesktopPlatform(): DesktopPlatform {
  return detectDesktopPlatform(
    typeof navigator === "undefined" ? undefined : (navigator as PlatformProbe),
  );
}
