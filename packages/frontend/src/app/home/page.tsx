import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { scrollToHashTarget } from "./hash-scroll";
import { NavBar } from "./nav-bar";
import { HeroSection } from "./hero-section";
import { DemoSection } from "./demo-section";
import { FeaturesSection } from "./features-section";
import { UseCasesSection } from "./use-cases-section";
import { InteropSection } from "./interop-section";
import { WhySection } from "./why-section";
import { DeveloperSection } from "./developer-section";
import { DesktopSection } from "./desktop-section";
import { OpenSourceSection } from "./opensource-section";
import { Footer } from "./footer";
import { useBrandFonts } from "@/lib/brand-fonts";

export default function HomePage({
  workspacePath,
}: {
  workspacePath: string | null;
}) {
  const { hash } = useLocation();
  useBrandFonts();

  useEffect(() => {
    document.title = "Wafflebase — the open-source office suite you can own";
  }, []);

  // Arriving from `/templates` at `/#features`: the browser resolved the hash
  // before this page existed, so nothing scrolled. See `hash-scroll.ts`.
  useEffect(() => {
    if (hash) scrollToHashTarget(hash.slice(1));
  }, [hash]);

  return (
    // Nav and footer sit beside `<main>`, not inside it, so they keep their
    // navigation and contentinfo landmarks (the same shape as MarketingPage).
    <div className="bg-[color:var(--wb-bg)]">
      <NavBar workspacePath={workspacePath} />
      <main>
        <HeroSection workspacePath={workspacePath} />
        <DemoSection />
        <FeaturesSection />
        <UseCasesSection />
        <InteropSection />
        <WhySection />
        <DeveloperSection />
        <DesktopSection />
        <OpenSourceSection />
      </main>
      <Footer />
    </div>
  );
}
