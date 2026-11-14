import { SectionHead } from "./primitives/section-head";

type UseCase = {
  title: string;
  body: string;
  href: string;
};

const USE_CASES: UseCase[] = [
  {
    title: "Replace the 'export to Excel, edit, paste back' loop",
    body: "A SQL tab reads straight from PostgreSQL into a read-only grid, right beside your editable tabs. Press Execute for fresh rows instead of exporting another CSV.",
    href: "/docs/sheets/datasources",
  },
  {
    title: "Ship the deck on your brand, not Google's",
    body: "Four-tier theme system, Google-Slides-parity layouts, and a self-hosted store, so your team's decks live where your data lives.",
    href: "/docs/slides/build-a-deck",
  },
  {
    title: "Roll the spec back to the version everyone signed off on",
    body: "Every sheet, doc, slide, note and board keeps a dated timeline of its 50 most recent versions. Name the current state as you ship it; restoring an older one saves today's state first.",
    href: "/docs/guide/collaboration#version-history",
  },
];

export function UseCasesSection() {
  return (
    <section className="bg-[color:var(--wb-bg)] py-16 md:py-20 px-6 md:px-8">
      <div className="max-w-[1200px] mx-auto">
        <SectionHead
          title="Three jobs it handles"
          sub="Query your own database instead of exporting CSVs, keep decks on your own servers, and roll a document back to the version you named."
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {USE_CASES.map((u) => (
            <article
              key={u.title}
              className="relative flex flex-col gap-3 rounded-2xl border border-[color:var(--wb-rule)] bg-[color:var(--wb-paper)] px-6 pt-7 pb-6 transition-all duration-150 hover:-translate-y-0.5"
              style={{
                boxShadow:
                  "0 1px 0 rgba(42,30,18,0.04), 0 12px 28px -16px rgba(42,30,18,0.18)",
              }}
            >
              <h3
                className="font-display font-semibold text-[19px] leading-[1.3] tracking-[-0.015em] text-balance text-[color:var(--wb-ink)] m-0"
                style={{ fontFeatureSettings: "'ss01' on, 'ss02' on" }}
              >
                {u.title}
              </h3>
              <p className="text-[14.5px] leading-[1.55] text-[color:var(--wb-sub)] m-0">
                {u.body}
              </p>
              <a
                href={u.href}
                className="mt-auto pt-2 text-[13px] font-medium text-[color:var(--wb-syrup-deep)] no-underline underline-offset-2 hover:underline"
              >
                Read the docs →
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
