import { SectionHead } from "./primitives/section-head";

type UseCase = {
  tag: string;
  title: string;
  body: string;
  href: string;
};

const USE_CASES: UseCase[] = [
  {
    tag: "Internal tools",
    title: "Replace the 'export to Excel, edit, paste back' loop",
    body: "A SQL tab pulls live rows straight from PostgreSQL; the REST API writes cells back. Users get the spreadsheet they wanted; you keep the schema you wanted.",
    href: "/docs/sheets/datasources",
  },
  {
    tag: "Pitch decks & all-hands",
    title: "Ship the deck on your brand, not Google's",
    body: "Four-tier theme system, Google-Slides-parity layouts, and a self-hosted store — your team's decks live where your data lives.",
    href: "/docs/slides/build-a-deck",
  },
  {
    tag: "Specs & launch plans",
    title: "Roll the spec back to the version everyone signed off on",
    body: "Every sheet, doc, slide, note and board keeps a dated version timeline — name the one you shipped, then restore it with today's state saved first.",
    href: "/docs/guide/collaboration#version-history",
  },
];

export function UseCasesSection() {
  return (
    <section className="bg-[color:var(--wb-bg)] py-16 md:py-20 px-6 md:px-8">
      <div className="max-w-[1200px] mx-auto">
        <SectionHead
          kicker="Where it fits"
          title="Built to live inside the workflow you already have."
          sub="Query your own database, self-host the whole stack, roll back to the version you named — Wafflebase keeps your data where you want it."
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {USE_CASES.map((u, i) => (
            <article
              key={u.tag}
              className="relative flex flex-col gap-3 rounded-2xl border border-[color:var(--wb-rule)] bg-[color:var(--wb-paper)] px-6 pt-7 pb-6 transition-all duration-150 hover:-translate-y-0.5"
              style={{
                boxShadow:
                  "0 1px 0 rgba(42,30,18,0.04), 0 12px 28px -16px rgba(42,30,18,0.18)",
              }}
            >
              <div className="font-code text-[12px] tracking-[0.08em] text-[color:var(--wb-sub)]">
                {`0${i + 1}`}
              </div>
              <span
                className="self-start font-code text-[11.5px] uppercase tracking-[0.1em] text-[color:var(--wb-syrup-deep)] px-2.5 py-1 rounded-full"
                style={{
                  background:
                    "color-mix(in srgb, var(--wb-butter) 30%, transparent)",
                }}
              >
                {u.tag}
              </span>
              <h3
                className="font-display font-semibold text-[21px] leading-[1.2] tracking-[-0.015em] text-[color:var(--wb-ink)] m-0"
                style={{ fontFeatureSettings: "'ss01' on, 'ss02' on" }}
              >
                {u.title}
              </h3>
              <p className="text-[14.5px] leading-[1.55] text-[color:var(--wb-sub)] m-0">
                {u.body}
              </p>
              <a
                href={u.href}
                className="mt-auto pt-2 text-[13px] font-medium text-[color:var(--wb-syrup-deep)] no-underline hover:text-[color:var(--wb-syrup)]"
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
