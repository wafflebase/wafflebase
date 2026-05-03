import { Star } from "lucide-react";
import { BigWaffle } from "./primitives/big-waffle";
import { SectionHead } from "./primitives/section-head";
import { WbButton } from "./primitives/wb-button";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

const BADGES = ["Apache-2.0", "TypeScript", "Self-Hosted"];

export function OpenSourceSection() {
  return (
    <section className="bg-[color:var(--wb-bg)] py-16 md:py-24 px-6 md:px-8">
      <div className="max-w-[1200px] mx-auto">
        <div
          className="relative rounded-3xl border border-[color:var(--wb-rule)] bg-[color:var(--wb-paper)] grid items-center gap-10 md:gap-12 px-7 py-10 md:px-14 md:py-14 md:grid-cols-[1.4fr_1fr] overflow-hidden"
          style={{
            boxShadow:
              "0 1px 0 rgba(42,30,18,0.04), 0 30px 60px -32px rgba(42,30,18,0.18)",
          }}
        >
          <div className="relative z-10">
            <SectionHead
              align="left"
              className="mb-7"
              kicker="Open source"
              title="Free. Apache-2.0. Yours to host."
              sub="Wafflebase is open-source under the Apache-2.0 license. Contributions, issues, and forks are welcome from everyone."
            />
            <div className="flex flex-wrap gap-2.5 mb-7">
              {BADGES.map((b) => (
                <span
                  key={b}
                  className="font-code text-[12px] tracking-[0.04em] px-3 py-1.5 rounded-full text-[color:var(--wb-syrup-deep)]"
                  style={{
                    background:
                      "color-mix(in srgb, var(--wb-butter) 30%, transparent)",
                    border:
                      "1px solid color-mix(in srgb, var(--wb-syrup) 30%, transparent)",
                  }}
                >
                  {b}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <WbButton asChild variant="primary" size="lg">
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  <Star className="size-4" /> Star on GitHub
                </a>
              </WbButton>
              <WbButton asChild variant="ghost" size="lg">
                <a
                  href={`${GITHUB_URL}?tab=readme-ov-file#contributing`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Contribute →
                </a>
              </WbButton>
            </div>
          </div>

          {/* BigWaffle illustration */}
          <div className="relative z-10 flex justify-center md:justify-end">
            <div className="w-full max-w-[320px] aspect-square">
              <BigWaffle />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
