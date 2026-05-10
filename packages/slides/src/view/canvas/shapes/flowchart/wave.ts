/**
 * Append a one-period sine-wave polyline to `path`, traveling from
 * (startX, baseY) to (endX, baseY). The starting point is NOT
 * emitted (`moveTo` / `lineTo` is the caller's responsibility);
 * subsequent points are added via `lineTo`.
 *
 * The wave passes through baseY at both endpoints and at the
 * midpoint, peaks `+amplitude` at the quarter point, and dips
 * `-amplitude` at the three-quarter point. Pass a negative
 * `amplitude` to invert the wave direction.
 *
 * @param path         target Path2D (must already contain the start point)
 * @param startX, endX horizontal span; can be reversed (endX < startX) to draw right-to-left
 * @param baseY        wave centreline
 * @param amplitude    peak displacement (positive = first peak below baseY)
 * @param segments     polyline subdivision count (default 32 — sufficient for visual smoothness)
 */
export function appendSineWave(
  path: Path2D,
  startX: number,
  endX: number,
  baseY: number,
  amplitude: number,
  segments: number = 32,
): void {
  const span = endX - startX;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = startX + span * t;
    const y = baseY + amplitude * Math.sin(2 * Math.PI * t);
    path.lineTo(x, y);
  }
}
