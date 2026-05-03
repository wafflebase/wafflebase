type GlyphKind = "reactive" | "formulas" | "embed" | "sync" | "io";

type PocketProps = {
  x: number;
  y: number;
  size?: number;
  fill?: string;
  op?: number;
};

function Pocket({
  x,
  y,
  size = 8,
  fill = "var(--wb-syrup)",
  op = 1,
}: PocketProps) {
  return (
    <g opacity={op}>
      <rect x={x} y={y} width={size} height={size} rx="1.5" fill={fill} />
      <rect
        x={x + 1}
        y={y + 1}
        width={size - 2}
        height="1.5"
        rx="0.5"
        fill="white"
        opacity="0.3"
      />
    </g>
  );
}

const COMMON = {
  width: 44,
  height: 44,
  viewBox: "0 0 44 44",
  fill: "none" as const,
};

export function FeatureGlyph({ kind }: { kind: GlyphKind }) {
  if (kind === "reactive") {
    return (
      <svg {...COMMON} aria-hidden="true">
        <rect
          x="3"
          y="3"
          width="14"
          height="14"
          rx="2"
          fill="var(--wb-butter)"
          stroke="var(--wb-syrup-deep)"
          strokeWidth="1.2"
        />
        <Pocket x={6} y={6} size={3.5} />
        <Pocket x={10.5} y={6} size={3.5} />
        <Pocket x={6} y={10.5} size={3.5} />
        <Pocket x={10.5} y={10.5} size={3.5} />
        <rect
          x="27"
          y="3"
          width="14"
          height="14"
          rx="2"
          fill="none"
          stroke="var(--wb-syrup-deep)"
          strokeWidth="1.2"
        />
        <rect
          x="15"
          y="27"
          width="14"
          height="14"
          rx="2"
          fill="none"
          stroke="var(--wb-syrup-deep)"
          strokeWidth="1.2"
        />
        <path
          d="M17 10h10M22 17v10"
          stroke="var(--wb-syrup)"
          strokeWidth="1.4"
          strokeDasharray="2 2"
        />
      </svg>
    );
  }
  if (kind === "formulas") {
    return (
      <svg {...COMMON} aria-hidden="true">
        <rect
          x="3"
          y="6"
          width="38"
          height="28"
          rx="3"
          fill="var(--wb-butter)"
          opacity="0.4"
          stroke="var(--wb-syrup-deep)"
          strokeWidth="1.2"
        />
        <text
          x="9"
          y="26"
          fontFamily="var(--font-code)"
          fontSize="14"
          fontStyle="italic"
          fontWeight="600"
          fill="var(--wb-syrup-deep)"
        >
          ƒx
        </text>
        <text
          x="22"
          y="26"
          fontFamily="var(--font-code)"
          fontSize="11"
          fill="var(--wb-ink)"
        >
          SUM(
        </text>
        <rect
          x="3"
          y="36"
          width="38"
          height="3"
          rx="1.5"
          fill="var(--wb-syrup)"
          opacity="0.6"
        />
      </svg>
    );
  }
  if (kind === "embed") {
    return (
      <svg {...COMMON} aria-hidden="true">
        <rect
          x="3"
          y="6"
          width="38"
          height="32"
          rx="3"
          stroke="var(--wb-syrup-deep)"
          strokeWidth="1.2"
          fill="var(--wb-paper)"
        />
        <rect
          x="3"
          y="6"
          width="38"
          height="6"
          rx="3"
          fill="var(--wb-syrup-deep)"
          opacity="0.15"
        />
        <circle cx="7" cy="9" r="0.8" fill="var(--wb-syrup-deep)" />
        <circle cx="10" cy="9" r="0.8" fill="var(--wb-syrup-deep)" />
        <Pocket x={9} y={16} size={4} />
        <Pocket x={14} y={16} size={4} />
        <Pocket x={9} y={21} size={4} />
        <Pocket x={14} y={21} size={4} />
        <path
          d="M24 18h13M24 23h13M24 28h9"
          stroke="var(--wb-syrup)"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>
    );
  }
  if (kind === "sync") {
    return (
      <svg {...COMMON} aria-hidden="true">
        <circle
          cx="14"
          cy="22"
          r="7"
          fill="var(--wb-butter)"
          stroke="var(--wb-syrup-deep)"
          strokeWidth="1.2"
        />
        <Pocket x={11} y={19} size={2.5} op={0.8} />
        <Pocket x={14.5} y={19} size={2.5} op={0.8} />
        <Pocket x={11} y={22.5} size={2.5} op={0.8} />
        <Pocket x={14.5} y={22.5} size={2.5} op={0.8} />
        <circle
          cx="30"
          cy="22"
          r="7"
          fill="none"
          stroke="var(--wb-syrup-deep)"
          strokeWidth="1.2"
          strokeDasharray="3 2"
        />
        <path
          d="M21 22h2M27 22h-2"
          stroke="var(--wb-syrup)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === "io") {
    return (
      <svg {...COMMON} aria-hidden="true">
        <rect
          x="3"
          y="10"
          width="14"
          height="24"
          rx="2"
          fill="var(--wb-butter)"
          stroke="var(--wb-syrup-deep)"
          strokeWidth="1.2"
        />
        <Pocket x={5.5} y={13} size={3.5} />
        <Pocket x={10} y={13} size={3.5} />
        <Pocket x={5.5} y={17.5} size={3.5} />
        <Pocket x={10} y={17.5} size={3.5} />
        <rect
          x="27"
          y="10"
          width="14"
          height="24"
          rx="2"
          fill="none"
          stroke="var(--wb-syrup-deep)"
          strokeWidth="1.2"
        />
        <text
          x="34"
          y="25"
          textAnchor="middle"
          fontFamily="var(--font-code)"
          fontSize="6"
          fill="var(--wb-sub)"
        >
          .xlsx
        </text>
        <path
          d="M19 22h6m0 0l-2-2m2 2l-2 2"
          stroke="var(--wb-syrup)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return null;
}
