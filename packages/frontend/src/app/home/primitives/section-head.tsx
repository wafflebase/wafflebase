import { cn } from "@/lib/utils";

type SectionHeadProps = {
  kicker: string;
  title: string;
  sub?: string;
  align?: "center" | "left";
  className?: string;
};

export function SectionHead({
  kicker,
  title,
  sub,
  align = "center",
  className,
}: SectionHeadProps) {
  const isLeft = align === "left";
  return (
    <div
      className={cn(
        "mb-12 md:mb-16",
        isLeft
          ? "max-w-none text-left"
          : "max-w-[820px] mx-auto text-center",
        className,
      )}
    >
      <div className="inline-flex items-center gap-2 mb-3 font-code text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--wb-syrup-deep)]">
        <span className="size-1.5 rounded-full bg-[color:var(--wb-syrup)]" />
        {kicker}
      </div>
      <h2
        className="font-display font-semibold text-[color:var(--wb-ink)] text-[clamp(28px,3.5vw,40px)] leading-[1.1] tracking-[-0.01em] m-0"
        style={{ fontFeatureSettings: "'ss01' on, 'ss02' on" }}
      >
        {title}
      </h2>
      {sub && (
        <p
          className={cn(
            "text-[clamp(15px,1.2vw,17px)] leading-[1.55] text-[color:var(--wb-sub)] max-w-[640px] mt-4 m-0",
            isLeft ? "mx-0" : "mx-auto",
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
