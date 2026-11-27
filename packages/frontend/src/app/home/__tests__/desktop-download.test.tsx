import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
// This build's version is whatever the root package says today, which may
// predate the first release that carries the app; the components read it
// through `offerDesktopDownload`, so pin the version they see here.
const appVersion = vi.hoisted(() => ({ current: "0.6.19" }));
vi.mock("../desktop-download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../desktop-download")>();
  return {
    ...actual,
    offerDesktopDownload: (version?: string) =>
      actual.offerDesktopDownload(version ?? appVersion.current),
  };
});

import {
  DESKTOP_GUIDE_PATH,
  desktopDownloadsPublished,
  detectDesktopPlatform,
  FIRST_DESKTOP_RELEASE,
  MAC_DOWNLOAD_URL,
} from "../desktop-download";
import { DesktopSection } from "../desktop-section";
import { HeroSection } from "../hero-section";
import { Footer } from "../footer";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

function stubNavigator(probe: {
  userAgent: string;
  platform: string;
  maxTouchPoints?: number;
}) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(probe.userAgent);
  vi.spyOn(navigator, "platform", "get").mockReturnValue(probe.platform);
  // jsdom has no `maxTouchPoints` to spy on; define it, removed afterEach.
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    get: () => probe.maxTouchPoints ?? 0,
  });
}

function renderSection() {
  return render(<DesktopSection />);
}

afterEach(() => {
  appVersion.current = FIRST_DESKTOP_RELEASE;
  vi.restoreAllMocks();
  delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
  delete (window as { __WAFFLEBASE_DESKTOP__?: unknown }).__WAFFLEBASE_DESKTOP__;
});

describe("detectDesktopPlatform", () => {
  it.each([
    ["mac", { userAgent: MAC_UA, platform: "MacIntel" }],
    ["windows", { userAgent: WINDOWS_UA, platform: "Win32" }],
    ["other", { userAgent: LINUX_UA, platform: "Linux x86_64" }],
    ["mobile", { userAgent: IPHONE_UA, platform: "iPhone" }],
    ["mobile", { userAgent: ANDROID_UA, platform: "Linux armv81" }],
    // iPadOS asks for the desktop site and reports itself as a Mac.
    ["mobile", { userAgent: MAC_UA, platform: "MacIntel", maxTouchPoints: 5 }],
  ] as const)("reads %s from %j", (expected, probe) => {
    expect(detectDesktopPlatform(probe)).toBe(expected);
  });

  // Every other signal says Mac here, so only the hints can produce the
  // answer: precedence, not agreement.
  it("prefers client hints over the frozen navigator.platform", () => {
    expect(
      detectDesktopPlatform({
        userAgent: MAC_UA,
        platform: "MacIntel",
        userAgentData: { platform: "Windows", mobile: false },
      }),
    ).toBe("windows");
    expect(
      detectDesktopPlatform({
        userAgent: MAC_UA,
        platform: "MacIntel",
        userAgentData: { platform: "Android", mobile: true },
      }),
    ).toBe("mobile");
  });

  it("falls back to other without a navigator", () => {
    expect(detectDesktopPlatform(undefined)).toBe("other");
  });
});

// That the URL names an asset the release uploads is checked against the
// workflow itself, in scripts/test/desktop-release.test.mjs. Here: the page
// links only that URL, shows the file it downloads, and links no Windows
// build — the first public release is macOS-only.
describe("download links", () => {
  it("link only the macOS build and show the file it downloads", () => {
    stubNavigator({ userAgent: WINDOWS_UA, platform: "Win32" });
    renderSection();
    const downloads = screen.getAllByRole("link", { name: /Download for/ });
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toHaveAttribute("href", MAC_DOWNLOAD_URL);
    const file = MAC_DOWNLOAD_URL.slice(MAC_DOWNLOAD_URL.lastIndexOf("/") + 1);
    expect(downloads[0].closest("[data-platform]")!.textContent).toContain(file);
    for (const a of screen.getAllByRole("link")) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/\.exe$/);
    }
  });
});

