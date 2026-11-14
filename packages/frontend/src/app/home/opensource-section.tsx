import { Star } from "lucide-react";
import { RepoMap } from "./primitives/repo-map";
import { SectionHead } from "./primitives/section-head";
import { WbButton } from "./primitives/wb-button";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

const BADGES = ["Apache-2.0", "TypeScript", "Self-hosted"];

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
              title="The whole suite is open source"
              sub="Every editor, the backend and the CLI live in one public repository. Issues, pull requests and forks are open to anyone."
            />
            <div className="flex flex-wrap gap-2.5 mb-7">
              {BADGES.map((b) => (
                <span
                  key={b}
                  className="font-code text-[12px] tracking-[0.04em] px-3 py-1.5 rounded-full text-[color:var(--wb-ink)] bg-[color:var(--wb-wash)] border border-[color:var(--wb-rule)]"
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

          {/* What the one repository holds, drawn as a ruled file tree. */}
          <div className="relative z-10 flex justify-center md:justify-end">
            <RepoMap />
          </div>
        </div>
      </div>
    </section>
  );
}
