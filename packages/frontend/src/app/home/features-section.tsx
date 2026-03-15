import { Globe, Terminal, Server, FunctionSquare, BarChart3, Shield } from "lucide-react";
import type { ReactNode } from "react";

const heroFeatures: { icon: ReactNode; title: string; description: string }[] = [
  {
    icon: <Globe className="size-8 text-homepage-accent" />,
    title: "Real-Time Collaboration",
    description:
      "CRDT-powered concurrent editing — multiple users work on the same sheet without conflicts or data loss.",
  },
  {
    icon: <Terminal className="size-8 text-homepage-accent" />,
    title: "REST API & CLI",
    description:
      "Read and write cells programmatically. Automate reports, sync data pipelines, or build integrations.",
  },
  {
    icon: <Server className="size-8 text-homepage-accent" />,
    title: "Self-Hosted & Open Source",
    description:
      "Apache-2.0 licensed. Deploy on your infrastructure, keep full control of your data, customize freely.",
  },
];

const secondaryFeatures: { icon: ReactNode; title: string; description: string }[] = [
  {
    icon: <FunctionSquare className="size-5 text-homepage-accent" />,
    title: "Google Sheets-Compatible Formulas",
    description: "SUM, VLOOKUP, IF, and cross-sheet references",
  },
  {
    icon: <BarChart3 className="size-5 text-homepage-accent" />,
    title: "Charts & Pivot Tables",
    description: "Built-in data visualization and aggregation",
  },
  {
    icon: <Shield className="size-5 text-homepage-accent" />,
    title: "Sharing & Permissions",
    description: "URL sharing with role-based access control",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="bg-background py-12 md:py-20 px-4 md:px-12">
      <h2 className="text-center text-3xl font-bold text-homepage-text mb-2">
        Everything You Need, Nothing You Don't
      </h2>
      <p className="text-center text-base text-homepage-text-secondary mb-12">
        Built for teams and developers who want full control over their data
      </p>

      {/* Hero features — large cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-[960px] mx-auto mb-8">
        {heroFeatures.map((f) => (
          <div
            key={f.title}
            className="bg-homepage-bg border border-homepage-accent/30 rounded-xl p-8"
          >
            <div className="mb-4">{f.icon}</div>
            <h3 className="text-lg font-semibold text-homepage-text mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>

      {/* Secondary features — compact row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-[960px] mx-auto">
        {secondaryFeatures.map((f) => (
          <div
            key={f.title}
            className="flex items-start gap-3 rounded-lg px-5 py-4"
          >
            <div className="mt-0.5 shrink-0">{f.icon}</div>
            <div>
              <h3 className="text-sm font-semibold text-homepage-text">{f.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
