import { isDesktopShell } from "@/lib/service-worker";

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

/**
 * The first release whose GitHub release carries the desktop assets (#1206).
 * Before it, `releases/latest/download/…` answers 404, so a frontend older
 * than it offers no download at all. The frontend deploys from main at the
 * root version, which reaches this only in the release that publishes the
 * assets; the gap left is that release's own desktop run (about half an
 * hour, docs/design/desktop-app.md §7).
 */
export const FIRST_DESKTOP_RELEASE = "0.6.19";

/** Whether `version` (default: this build's) is at or past the first desktop release. */
export function desktopDownloadsPublished(version: string = __APP_VERSION__): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, "").split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  const [a, b] = [parse(version), parse(FIRST_DESKTOP_RELEASE)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/**
 * Whether the homepage advertises the download at all: only once a release
 * carries it, and never inside the desktop app itself.
 */
export function offerDesktopDownload(version: string = __APP_VERSION__): boolean {
  return desktopDownloadsPublished(version) && !isDesktopShell();
}

/**
 * Install notes in the docs site. A plain `<a href>`, never a router `Link`:
 * `/docs` is a separate VitePress site, and `Link` would route it into the SPA.
 */
export const DESKTOP_GUIDE_PATH = "/docs/start/desktop";

/** The visitor's platform, as far as choosing a download goes. */
export type DesktopPlatform = "mac" | "windows" | "mobile" | "other";

/** The parts of `navigator` the choice reads; a parameter so tests can pass one. */
type PlatformProbe = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean };
};

/**
 * Who the download is for. Only a Mac visitor is offered it first: the first
 * public release is macOS-only (the Windows build is not Authenticode-signed
 * yet, docs/design/desktop-app.md §7), so Windows and Linux are told it is
 * coming, and pushing a `.dmg` at someone on a phone is noise. Windows stays
 * its own answer so that page can say so, and so it is ready when that build
 * ships.
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
