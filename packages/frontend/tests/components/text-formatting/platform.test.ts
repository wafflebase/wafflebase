import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The shortcuts help dialog used to sniff `navigator.platform`; it now reads
 * the shared `isMac`, which sniffs `navigator.userAgent`. Every surface that
 * renders the dialog (docs, sheets, slides, board) moved with it, so the two
 * must agree on the browsers people actually use.
 */
function previousDialogSniff(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

async function sharedSniff(userAgent: string, platform: string) {
  vi.stubGlobal("navigator", { userAgent, platform });
  vi.resetModules();
  return (await import("@/components/text-formatting/platform")).isMac;
}

// [name, userAgent, platform, expected]
const browsers: [string, string, string, boolean][] = [
  [
    "Mac Safari",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    "MacIntel",
    true,
  ],
  [
    "Mac Chrome",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "MacIntel",
    true,
  ],
  [
    "iPadOS Safari (desktop-class, the default)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    "MacIntel",
    true,
  ],
  [
    "iPad Safari (mobile site)",
    "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "iPad",
    true,
  ],
  [
    "iPhone Safari",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "iPhone",
    true,
  ],
  [
    "Windows Chrome",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Win32",
    false,
  ],
  [
    "Windows Firefox",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Win32",
    false,
  ],
  [
    "Linux Chrome",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Linux x86_64",
    false,
  ],
  [
    "Android Chrome",
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    "Linux armv81",
    false,
  ],
  [
    "ChromeOS",
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Linux x86_64",
    false,
  ],
];

describe("isMac", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each(browsers)(
    "%s: agrees with the dialog's former platform sniff",
    async (_name, userAgent, platform, expected) => {
      expect(previousDialogSniff(platform)).toBe(expected);
      expect(await sharedSniff(userAgent, platform)).toBe(expected);
    },
  );
});
