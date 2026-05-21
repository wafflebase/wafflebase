import { Link } from "react-router-dom";
import { RulerBackdrop } from "./primitives/ruler-backdrop";
import { WbButton } from "./primitives/wb-button";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

const STATS = [
  { value: "Apache-2.0", label: "License" },
  { value: "Self-hosted", label: "Deployment" },
  { value: "REST + CLI", label: "Automation" },
  { value: "Real-time", label: "Collaboration" },
] as const;

export function HeroSection({
  workspacePath,
}: {
  workspacePath: string | null;
}) {
  return (
    <section className="relative bg-[color:var(--wb-bg)] overflow-hidden">
      <RulerBackdrop />
      <div className="relative z-10 max-w-[920px] mx-auto px-6 md:px-8 pt-20 pb-14 md:pt-28 md:pb-20 text-center">
        <div className="flex flex-col items-center">
          {/* Eyebrow */}
          <div
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-7 font-code text-[13px] text-[color:var(--wb-syrup-deep)] whitespace-nowrap"
            style={{
              background:
                "color-mix(in srgb, var(--wb-butter) 30%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--wb-syrup) 30%, transparent)",
            }}
          >
            <span
              className="size-1.5 rounded-full bg-[color:var(--wb-leaf)]"
              style={{
                boxShadow:
                  "0 0 0 3px color-mix(in srgb, var(--wb-leaf) 25%, transparent)",
              }}
            />
            v0.3 · Apache-2.0 · Self-hosted
          </div>

          {/* Title */}
          <h1
            className="font-display font-semibold text-[color:var(--wb-ink)] leading-[1.04] tracking-[-0.025em] text-[clamp(40px,6vw,68px)] m-0 mb-6 max-w-[20ch]"
            style={{ fontFeatureSettings: "'ss01' on, 'ss02' on" }}
          >
            The Office Suite{" "}
            <em className="font-medium italic text-[color:var(--wb-syrup-deep)]">
              You Can Own
            </em>
          </h1>

          {/* Sub */}
          <p className="text-[color:var(--wb-sub)] leading-[1.55] text-[clamp(17px,1.4vw,19px)] max-w-[560px] m-0 mb-10">
            Sheets, Docs, and Slides. Real-time collaboration, REST API,
            fully self-hosted.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap gap-3 justify-center mb-12">
            <WbButton asChild variant="primary" size="lg">
              <Link to={workspacePath ?? "/login"}>
                {workspacePath ? "Go to Workspace →" : "Get Started Free →"}
              </Link>
            </WbButton>
            <WbButton asChild variant="ghost" size="lg">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <CodeIcon /> View on GitHub →
              </a>
            </WbButton>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-4">
            {STATS.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-0.5">
                <div className="font-display font-semibold text-[24px] tracking-[-0.02em] text-[color:var(--wb-ink)]">
                  {s.value}
                </div>
                <div className="font-code text-[11.5px] uppercase tracking-[0.08em] text-[color:var(--wb-sub)]">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CodeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M5 4L1 8l4 4M11 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
