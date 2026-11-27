import { useState } from "react";
import { Download } from "lucide-react";
import { SectionHead } from "./primitives/section-head";
import { WbButton } from "./primitives/wb-button";
import {
  currentDesktopPlatform,
  DESKTOP_GUIDE_PATH,
  MAC_DOWNLOAD_URL,
  WINDOWS_DOWNLOAD_URL,
  type DesktopPlatform,
  offerDesktopDownload,
} from "./desktop-download";

type Build = {
  platform: "mac" | "windows";
  name: string;
  detail: string;
  file: string;
  href: string;
  /** What a visitor should know before running it, if anything. */
  note?: string;
};

const BUILDS: Build[] = [
  {
    platform: "mac",
    name: "macOS",
    detail: "Apple silicon and Intel",
    file: "Wafflebase_universal.dmg",
    href: MAC_DOWNLOAD_URL,
  },
  {
    platform: "windows",
    name: "Windows",
    detail: "64-bit installer",
    file: "Wafflebase_x64-setup.exe",
    href: WINDOWS_DOWNLOAD_URL,
    note: "Not code-signed yet, so SmartScreen warns on first run.",
  },
];

/**
 * The desktop app's download entry: the visitor's own platform first and
 * filled, the other one beside it, install notes in the docs.
 *
 * Absent inside the desktop app itself, which renders this page when signed
 * out: offering the app to someone already in it is noise.
 */
export function DesktopSection() {
  // Read once: neither the platform nor the shell changes while the page is up.
  const [platform] = useState<DesktopPlatform>(currentDesktopPlatform);
  if (!offerDesktopDownload()) return null;

  const builds = platform === "windows" ? [...BUILDS].reverse() : BUILDS;

  return (
    <section
      id="desktop"
      aria-labelledby="desktop-title"
      className="bg-[color:var(--wb-bg)] py-16 md:py-20 px-6 md:px-8"
    >
      <div className="max-w-[1200px] mx-auto grid gap-10 md:gap-16 md:grid-cols-[1fr_1.15fr] md:items-center">
        <SectionHead
          align="left"
          className="mb-0 md:mb-0"
          titleId="desktop-title"
          title="A desktop app for macOS and Windows"
          sub="It opens wafflebase.io, or your team's own server from the app menu, and keeps itself up to date."
        />

        <div>
          {platform === "mobile" && (
            <p className="m-0 mb-4 text-[14px] leading-[1.55] text-[color:var(--wb-sub)] text-pretty">
              Open this page on a Mac or a Windows PC to install it.
            </p>
          )}
          <ul
            className="m-0 list-none p-0 border-t border-[color:var(--wb-rule)]"
            aria-label="Desktop downloads"
          >
            {builds.map((build) => (
              <li
                key={build.platform}
                data-platform={build.platform}
                className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5 border-b border-[color:var(--wb-rule)]"
              >
                <div className="min-w-0 flex-1 basis-[220px]">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className="text-[17px] font-semibold text-[color:var(--wb-ink)]">
                      {build.name}
                    </span>
                    <span className="text-[14px] text-[color:var(--wb-sub)]">
                      {build.detail}
                    </span>
                  </div>
                  <div className="font-code mt-1 text-[12.5px] text-[color:var(--wb-sub)] break-all">
                    {build.file}
                  </div>
                  {build.note && (
                    <p className="mt-2 mb-0 text-[13px] leading-[1.5] text-[color:var(--wb-sub)]">
                      {build.note}
                    </p>
                  )}
                </div>
                <WbButton
                  asChild
                  variant={build.platform === platform ? "primary" : "ghost"}
                >
                  <a href={build.href}>
                    <Download className="size-4" aria-hidden="true" />
                    Download for {build.name}
                  </a>
                </WbButton>
              </li>
            ))}
          </ul>
          <a
            href={DESKTOP_GUIDE_PATH}
            className="inline-block mt-5 text-[14px] font-medium text-[color:var(--wb-syrup-deep)] no-underline underline-offset-2 hover:underline"
          >
            Install notes →
          </a>
        </div>
      </div>
    </section>
  );
}