describe("DesktopSection", () => {
  function download() {
    return screen.getByRole("link", { name: "Download for macOS" });
  }
  const COMING = /Windows and Linux versions are coming/;

  it("fills the macOS download on a Mac and says nothing else", () => {
    stubNavigator({ userAgent: MAC_UA, platform: "MacIntel" });
    renderSection();
    expect(download()).toHaveAttribute("href", MAC_DOWNLOAD_URL);
    expect(download().className).toContain("bg-primary");
    expect(screen.queryByText(COMING)).toBeNull();
    expect(screen.queryByText(/Open this page on a Mac/)).toBeNull();
  });

  it.each([
    ["Windows", { userAgent: WINDOWS_UA, platform: "Win32" }],
    ["Linux", { userAgent: LINUX_UA, platform: "Linux x86_64" }],
  ])("tells %s the other versions are coming, macOS outlined", (_label, probe) => {
    stubNavigator(probe);
    renderSection();
    expect(screen.getByText(COMING)).toBeInTheDocument();
    expect(download().className).not.toContain("bg-primary");
  });

  it("tells a phone to come back on a Mac", () => {
    stubNavigator({ userAgent: IPHONE_UA, platform: "iPhone" });
    renderSection();
    expect(screen.getByText(/Open this page on a Mac/)).toBeInTheDocument();
    expect(screen.queryByText(COMING)).toBeNull();
    expect(download().className).not.toContain("bg-primary");
  });

  it("promises no Windows build in its heading", () => {
    renderSection();
    expect(
      screen.getByRole("heading", { name: "A desktop app for macOS" }),
    ).toBeInTheDocument();
  });

  it("links install notes to the docs site with a plain anchor", () => {
    renderSection();
    const notes = screen.getByRole("link", { name: /Install notes/ });
    expect(DESKTOP_GUIDE_PATH).toBe("/docs/start/desktop");
    // No router around it, so this anchor did not come from `Link`, which
    // would route `/docs` into the SPA instead of the separate docs site.
    expect(notes.tagName).toBe("A");
    expect(notes).toHaveAttribute("href", "/docs/start/desktop");
  });

  it("renders nothing inside the desktop app", () => {
    (window as { __WAFFLEBASE_DESKTOP__?: unknown }).__WAFFLEBASE_DESKTOP__ = true;
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("desktop entry points elsewhere on the page", () => {
  const hero = () =>
    render(
      <MemoryRouter>
        <HeroSection workspacePath={null} />
      </MemoryRouter>,
    );
  const footer = () =>
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

  it("points the hero and footer at the desktop section on a Mac", () => {
    stubNavigator({ userAgent: MAC_UA, platform: "MacIntel" });
    hero();
    expect(
      screen.getByRole("link", { name: "Also a desktop app for macOS →" }),
    ).toHaveAttribute("href", "/#desktop");
    footer();
    expect(screen.getByRole("link", { name: "Desktop app" })).toHaveAttribute(
      "href",
      "/#desktop",
    );
  });

  it.each([
    ["a phone", { userAgent: IPHONE_UA, platform: "iPhone" }],
    ["Windows", { userAgent: WINDOWS_UA, platform: "Win32" }],
    ["Linux", { userAgent: LINUX_UA, platform: "Linux x86_64" }],
  ])("keeps the hero quiet on %s, which has no build yet", (_label, probe) => {
    stubNavigator(probe);
    hero();
    expect(screen.queryByRole("link", { name: /desktop app/ })).toBeNull();
  });

  it("drops both inside the desktop app", () => {
    stubNavigator({ userAgent: MAC_UA, platform: "MacIntel" });
    (window as { __WAFFLEBASE_DESKTOP__?: unknown }).__WAFFLEBASE_DESKTOP__ = true;
    hero();
    footer();
    expect(screen.queryByRole("link", { name: /desktop app/i })).toBeNull();
  });
});

// Before the first release that carries the app, `releases/latest/download/…`
// answers 404: a frontend deployed from main ahead of that release must not
// advertise the download.
describe("before a release carries the app", () => {
  it.each([
    ["0.6.18", false],
    ["0.6.19", true],
    ["v0.6.19", true],
    ["0.6.20-rc.1", true],
    ["0.7.0", true],
    ["1.0.0", true],
    ["0.5.99", false],
  ])("%s publishes downloads: %s", (version, expected) => {
    expect(desktopDownloadsPublished(version)).toBe(expected);
  });

  it("shows no section, hero link or footer entry", () => {
    appVersion.current = "0.6.18";
    stubNavigator({ userAgent: MAC_UA, platform: "MacIntel" });
    const { container } = render(
      <MemoryRouter>
        <HeroSection workspacePath={null} />
        <DesktopSection />
        <Footer />
      </MemoryRouter>,
    );
    expect(container.querySelector("#desktop")).toBeNull();
    expect(container.querySelector('a[href="/#desktop"]')).toBeNull();
  });
});
