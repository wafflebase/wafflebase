import { NavBar } from "./nav-bar";
import { HeroSection } from "./hero-section";
import { DemoSection } from "./demo-section";
import { FeaturesSection } from "./features-section";
import { DeveloperSection } from "./developer-section";
import { OpenSourceSection } from "./opensource-section";
import { Footer } from "./footer";

export default function HomePage() {
  return (
    <main className="scroll-smooth">
      <NavBar />
      <HeroSection />
      <DemoSection />
      <FeaturesSection />
      <DeveloperSection />
      <OpenSourceSection />
      <Footer />
    </main>
  );
}
