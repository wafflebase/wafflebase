import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_GUIDE_PATH,
  detectDesktopPlatform,
  MAC_DOWNLOAD_URL,
  WINDOWS_DOWNLOAD_URL,
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

// That the URLs name the assets the release uploads is checked against the
// workflow itself, in scripts/test/desktop-release.test.mjs. Here: the page
// links each URL and shows the file name that URL downloads.
describe("download links", () => {
  it("show the file each one downloads", () => {
    stubNavigator({ userAgent: MAC_UA, platform: "MacIntel" });
    renderSection();
    for (const url of [MAC_DOWNLOAD_URL, WINDOWS_DOWNLOAD_URL]) {
      const link = screen
        .getAllByRole("link")
        .find((a) => a.getAttribute("href") === url);
      expect(link, url).toBeTruthy();
      const file = url.slice(url.lastIndexOf("/") + 1);
      expect(link!.closest("li")!.textContent).toContain(file);
    }
  });
});

describe("DesktopSection", () => {
  function rows() {
    const list = screen.getByRole("list", { name: "Desktop downloads" });
    return within(list).getAllByRole("listitem");
  }
  function link(row: HTMLElement) {
    return within(row).getByRole("link", { name: /Download for/ });
  }

  it("leads with the macOS download on a Mac and keeps Windows beside it", () => {
    stubNavigator({ userAgent: MAC_UA, platform: "MacIntel" });
    renderSection();
    const [first, second] = rows();
    expect(first.dataset.platform).toBe("mac");
    expect(link(first)).toHaveAttribute("href", MAC_DOWNLOAD_URL);
    expect(link(first).className).toContain("bg-primary");
    expect(second.dataset.platform).toBe("windows");
    expect(link(second)).toHaveAttribute("href", WINDOWS_DOWNLOAD_URL);
    expect(link(second).className).not.toContain("bg-primary");
  });

  it("leads with the Windows download on Windows", () => {
    stubNavigator({ userAgent: WINDOWS_UA, platform: "Win32" });
    renderSection();
    const [first, second] = rows();
    expect(first.dataset.platform).toBe("windows");
    expect(link(first).className).toContain("bg-primary");
    expect(second.dataset.platform).toBe("mac");
    expect(link(second).className).not.toContain("bg-primary");
  });

  it.each([
    ["Linux", { userAgent: LINUX_UA, platform: "Linux x86_64" }],
    ["a phone", { userAgent: IPHONE_UA, platform: "iPhone" }],
  ])("offers both builds unranked on %s", (_label, probe) => {
    stubNavigator(probe);
    renderSection();
    const all = rows();
    expect(all).toHaveLength(2);
    for (const row of all) {
      expect(link(row).className).not.toContain("bg-primary");
    }
  });

  it("tells a phone to come back on a computer, and nobody else", () => {
    stubNavigator({ userAgent: IPHONE_UA, platform: "iPhone" });
    const { unmount } = renderSection();
    expect(screen.getByText(/Open this page on a Mac/)).toBeInTheDocument();
    unmount();
    stubNavigator({ userAgent: MAC_UA, platform: "MacIntel" });
    renderSection();
    expect(screen.queryByText(/Open this page on a Mac/)).toBeNull();
  });

  it("says the Windows build is not code-signed, on the Windows row", () => {
    stubNavigator({ userAgent: MAC_UA, platform: "MacIntel" });
    renderSection();
    const windows = rows().find((r) => r.dataset.platform === "windows")!;
    expect(within(windows).getByText(/Not code-signed yet/)).toBeInTheDocument();
    const mac = rows().find((r) => r.dataset.platform === "mac")!;
    expect(within(mac).queryByText(/code-signed/)).toBeNull();
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

  it("points the hero and footer at the desktop section on a computer", () => {
    stubNavigator({ userAgent: MAC_UA, platform: "MacIntel" });
    hero();
    expect(
      screen.getByRole("link", { name: /desktop app for macOS and Windows/ }),
    ).toHaveAttribute("href", "/#desktop");
    footer();
    expect(screen.getByRole("link", { name: "Desktop app" })).toHaveAttribute(
      "href",
      "/#desktop",
    );
  });

  it("keeps the hero quiet on a phone", () => {
    stubNavigator({ userAgent: IPHONE_UA, platform: "iPhone" });
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
