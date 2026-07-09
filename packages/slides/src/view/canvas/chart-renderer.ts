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
 * Phase 1 paints `column`/`bar` bars, `line`/`area` polylines, and
 * `pie` slices, plus an optional value-axis gridline pass, legend,
 * and title.
 */
export function drawChart(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  data: ChartElement['data'],
  theme: Theme,
  opts?: { fontScale?: number },
): void {
  const axisColor = resolveColor({ kind: 'role', role: 'textSecondary' }, theme);
  const gridColor = resolveColor({ kind: 'role', role: 'backgroundAlt' }, theme);

  const showLegend =
    data.legend !== undefined
      ? data.legend !== 'none'
      : data.series.length > 1;
  const showTitle = Boolean(data.title);

  // Plot rectangle (leave room for value labels on the left, categories
  // below, a title band on top, and a legend band on the bottom).
  const left = 36;
  const top = PAD + (showTitle ? 18 : 0);
  const bottom = 20 + (showLegend ? 20 : 0);
  const plot = {
    x: left,
    y: top,
    w: Math.max(0, size.w - left - PAD),
    h: Math.max(0, size.h - top - bottom),
  };
  if (plot.w <= 0 || plot.h <= 0 || data.series.length === 0) return;

  if (data.kind === 'column' || data.kind === 'bar') {
    drawBars(ctx, plot, data, theme, { axisColor, gridColor });
  } else if (data.kind === 'line' || data.kind === 'area') {
    drawLines(ctx, plot, data, theme, { axisColor, gridColor });
  } else if (data.kind === 'pie') {
    drawPie(ctx, plot, data, theme);
  }

  if (showTitle && data.title) drawTitle(ctx, size, data.title, theme, opts?.fontScale);
  if (showLegend) drawLegend(ctx, size, data, theme);
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

  if (data.showGridlines) drawGridlines(ctx, plot, domainMax, colors.gridColor);

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
}

type PlotRect = { x: number; y: number; w: number; h: number };

/** Draw horizontal value-axis gridlines at each `niceTicks` step. */
function drawGridlines(
  ctx: CanvasRenderingContext2D,
  plot: PlotRect,
  domainMax: number,
  color: string,
): void {
  const { step } = niceTicks(domainMax);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let v = step; v <= domainMax + 1e-9; v += step) {
    const y = plot.y + plot.h - (v / domainMax) * plot.h;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
  }
}

/**
 * Paint `line`/`area` charts: one polyline per series. `area` additionally
 * fills the region under the line (translucent) before stroking it.
 */
function drawLines(
  ctx: CanvasRenderingContext2D,
  plot: PlotRect,
  data: ChartElement['data'],
  theme: Theme,
  colors: { axisColor: string; gridColor: string },
): void {
  const cats = data.categories.length
    ? data.categories.length
    : Math.max(...data.series.map((s) => s.values.length), 1);
  const domainMax = niceTicks(seriesMax({ ...data, grouping: undefined })).max || 1;
  if (data.showGridlines) drawGridlines(ctx, plot, domainMax, colors.gridColor);

  // Axis line.
  ctx.strokeStyle = colors.axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
  ctx.stroke();

  const xOf = (c: number) =>
    plot.x + (cats <= 1 ? plot.w / 2 : (c / (cats - 1)) * plot.w);
  const yOf = (v: number) => plot.y + plot.h - (v / domainMax) * plot.h;

  for (let s = 0; s < data.series.length; s++) {
    const col = seriesColorAt(data, s, theme);
    const vals = data.series[s].values;

    if (data.kind === 'area') {
      ctx.beginPath();
      for (let c = 0; c < cats; c++) {
        const x = xOf(c);
        const y = yOf(Math.max(0, vals[c] ?? 0));
        if (c === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(xOf(cats - 1), plot.y + plot.h);
      ctx.lineTo(xOf(0), plot.y + plot.h);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    for (let c = 0; c < cats; c++) {
      const x = xOf(c);
      const y = yOf(Math.max(0, vals[c] ?? 0));
      if (c === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** Paint a `pie` chart from the first series only, skipping axis/gridlines. */
function drawPie(
  ctx: CanvasRenderingContext2D,
  plot: PlotRect,
  data: ChartElement['data'],
  theme: Theme,
): void {
  const vals = (data.series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const r = Math.min(plot.w, plot.h) / 2;
  let a0 = -Math.PI / 2;
  for (let i = 0; i < vals.length; i++) {
    const a1 = a0 + (vals[i] / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = seriesColorAt(data, i, theme);
    ctx.fill();
    a0 = a1;
  }
}

/** Draw a centered chart title in the reserved top band. */
function drawTitle(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  title: string,
  theme: Theme,
  fontScale?: number,
): void {
  ctx.fillStyle = resolveColor({ kind: 'role', role: 'text' }, theme);
  ctx.font = `${14 * (fontScale ?? 1)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(title, size.w / 2, 2);
}

/**
 * Draw a left-aligned swatch + label legend in the reserved bottom band.
 *
 * Swatches are small filled circles (`arc` + `fill`) rather than
 * `fillRect` — `fillRect` is the same primitive `drawBars` uses to
 * paint bars, and the column-chart test asserts an exact `fillRect`
 * call count for "one rect per bar". Using a different primitive here
 * keeps that invariant (bars are the only thing that call `fillRect`)
 * even now that a 2-series chart draws a legend by default.
 */
function drawLegend(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  data: ChartElement['data'],
  theme: Theme,
): void {
  const items = data.series.map((s, i) => ({ label: s.name ?? `Series ${i + 1}`, i }));
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let x = 40;
  const y = size.h - 8;
  const r = 5;
  for (const it of items) {
    ctx.fillStyle = seriesColorAt(data, it.i, theme);
    ctx.beginPath();
    ctx.arc(x + r, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = resolveColor({ kind: 'role', role: 'text' }, theme);
    ctx.fillText(it.label, x + 2 * r + 4, y);
    x += 2 * r + 4 + ctx.measureText(it.label).width + 16;
  }
}
