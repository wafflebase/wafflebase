import { Link } from "react-router-dom";
import { RulerBackdrop } from "./primitives/ruler-backdrop";
import { WbButton } from "./primitives/wb-button";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

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
          {/* Title */}
          <h1
            className="font-display font-semibold text-[color:var(--wb-ink)] leading-[1.04] tracking-[-0.025em] text-[clamp(40px,6vw,68px)] m-0 mb-6"
            style={{ fontFeatureSettings: "'ss01' on, 'ss02' on" }}
          >
            <span className="block">The office suite</span>
            <em className="block font-medium italic text-[color:var(--wb-syrup-deep)]">
              you can own
            </em>
          </h1>

          {/* Sub */}
          <p className="text-[color:var(--wb-sub)] leading-[1.55] text-[clamp(17px,1.4vw,19px)] max-w-[560px] m-0 mb-10 text-pretty">
            Sheets, Docs, Slides, Notes and Boards, edited together in real
            time. Run it on your own servers and script it with the REST API
            and CLI.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap gap-3 justify-center">
            <WbButton asChild variant="primary" size="lg">
              <Link to={workspacePath ?? "/login"}>
                {workspacePath ? "Go to workspace →" : "Start a workspace →"}
              </Link>
            </WbButton>
            <WbButton asChild variant="ghost" size="lg">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <CodeIcon /> View on GitHub →
              </a>
            </WbButton>
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
