import { Check, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import { SectionHead } from "./primitives/section-head";

function LimitedBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-code text-[color:var(--wb-syrup-deep)]"
      style={{
        background: "color-mix(in srgb, var(--wb-butter) 30%, transparent)",
      }}
    >
      <Minus className="size-3" aria-hidden="true" />
      Limited
    </span>
  );
}

function CheckMark() {
  return <Check className="size-4 text-[color:var(--wb-leaf)]" />;
}

function CrossMark() {
  return (
    <X className="size-4 text-[color:var(--wb-berry)] opacity-70" />
  );
}

const rows: { label: string; wafflebase: ReactNode; others: ReactNode }[] = [
  {
    label: "Self-hosted & own your data",
    wafflebase: <CheckMark />,
    others: <CrossMark />,
  },
  {
    label: "REST API & CLI",
    wafflebase: <CheckMark />,
    others: <LimitedBadge />,
  },
  {
    label: "Real-time collaboration",
    wafflebase: <CheckMark />,
    others: <CheckMark />,
  },
  {
    label: "Slides, Docs & Sheets in one app",
    wafflebase: <CheckMark />,
    others: <CheckMark />,
  },
  {
    label: "Free & open source",
    wafflebase: <CheckMark />,
    others: <LimitedBadge />,
  },
];

export function WhySection() {
  return (
    <section className="bg-[color:var(--wb-bg)] py-16 md:py-20 px-6 md:px-8">
      <div className="max-w-[1200px] mx-auto">
        <SectionHead
          kicker="Why Wafflebase"
          title="A workspace that respects your data and your workflow."
          sub="Open source, self-hosted, and developer-first — no surprises, no lock-in."
        />

        <div
          className="max-w-[640px] mx-auto rounded-2xl overflow-hidden border border-[color:var(--wb-rule)] bg-[color:var(--wb-paper)]"
          style={{
            boxShadow:
              "0 1px 0 rgba(42,30,18,0.04), 0 12px 28px -16px rgba(42,30,18,0.18)",
          }}
        >
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr
                className="font-body text-[13.5px]"
                style={{
                  background:
                    "color-mix(in srgb, var(--wb-rule) 30%, var(--wb-paper))",
                }}
              >
                <th className="px-5 py-3 text-left font-semibold text-[color:var(--wb-sub)]" />
                <th className="px-5 py-3 text-center font-semibold text-[color:var(--wb-ink)]">
                  Wafflebase
                </th>
                <th className="px-5 py-3 text-center font-semibold text-[color:var(--wb-sub)]">
                  Google Workspace
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.label}
                  className="text-[14px]"
                  style={
                    i % 2 === 0
                      ? undefined
                      : {
                          background:
                            "color-mix(in srgb, var(--wb-rule) 12%, var(--wb-paper))",
                        }
                  }
                >
                  <th
                    scope="row"
                    className="px-5 py-3 text-left font-normal text-[color:var(--wb-ink)] border-t border-[color:var(--wb-rule)]"
                  >
                    {row.label}
                  </th>
                  <td className="px-5 py-3 border-t border-[color:var(--wb-rule)]">
                    <div className="flex items-center justify-center">
                      {row.wafflebase}
                    </div>
                  </td>
                  <td className="px-5 py-3 border-t border-[color:var(--wb-rule)]">
                    <div className="flex items-center justify-center">
                      {row.others}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
