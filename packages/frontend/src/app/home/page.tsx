import { useEffect } from "react";
import { NavBar } from "./nav-bar";
import { HeroSection } from "./hero-section";
import { DemoSection } from "./demo-section";
import { WhySection } from "./why-section";
import { FeaturesSection } from "./features-section";
import { DeveloperSection } from "./developer-section";
import { OpenSourceSection } from "./opensource-section";
import { Footer } from "./footer";

export default function HomePage({
  workspacePath,
}: {
  workspacePath: string | null;
}) {
  useEffect(() => {
    document.title = "Wafflebase — Word Processor & Spreadsheet You Can Own";
  }, []);

  return (
    <main className="scroll-smooth">
      <NavBar workspacePath={workspacePath} />
      <HeroSection workspacePath={workspacePath} />
      <DemoSection />
      <WhySection />
      <FeaturesSection />
      <DeveloperSection />
      <OpenSourceSection />
      <Footer />
    </main>
  );
}
