import { Check, Minus, X } from "lucide-react";
import type { ReactNode } from "react";

function LimitedBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      <Minus className="size-3" />
      Limited
    </span>
  );
}

const rows: { label: string; wafflebase: ReactNode; others: ReactNode }[] = [
  {
    label: "Self-hosted & own your data",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <X className="size-4 text-red-400/70" />,
  },
  {
    label: "REST API & CLI",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <LimitedBadge />,
  },
  {
    label: "Real-time collaboration",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <Check className="size-4 text-green-500" />,
  },
  {
    label: "Sheets & Docs in one app",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <Check className="size-4 text-green-500" />,
  },
  {
    label: "Free & open source",
    wafflebase: <Check className="size-4 text-green-500" />,
    others: <LimitedBadge />,
  },
];

export function WhySection() {
  return (
    <section className="bg-homepage-bg py-12 md:py-20 px-4 md:px-12">
      <h2 className="text-center text-3xl font-bold text-homepage-text mb-2">
        Why Wafflebase?
      </h2>
      <p className="text-center text-base text-homepage-text-secondary mb-10 max-w-lg mx-auto">
        A workspace that respects your data and your workflow
      </p>

      <table className="max-w-[540px] mx-auto w-full rounded-xl border border-homepage-accent/30 overflow-hidden border-separate border-spacing-0">
        <thead>
          <tr className="text-sm font-semibold bg-homepage-hero-end">
            <th className="px-5 py-3 text-left text-homepage-text-secondary font-semibold" />
            <th className="px-5 py-3 text-center text-homepage-text font-semibold">Wafflebase</th>
            <th className="px-5 py-3 text-center text-muted-foreground font-semibold">
              Google Workspace
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.label}
              className={`text-sm ${
                i % 2 === 0 ? "bg-homepage-bg" : "bg-homepage-hero-end/50"
              }`}
            >
              <th scope="row" className="px-5 py-3 text-left text-homepage-text font-normal">
                {row.label}
              </th>
              <td className="px-5 py-3">
                <div className="flex items-center justify-center">{row.wafflebase}</div>
              </td>
              <td className="px-5 py-3">
                <div className="flex items-center justify-center">{row.others}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
