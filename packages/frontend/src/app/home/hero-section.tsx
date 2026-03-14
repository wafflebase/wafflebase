import { Link } from "react-router-dom";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

export function HeroSection() {
  return (
    <section className="bg-gradient-to-b from-homepage-bg to-homepage-hero-end py-20 px-12 text-center">
      <h1 className="text-5xl font-extrabold text-homepage-text mb-4 leading-tight">
        Super Simple Spreadsheet
        <br />
        for Data Analysis
      </h1>
      <p className="text-xl text-homepage-text-secondary mb-8 max-w-xl mx-auto">
        A collaborative, open-source spreadsheet with real-time editing,
        formulas, charts, and a powerful REST API &amp; CLI for automation.
      </p>
      <div className="flex gap-3 justify-center">
        <Link
          to="/login"
          className="bg-homepage-accent text-white px-8 py-3.5 rounded-lg text-base font-semibold no-underline"
        >
          Get Started Free →
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="border-2 border-homepage-accent text-homepage-text px-8 py-3.5 rounded-lg text-base font-semibold no-underline"
        >
          View on GitHub →
        </a>
      </div>
    </section>
  );
}
