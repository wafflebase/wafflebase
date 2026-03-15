import { Link } from "react-router-dom";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

export function HeroSection({
  workspacePath,
}: {
  workspacePath: string | null;
}) {
  return (
    <section className="bg-gradient-to-b from-homepage-bg to-homepage-hero-end py-12 md:py-20 px-4 md:px-12 text-center">
      <h1 className="text-3xl md:text-5xl font-extrabold text-homepage-text mb-4 leading-tight">
        The Open-Source Spreadsheet
        <br />
        You Can Own
      </h1>
      <p className="text-base md:text-xl text-homepage-text-secondary mb-8 max-w-xl mx-auto">
        Self-host a collaborative spreadsheet with real-time editing,
        Google Sheets-compatible formulas, and a REST API for automation.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
        <Link
          to={workspacePath ?? "/login"}
          className="bg-homepage-accent text-white px-8 py-3.5 rounded-lg text-base font-semibold no-underline hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {workspacePath ? "Go to Workspace →" : "Get Started Free →"}
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="border-2 border-homepage-accent text-homepage-text px-8 py-3.5 rounded-lg text-base font-semibold no-underline hover:bg-homepage-accent/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View on GitHub →
        </a>
      </div>
    </section>
  );
}
