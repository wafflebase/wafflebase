import { BarChart3, FileText, FunctionSquare, Shield } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { FeatureGlyph } from "./primitives/feature-glyph";
import { SectionHead } from "./primitives/section-head";

type GlyphKind = "reactive" | "formulas" | "embed" | "sync" | "io";

type HeroFeature = {
  glyph: GlyphKind;
  title: string;
  description: string;
  href: string;
};

type SecondaryFeature = {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
};

const HERO_FEATURES: HeroFeature[] = [
  {
    glyph: "sync",
    title: "Real-Time Collaboration",
    description:
      "CRDT-powered concurrent editing — multiple users work on the same sheet or document without conflicts or data loss.",
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
    Icon: FunctionSquare,
    title: "Google Sheets-Compatible Formulas",
    description: "SUM, VLOOKUP, IF, and cross-sheet references",
    href: "/docs/sheets/formulas",
  },
  {
    Icon: BarChart3,
    title: "Charts & Pivot Tables",
    description: "Built-in data visualization and aggregation",
    href: "/docs/sheets/charts",
  },
  {
    Icon: FileText,
    title: "Document Editor",
    description: "Write and format documents with a clean, page-based editor",
    href: "/docs/docs-editor/writing-a-document",
  },
  {
    Icon: Shield,
    title: "Sharing & Permissions",
    description: "URL sharing with role-based access control",
    href: "/docs/guide/collaboration",
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
          kicker="What's inside"
          title="Everything you need, nothing you don't."
          sub="Built for teams and developers who want full control over their data."
        />

        {/* Hero features — large cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 mb-6 md:mb-8">
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

        {/* Secondary features — compact row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {SECONDARY_FEATURES.map(({ Icon, title, description, href }) => (
            <FeatureCard key={title} href={href} compact>
              <div className="flex items-start gap-3">
                <div
                  className="shrink-0 mt-0.5 inline-flex items-center justify-center size-8 rounded-md"
                  style={{
                    background:
                      "color-mix(in srgb, var(--wb-butter) 35%, transparent)",
                    border:
                      "1px solid color-mix(in srgb, var(--wb-syrup) 25%, transparent)",
                  }}
                >
                  <Icon className="size-4 text-[color:var(--wb-syrup-deep)]" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-body font-semibold text-[14.5px] text-[color:var(--wb-ink)] m-0">
                    {title}
                  </h3>
                  <p className="font-body text-[13px] leading-[1.5] text-[color:var(--wb-sub)] mt-0.5 m-0">
                    {description}
                  </p>
                </div>
              </div>
            </FeatureCard>
          ))}
        </div>
      </div>
    </section>
  );
}

type FeatureCardProps = {
  href: string;
  children: ReactNode;
  compact?: boolean;
};

function FeatureCard({ href, children, compact = false }: FeatureCardProps) {
  return (
    <a
      href={href}
      className={`block bg-[color:var(--wb-paper)] border border-[color:var(--wb-rule)] rounded-xl no-underline transition-all duration-200 hover:scale-[1.005] ${
        compact ? "p-4" : "p-6 md:p-7"
      }`}
      style={{
        boxShadow:
          "0 1px 0 rgba(42,30,18,0.04), 0 12px 28px -16px rgba(42,30,18,0.18)",
      }}
    >
      {children}
    </a>
  );
}
