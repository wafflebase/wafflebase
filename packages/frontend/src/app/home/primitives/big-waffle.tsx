import { useId } from "react";

type BigWaffleProps = {
  className?: string;
};

export function BigWaffle({ className }: BigWaffleProps) {
  const baseId = useId();
  const bodyId = `${baseId}-body`;
  const shadeId = `${baseId}-shade`;
  const butterId = `${baseId}-butter`;
  const shadowId = `${baseId}-shadow`;

  const cell = 44;
  const gap = 6;
  const offset = 22;
  const pockets = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = offset + c * (cell + gap);
      const y = offset + r * (cell + gap);
      pockets.push(
        <g key={`${r}-${c}`}>
          <rect
            x={x}
            y={y}
            width={cell}
            height={cell}
            rx="6"
            fill="var(--wb-syrup)"
          />
          <rect
            x={x + 1}
            y={y + 1}
            width={cell - 2}
            height={cell - 2}
            rx="5"
            fill={`url(#${shadeId})`}
            opacity="0.35"
          />
          <rect
            x={x + 2}
            y={y + 2}
            width={cell - 4}
            height={4}
            rx="2"
            fill="white"
            opacity="0.18"
          />
        </g>,
      );
    }
  }
  return (
    <svg
      viewBox="0 0 240 240"
      width="100%"
      height="100%"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={bodyId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--wb-butter)" />
          <stop offset="100%" stopColor="var(--wb-syrup)" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id={shadeId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--wb-syrup-deep)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--wb-syrup-deep)" stopOpacity="1" />
        </linearGradient>
        <linearGradient id={butterId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF8DC" />
          <stop offset="100%" stopColor="#F4D67A" />
        </linearGradient>
        <filter
          id={shadowId}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <ellipse
        cx="120"
        cy="226"
        rx="100"
        ry="6"
        fill="var(--wb-syrup-deep)"
        opacity="0.18"
      />
      <rect
        x="8"
        y="8"
        width="224"
        height="224"
        rx="28"
        fill={`url(#${bodyId})`}
        stroke="var(--wb-syrup-deep)"
        strokeWidth="2"
      />
      <rect
        x="14"
        y="14"
        width="212"
        height="212"
        rx="22"
        fill="none"
        stroke="var(--wb-syrup)"
        strokeWidth="1.2"
        opacity="0.5"
      />
      {pockets}
      <g transform="rotate(-8 120 108)">
        <rect
          x="78"
          y="78"
          width="84"
          height="56"
          rx="5"
          fill="var(--wb-syrup-deep)"
          opacity="0.22"
          filter={`url(#${shadowId})`}
        />
        <rect
          x="76"
          y="76"
          width="84"
          height="56"
          rx="5"
          fill={`url(#${butterId})`}
          stroke="var(--wb-syrup-deep)"
          strokeWidth="1.4"
        />
        <path
          d="M86 88 L150 88 M86 96 L142 96"
          stroke="#E8B852"
          strokeWidth="0.8"
          opacity="0.6"
        />
        <rect
          x="80"
          y="80"
          width="76"
          height="6"
          rx="2"
          fill="white"
          opacity="0.45"
        />
      </g>
      <path
        d="M196 12 Q198 30 188 48 Q176 68 184 92 Q192 110 178 130"
        stroke="var(--wb-syrup-deep)"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="178" cy="138" r="3.5" fill="var(--wb-syrup-deep)" opacity="0.7" />
      <circle cx="100" cy="200" r="2.5" fill="var(--wb-syrup-deep)" opacity="0.55" />
      <circle cx="60" cy="180" r="2" fill="var(--wb-syrup-deep)" opacity="0.45" />
    </svg>
  );
}
