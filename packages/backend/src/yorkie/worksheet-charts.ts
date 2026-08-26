import { BadRequestException } from '@nestjs/common';
import { parseRef } from '@wafflebase/sheets';
import type { SheetChart } from '@wafflebase/sheets';

const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'scatter'] as const;
const LEGEND_POSITIONS = ['top', 'bottom', 'right', 'left', 'none'] as const;

function reject(message: string): never {
  throw new BadRequestException(message);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    reject(`chart '${field}' must be a non-empty string`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject(`chart '${field}' must be a finite number`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') reject(`chart '${field}' must be a string`);
  return value;
}

function parseChart(raw: unknown, index: number): SheetChart {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    reject(`charts[${index}] must be an object`);
  }
  const c = raw as Record<string, unknown>;

  const type = c.type;
  if (!CHART_TYPES.includes(type as (typeof CHART_TYPES)[number])) {
    reject(`chart 'type' must be one of ${CHART_TYPES.join(', ')}`);
  }

  const anchor = requireString(c.anchor, 'anchor');
  try {
    parseRef(anchor); // throws a plain Error on a malformed A1 anchor
  } catch {
    reject(`chart 'anchor' must be a valid A1 reference; got "${anchor}"`);
  }

  const width = requireNumber(c.width, 'width');
  const height = requireNumber(c.height, 'height');
  if (width <= 0 || height <= 0) {
    reject("chart 'width' and 'height' must be positive");
  }

  let seriesColumns: string[] | undefined;
  if (c.seriesColumns !== undefined) {
    if (
      !Array.isArray(c.seriesColumns) ||
      c.seriesColumns.some((s) => typeof s !== 'string')
    ) {
      reject("chart 'seriesColumns' must be an array of strings");
    }
    seriesColumns = c.seriesColumns as string[];
  }

  let legendPosition: SheetChart['legendPosition'];
  if (c.legendPosition !== undefined) {
    if (
      !LEGEND_POSITIONS.includes(
        c.legendPosition as (typeof LEGEND_POSITIONS)[number],
      )
    ) {
      reject(
        `chart 'legendPosition' must be one of ${LEGEND_POSITIONS.join(', ')}`,
      );
    }
    legendPosition = c.legendPosition as SheetChart['legendPosition'];
  }

  if (c.showGridlines !== undefined && typeof c.showGridlines !== 'boolean') {
    reject("chart 'showGridlines' must be a boolean");
  }

  const chart: SheetChart = {
    id: requireString(c.id, 'id'),
    type: type as SheetChart['type'],
    sourceTabId: requireString(c.sourceTabId, 'sourceTabId'),
    sourceRange: requireString(c.sourceRange, 'sourceRange'),
    anchor,
    offsetX: requireNumber(c.offsetX, 'offsetX'),
    offsetY: requireNumber(c.offsetY, 'offsetY'),
    width,
    height,
  };

  const title = optionalString(c.title, 'title');
  if (title !== undefined) chart.title = title;
  const xAxisColumn = optionalString(c.xAxisColumn, 'xAxisColumn');
  if (xAxisColumn !== undefined) chart.xAxisColumn = xAxisColumn;
  const colorPalette = optionalString(c.colorPalette, 'colorPalette');
  if (colorPalette !== undefined) chart.colorPalette = colorPalette;
  if (seriesColumns !== undefined) chart.seriesColumns = seriesColumns;
  if (legendPosition !== undefined) chart.legendPosition = legendPosition;
  if (c.showGridlines !== undefined) {
    chart.showGridlines = c.showGridlines;
  }

  return chart;
}

/**
 * Validate a `{ charts: SheetChart[] }` body. The list replaces the whole chart
 * collection (keyed by each chart's `id`); omitting a chart deletes it. Each
 * chart is structurally validated and `id`s must be unique.
 */
export function parseCharts(body: unknown): SheetChart[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('body must be an object { charts: [...] }');
  }
  const charts = (body as Record<string, unknown>).charts;
  if (!Array.isArray(charts)) {
    throw new BadRequestException("'charts' must be an array");
  }
  const seen = new Set<string>();
  return charts.map((raw, i) => {
    const chart = parseChart(raw, i);
    if (seen.has(chart.id)) {
      throw new BadRequestException(`duplicate chart id "${chart.id}"`);
    }
    seen.add(chart.id);
    return chart;
  });
}
