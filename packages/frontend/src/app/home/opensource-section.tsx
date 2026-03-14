const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

const badges = ["Apache-2.0", "TypeScript", "Self-Hosted"];

export function OpenSourceSection() {
  return (
    <section className="bg-homepage-hero-end py-20 px-12 text-center">
      <h2 className="text-3xl font-bold text-homepage-text mb-3">
        Join the Open Source Community
      </h2>
      <p className="text-base text-homepage-text-secondary mb-8 max-w-lg mx-auto">
        Wafflebase is open-source under the Apache-2.0 license. Contributions
        are welcome from everyone.
      </p>
      <div className="flex gap-4 justify-center mb-6">
        {badges.map((b) => (
          <span
            key={b}
            className="bg-homepage-bg border border-homepage-accent/30 rounded-lg px-6 py-3 text-sm text-homepage-text font-semibold"
          >
            {b}
          </span>
        ))}
      </div>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 bg-stone-900 dark:bg-amber-400 text-white dark:text-stone-900 px-8 py-3.5 rounded-lg text-base font-semibold no-underline"
      >
        ⭐ Star on GitHub
      </a>
    </section>
  );
}
