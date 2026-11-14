type WaffleLogoProps = {
  size?: number;
  className?: string;
};

// The mark is "Facet": a waffle's 3×3 grid of pockets turned 45°, drawn in
// one color. It reads `--wb-syrup`, which steps up to bright syrup in dark
// mode — a one-color mark keeps its shape and only lifts its value, so the
// theme flip is safe here. `public/icon.svg` and the docs-site
// `public/logo.svg` draw the same geometry; keep the three in step.
const POCKET = 5.6;
const GAP = 1.4;

export function WaffleLogo({ size = 28, className }: WaffleLogoProps) {
  const pockets = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      // Step along the two diagonals from the centre (16, 16).
      const u = (i - 1) * (POCKET + GAP);
      const v = (j - 1) * (POCKET + GAP);
      const cx = 16 + (u - v) / Math.SQRT2;
      const cy = 16 + (u + v) / Math.SQRT2;
      pockets.push(
        <rect
          key={`${i}-${j}`}
          x={cx - POCKET / 2}
          y={cy - POCKET / 2}
          width={POCKET}
          height={POCKET}
          rx="1"
          transform={`rotate(45 ${cx} ${cy})`}
        />,
      );
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="var(--wb-syrup)"
      aria-hidden="true"
      className={className}
    >
      {pockets}
    </svg>
  );
}
