type WaffleLogoProps = {
  size?: number;
  className?: string;
};

export function WaffleLogo({ size = 28, className }: WaffleLogoProps) {
  const cellSize = 6;
  const gap = 1;
  const start = 4;
  const cells = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = start + c * (cellSize + gap);
      const y = start + r * (cellSize + gap);
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={x}
          y={y}
          width={cellSize}
          height={cellSize}
          rx="1.2"
          fill="var(--wb-syrup)"
        />,
      );
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="1"
        y="1"
        width="26"
        height="26"
        rx="6"
        fill="var(--wb-butter)"
        stroke="var(--wb-syrup-deep)"
        strokeWidth="1.5"
      />
      <rect
        x="2.5"
        y="2.5"
        width="23"
        height="23"
        rx="5"
        fill="none"
        stroke="var(--wb-syrup)"
        strokeOpacity="0.25"
        strokeWidth="0.8"
      />
      {cells}
    </svg>
  );
}
