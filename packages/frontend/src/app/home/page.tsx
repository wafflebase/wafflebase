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
import { OpenSourceSection } from "./opensource-section";
import { Footer } from "./footer";

export default function HomePage({
  workspacePath,
}: {
  workspacePath: string | null;
}) {
  const { hash } = useLocation();

  useEffect(() => {
    document.title = "Wafflebase — The Open-Source Office Suite You Can Own";
  }, []);

  // Arriving from `/templates` at `/#features`: the browser resolved the hash
  // before this page existed, so nothing scrolled. See `hash-scroll.ts`.
  useEffect(() => {
    if (hash) scrollToHashTarget(hash.slice(1));
  }, [hash]);

  return (
    <main className="scroll-smooth bg-[color:var(--wb-bg)]">
      <NavBar workspacePath={workspacePath} />
      <HeroSection workspacePath={workspacePath} />
      <DemoSection />
      <FeaturesSection />
      <UseCasesSection />
      <InteropSection />
      <WhySection />
      <DeveloperSection />
      <OpenSourceSection />
      <Footer />
    </main>
  );
}
