import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

const rows: { label: string; wafflebase: ReactNode; others: ReactNode }[] = [
  {
    label: "Self-hosted & own your data",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <X className="size-4 text-muted-foreground" />,
  },
  {
    label: "REST API & CLI",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <span className="text-xs text-muted-foreground">Limited</span>,
  },
  {
    label: "Real-time collaboration",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <Check className="size-4 text-green-500" />,
  },
  {
    label: "Free & open source (Apache-2.0)",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <X className="size-4 text-muted-foreground" />,
  },
];

export function WhySection() {
  return (
    <section className="bg-homepage-bg py-12 md:py-20 px-4 md:px-12">
      <h2 className="text-center text-3xl font-bold text-homepage-text mb-2">
        Why Wafflebase?
      </h2>
      <p className="text-center text-base text-homepage-text-secondary mb-10 max-w-lg mx-auto">
        A spreadsheet that respects your data and your workflow
      </p>

      <div className="max-w-[540px] mx-auto rounded-xl border border-homepage-accent/30 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-3 text-sm font-semibold bg-homepage-hero-end">
          <div className="px-5 py-3 text-homepage-text-secondary" />
          <div className="px-5 py-3 text-center text-homepage-text">Wafflebase</div>
          <div className="px-5 py-3 text-center text-muted-foreground">Others</div>
        </div>
        {/* Rows */}
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`grid grid-cols-3 text-sm ${
              i % 2 === 0 ? "bg-homepage-bg" : "bg-homepage-hero-end/50"
            }`}
          >
            <div className="px-5 py-3 text-homepage-text">{row.label}</div>
            <div className="px-5 py-3 flex justify-center">{row.wafflebase}</div>
            <div className="px-5 py-3 flex justify-center">{row.others}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
