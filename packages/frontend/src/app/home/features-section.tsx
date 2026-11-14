import type { ReactNode } from "react";
import { FeatureGlyph, type GlyphKind } from "./primitives/feature-glyph";
import { SectionHead } from "./primitives/section-head";

type HeroFeature = {
  glyph: GlyphKind;
  title: string;
  description: string;
  href: string;
};

type SecondaryFeature = {
  title: string;
  description: string;
  href: string;
};

const HERO_FEATURES: HeroFeature[] = [
  {
    glyph: "sync",
    title: "Real-Time Collaboration",
    description:
      "CRDT-powered concurrent editing — sheets, docs, slides, notes, and boards all take simultaneous edits without conflicts or data loss.",
    href: "/docs/guide/collaboration",
  },
  {
    glyph: "embed",
    title: "REST API & CLI",
    description:
      "Read and write cells programmatically. Automate reports, sync data pipelines, or build integrations.",
    href: "/docs/developers/rest-api",
  },
  {
    glyph: "reactive",
    title: "Self-Hosted & Open Source",
    description:
      "Apache-2.0 licensed. Deploy on your infrastructure, keep full control of your data, customize freely.",
    href: "/docs/developers/self-hosting",
  },
];

const SECONDARY_FEATURES: SecondaryFeature[] = [
  {
    title: "Google Sheets-Compatible Formulas",
    description:
      "440+ functions — SUM, VLOOKUP, IF — plus cross-sheet references",
    href: "/docs/sheets/formulas",
  },
  {
    title: "Charts, Pivots & Live Data",
    description:
      "Visualize, aggregate, and query PostgreSQL or an Iceberg/Delta lakehouse",
    href: "/docs/sheets/charts",
  },
  {
    title: "Page-Based Document Editor",
    description:
      "Paginated editor with rich tables, page breaks, and headers/footers",
    href: "/docs/docs-editor/writing-a-document",
  },
  {
    title: "Comments, Mentions & Spell Check",
    description: "Inline threads, @mentions, and live spell checking",
    href: "/docs/guide/collaboration",
  },
  {
    title: "Themes, Layouts & Shapes",
    description:
      "23 built-in themes, Google-Slides-parity layouts, 137 shapes and 4 connector types",
    href: "/docs/slides/themes-and-layouts",
  },
  {
    title: "Animations & Presentation Mode",
    description:
      "Object and slide animations plus a full-screen keyboard-driven player",
    href: "/docs/slides/build-a-deck",
  },
  {
    title: "Markdown Notes & Infinite Boards",
    description:
      "A Markdown editor with live preview, and a boundless pan-and-zoom canvas",
    href: "/docs/notes/writing-a-note",
  },
  {
    title: "Templates, PDFs & Files",
    description:
      "Publish any document as a template — and keep PDFs, images, and files beside it",
    href: "/docs/guide/templates",
  },
];

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="bg-[color:var(--wb-bg)] py-16 md:py-20 px-6 md:px-8"
    >
      <div className="max-w-[1200px] mx-auto">
        <SectionHead
          title="Everything you need, nothing you don't."
          sub="Built for teams and developers who want full control over their data."
        />

        {/* Hero features — large cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 mb-10 md:mb-12">
          {HERO_FEATURES.map((feature) => (
            <FeatureCard key={feature.title} href={feature.href}>
              <div className="mb-4 -ml-1">
                <FeatureGlyph kind={feature.glyph} />
              </div>
              <h3 className="font-body font-semibold text-[19px] leading-[1.3] text-[color:var(--wb-ink)] m-0 mb-2">
                {feature.title}
              </h3>
              <p className="font-body text-[14.5px] leading-[1.55] text-[color:var(--wb-sub)] m-0">
                {feature.description}
              </p>
            </FeatureCard>
          ))}
        </div>

        {/* Secondary features — ruled list */}
        <ul className="grid grid-cols-1 md:grid-cols-2 md:gap-x-10 list-none m-0 p-0 border-b border-[color:var(--wb-rule)]">
          {SECONDARY_FEATURES.map(({ title, description, href }) => (
            <li key={title} className="border-t border-[color:var(--wb-rule)]">
              <a
                href={href}
                className="group flex items-baseline justify-between gap-4 py-4 no-underline"
              >
                <span className="min-w-0">
                  <span className="block font-body font-semibold text-[15px] text-[color:var(--wb-ink)] transition-colors group-hover:text-[color:var(--wb-syrup-deep)]">
                    {title}
                  </span>
                  <span className="block font-body text-[14px] leading-[1.5] text-[color:var(--wb-sub)] mt-1">
                    {description}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-[color:var(--wb-sub)] transition-colors group-hover:text-[color:var(--wb-syrup-deep)]"
                >
                  →
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

type FeatureCardProps = {
  href: string;
  children: ReactNode;
};

function FeatureCard({ href, children }: FeatureCardProps) {
  return (
    <a
      href={href}
      className="block bg-[color:var(--wb-paper)] border border-[color:var(--wb-rule)] rounded-xl no-underline transition-all duration-200 hover:scale-[1.005] p-6 md:p-7"
      style={{
        boxShadow:
          "0 1px 0 rgba(42,30,18,0.04), 0 12px 28px -16px rgba(42,30,18,0.18)",
      }}
    >
      {children}
    </a>
  );
}
