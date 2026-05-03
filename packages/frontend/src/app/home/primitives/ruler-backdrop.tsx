import { useId } from "react";
import { cn } from "@/lib/utils";

type RulerBackdropProps = {
  className?: string;
};

/**
 * Word-ruler motif: tick row, baselines, dashed margin guide.
 * Renders absolutely-positioned, behind content (z-0, pointer-events-none).
 * Uses CSS mask-image to fade out toward the bottom — no rectangular edge
 * artifact in dark mode, matches the handoff spec.
 */
export function RulerBackdrop({ className }: RulerBackdropProps) {
  const patternId = useId();
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-55 dark:opacity-30",
        className,
      )}
      style={{
        maskImage:
          "linear-gradient(to bottom, black 0%, black 35%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, black 0%, black 35%, transparent 100%)",
      }}
    >
      <svg width="100%" height="100%">
        <defs>
          <pattern
            id={patternId}
            x="0"
            y="0"
            width="48"
            height="120"
            patternUnits="userSpaceOnUse"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="8"
              stroke="var(--wb-syrup)"
              strokeOpacity="0.45"
              strokeWidth="1"
            />
            <line
              x1="12"
              y1="0"
              x2="12"
              y2="4"
              stroke="var(--wb-syrup)"
              strokeOpacity="0.3"
              strokeWidth="1"
            />
            <line
              x1="24"
              y1="0"
              x2="24"
              y2="6"
              stroke="var(--wb-syrup)"
              strokeOpacity="0.35"
              strokeWidth="1"
            />
            <line
              x1="36"
              y1="0"
              x2="36"
              y2="4"
              stroke="var(--wb-syrup)"
              strokeOpacity="0.3"
              strokeWidth="1"
            />
            <line
              x1="0"
              y1="40"
              x2="48"
              y2="40"
              stroke="var(--wb-syrup)"
              strokeOpacity="0.16"
              strokeWidth="1"
            />
            <line
              x1="0"
              y1="64"
              x2="48"
              y2="64"
              stroke="var(--wb-syrup)"
              strokeOpacity="0.16"
              strokeWidth="1"
            />
            <line
              x1="0"
              y1="88"
              x2="48"
              y2="88"
              stroke="var(--wb-syrup)"
              strokeOpacity="0.16"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        <line
          x1="80"
          y1="0"
          x2="80"
          y2="100%"
          stroke="var(--wb-berry)"
          strokeOpacity="0.18"
          strokeWidth="1"
          strokeDasharray="2 4"
        />
      </svg>
    </div>
  );
}
