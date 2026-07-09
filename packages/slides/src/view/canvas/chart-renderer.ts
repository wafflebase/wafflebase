import type { ChartElement } from '../../model/element';
import type { ColorRole, Theme } from '../../model/theme';
import { resolveColor } from '../../model/theme';

export const ACCENT_ROLES: readonly ColorRole[] = [
  'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
];

export function seriesColorAt(
  data: ChartElement['data'],
  i: number,
  theme: Theme,
): string {
  const explicit = data.series[i]?.color;
  if (explicit) return resolveColor(explicit, theme);
  return resolveColor(
    { kind: 'role', role: ACCENT_ROLES[i % ACCENT_ROLES.length] },
    theme,
  );
}

/** Round a value-axis max up to a "nice" 1/2/5×10ⁿ step. */
export function niceTicks(max: number, count = 5): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 1 };
  const rough = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = nice * mag;
  return { max: Math.ceil(max / step) * step, step };
}

const PAD = 8;

/**
 * Draw a chart element into element-local coordinates (top-left at
 * 0,0). Mirrors `drawTable` — the frame transform belongs to the
 * element-renderer; this function only knows about `(w, h)` and the
 * chart data.
 *
 * Phase 1 (this task) paints `column`/`bar` bars + a simple axis line.
 * `line`/`area`/`pie` are added in Task 6 in this same file.
 */
export function drawChart(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  data: ChartElement['data'],
  theme: Theme,
  opts?: { fontScale?: number },
): void {
  void opts;
  const axisColor = resolveColor({ kind: 'role', role: 'textSecondary' }, theme);
  const gridColor = resolveColor({ kind: 'role', role: 'backgroundAlt' }, theme);

  // Plot rectangle (leave room for value labels on the left, categories below).
  const left = 36;
  const bottom = 20;
  const plot = {
    x: left,
    y: PAD,
    w: Math.max(0, size.w - left - PAD),
    h: Math.max(0, size.h - PAD - bottom),
  };
  if (plot.w <= 0 || plot.h <= 0 || data.series.length === 0) return;

  if (data.kind === 'column' || data.kind === 'bar') {
    drawBars(ctx, plot, data, theme, { axisColor, gridColor });
    return;
  }
  // line/area/pie added in Task 6.
}

function seriesMax(data: ChartElement['data']): number {
  const stacked =
    data.grouping === 'stacked' || data.grouping === 'percentStacked';
  const n = data.categories.length || Math.max(...data.series.map((s) => s.values.length), 0);
  let max = 0;
  for (let c = 0; c < n; c++) {
    if (stacked) {
      let sum = 0;
      for (const s of data.series) sum += Math.max(0, s.values[c] ?? 0);
      max = Math.max(max, sum);
    } else {
      for (const s of data.series) max = Math.max(max, s.values[c] ?? 0);
    }
  }
  return max;
}

/**
 * Paint bars for `column` (vertical) charts. `bar` (horizontal) reuses
 * the same vertical layout as a known Phase-1 limitation — orientation
 * swap is deferred; only bar *count* and color cycling are correct for
 * `kind: 'bar'` today. Tracked in `docs/design/slides/slides-charts.md`.
 */
function drawBars(
  ctx: CanvasRenderingContext2D,
  plot: { x: number; y: number; w: number; h: number },
  data: ChartElement['data'],
  theme: Theme,
  colors: { axisColor: string; gridColor: string },
): void {
  const isPercent = data.grouping === 'percentStacked';
  const isStacked = data.grouping === 'stacked' || isPercent;
  const cats = data.categories.length
    ? data.categories.length
    : Math.max(...data.series.map((s) => s.values.length), 1);
  const domainMax = isPercent ? 1 : niceTicks(seriesMax(data)).max || 1;

  // Axis line.
  ctx.strokeStyle = colors.axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
  ctx.stroke();

  const slot = plot.w / cats;
  const groupPad = slot * 0.15;
  const yOf = (v: number) => plot.y + plot.h - (v / domainMax) * plot.h;

  for (let c = 0; c < cats; c++) {
    const x0 = plot.x + c * slot + groupPad;
    const groupW = slot - groupPad * 2;
    if (isStacked) {
      let acc = 0;
      const total = isPercent
        ? data.series.reduce((sum, s) => sum + Math.max(0, s.values[c] ?? 0), 0) || 1
        : 1;
      for (let s = 0; s < data.series.length; s++) {
        const raw = Math.max(0, data.series[s].values[c] ?? 0);
        const v = isPercent ? raw / total : raw;
        const yTop = yOf(acc + v);
        const yBot = yOf(acc);
        ctx.fillStyle = seriesColorAt(data, s, theme);
        ctx.fillRect(x0, yTop, groupW, yBot - yTop);
        acc += v;
      }
    } else {
      const barW = groupW / data.series.length;
      for (let s = 0; s < data.series.length; s++) {
        const v = Math.max(0, data.series[s].values[c] ?? 0);
        const yTop = yOf(v);
        ctx.fillStyle = seriesColorAt(data, s, theme);
        ctx.fillRect(x0 + s * barW, yTop, barW, plot.y + plot.h - yTop);
      }
    }
  }
  void colors.gridColor; // gridlines refined in Task 6
}
