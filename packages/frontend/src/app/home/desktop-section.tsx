import { useState } from "react";
import { Download } from "lucide-react";
import { SectionHead } from "./primitives/section-head";
import { WbButton } from "./primitives/wb-button";
import {
  currentDesktopPlatform,
  DESKTOP_GUIDE_PATH,
  MAC_DOWNLOAD_URL,
  type DesktopPlatform,
  offerDesktopDownload,
} from "./desktop-download";

const MAC_FILE = "Wafflebase_universal.dmg";

/**
 * What a visitor who cannot use the macOS build is told instead, if anything.
 * The first public release is macOS-only: the Windows build compiles in CI
 * but is not Authenticode-signed, so it is neither shipped nor linked
 * (docs/design/desktop-app.md §7). Say so plainly rather than hide the
 * section from a Windows or Linux visitor who scrolled to it.
 */
const PLATFORM_NOTE: Partial<Record<DesktopPlatform, string>> = {
  windows: "Windows and Linux versions are coming.",
  other: "Windows and Linux versions are coming.",
  mobile: "Open this page on a Mac to install it.",
};

/**
 * The desktop app's download entry: the macOS build, filled for a Mac
 * visitor and outlined for everyone else, with install notes in the docs.
 *
 * Absent inside the desktop app itself, which renders this page when signed
 * out: offering the app to someone already in it is noise.
 */
export function DesktopSection() {
  // Read once: neither the platform nor the shell changes while the page is up.
  const [platform] = useState<DesktopPlatform>(currentDesktopPlatform);
  if (!offerDesktopDownload()) return null;

  const note = PLATFORM_NOTE[platform];

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
          title="A desktop app for macOS"
          sub="It opens wafflebase.io, or your team's own server from the app menu, and keeps itself up to date."
        />

        <div>
          {note && (
            <p className="m-0 mb-4 text-[14px] leading-[1.55] text-[color:var(--wb-sub)] text-pretty">
              {note}
            </p>
          )}
          <div
            data-platform="mac"
            className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5 border-y border-[color:var(--wb-rule)]"
          >
            <div className="min-w-0 flex-1 basis-[220px]">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-[17px] font-semibold text-[color:var(--wb-ink)]">
                  macOS
                </span>
                <span className="text-[14px] text-[color:var(--wb-sub)]">
                  Apple silicon and Intel
                </span>
              </div>
              <div className="font-code mt-1 text-[12.5px] text-[color:var(--wb-sub)] break-all">
                {MAC_FILE}
              </div>
            </div>
            <WbButton asChild variant={platform === "mac" ? "primary" : "ghost"}>
              <a href={MAC_DOWNLOAD_URL}>
                <Download className="size-4" aria-hidden="true" />
                Download for macOS
              </a>
            </WbButton>
          </div>
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
