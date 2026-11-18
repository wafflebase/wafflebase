import type { Element, Frame } from "@wafflebase/slides";
import {
  sectionColorOf,
  sectionMemberIds,
  sectionOf,
  type SectionMeta,
} from "@wafflebase/board";

/**
 * Painting a board section's chrome: the title pill and, for a hidden
 * section, the cover over its contents. Runs in the editor's
 * `paintAfterElements` pass, with the world transform applied, so every
 * length here is a world length derived from a SCREEN length divided by
 * the zoom — the title reads at the same size at every zoom, as it does in
 * FigJam, instead of vanishing at 10% and filling the screen at 800%.
 */

/** Title font size, in screen px. */
export const TITLE_FONT_PX = 12;
/** Pill height, in screen px. */
export const TITLE_HEIGHT_PX = 22;
/** Horizontal padding inside the pill, in screen px. */
export const TITLE_PAD_PX = 8;
/** Gap between the section's corner and the pill, in screen px. */
export const TITLE_INSET_PX = 8;
/** Below this much room for text (screen px) the title is not drawn. */
export const MIN_TITLE_TEXT_PX = 16;

const TITLE_FONT_FAMILY = "Inter, system-ui, sans-serif";

/** What a pill says: the title plus the section's state. */
export function titleLabel(meta: SectionMeta): string {
  const title = meta.title.trim() || "Untitled section";
  const state = [meta.locked ? "Locked" : "", meta.hidden ? "Hidden" : ""]
    .filter(Boolean)
    .join(", ");
  return state ? `${title} · ${state}` : title;
}

/**
 * Shorten `text` with an ellipsis until `measure` says it fits `maxWidth`.
 * `measure` and `maxWidth` share a unit (world px here). Returns `""` when
 * not even the ellipsis fits.
 */
export function truncateToWidth(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (measure(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid)}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? (measure("…") <= maxWidth ? "…" : "") : `${text.slice(0, lo)}…`;
}

/**
 * The title pill's world rect for a section at `zoom`: inside the
 * section's top-left corner, as wide as the label (capped to the
 * section). `null` when the section is too small on screen to carry one.
 * Shared by the painter and the rename input, so the input opens exactly
 * over the pill the user double-clicked.
 */
export function titleRect(
  frame: Frame,
  zoom: number,
  labelWidthPx: number,
): { x: number; y: number; w: number; h: number } | null {
  const z = zoom > 0 ? zoom : 1;
  const inset = TITLE_INSET_PX / z;
  const pad = TITLE_PAD_PX / z;
  const h = TITLE_HEIGHT_PX / z;
  const maxW = frame.w - inset * 2;
  if (maxW - pad * 2 < MIN_TITLE_TEXT_PX / z || frame.h < h + inset * 2) return null;
  const w = Math.min(maxW, labelWidthPx / z + pad * 2);
  return { x: frame.x + inset, y: frame.y + inset, w, h };
}

function titleFont(zoom: number): string {
  return `600 ${TITLE_FONT_PX / zoom}px ${TITLE_FONT_FAMILY}`;
}

/** Paint the cover of a hidden section: opaque, with a centred notice. */
function paintCover(
  ctx: CanvasRenderingContext2D,
  section: Element,
  memberCount: number,
  zoom: number,
): void {
  const { x, y, w, h } = section.frame;
  const color = sectionColorOf(section);
  ctx.fillStyle = color.fill;
  ctx.fillRect(x, y, w, h);
  // Diagonal hatching says "covered" without words at any zoom.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color.stroke;
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = 2 / zoom;
  const step = 16 / zoom;
  ctx.beginPath();
  for (let d = -h; d < w; d += step) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = color.stroke;
  ctx.lineWidth = 2 / zoom;
  ctx.strokeRect(x, y, w, h);
  const notice = memberCount === 1 ? "1 hidden item" : `${memberCount} hidden items`;
  ctx.font = `500 ${13 / zoom}px ${TITLE_FONT_FAMILY}`;
  ctx.fillStyle = color.stroke;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fitted = truncateToWidth(notice, w - 16 / zoom, (s) => ctx.measureText(s).width);
  if (fitted) ctx.fillText(fitted, x + w / 2, y + h / 2);
}

/** Paint one section's title pill. */
function paintTitle(
  ctx: CanvasRenderingContext2D,
  section: Element,
  meta: SectionMeta,
  zoom: number,
): void {
  ctx.font = titleFont(zoom);
  const measure = (s: string) => ctx.measureText(s).width;
  const label = titleLabel(meta);
  const rect = titleRect(section.frame, zoom, measure(label) * zoom);
  if (!rect) return;
  const pad = TITLE_PAD_PX / zoom;
  const text = truncateToWidth(label, rect.w - pad * 2, measure);
  if (!text) return;
  const color = sectionColorOf(section);
  const r = 4 / zoom;
  ctx.fillStyle = color.stroke;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, r);
  } else {
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, rect.x + pad, rect.y + rect.h / 2);
}

/**
 * The board's `paintAfterElements` pass: covers for hidden sections, then
 * every visible section's title. A section inside a hidden one is covered
 * with the rest of its contents, title included.
 *
 * `titles: false` is the minimap's mode — it must cover hidden contents
 * too (it is a picture of the board anyone can read), but a 12px title on
 * a 200px panel would be noise.
 */
export function paintSections(
  ctx: CanvasRenderingContext2D,
  elements: readonly Element[],
  zoom: number,
  opts: { titles?: boolean } = {},
): void {
  const z = zoom > 0 ? zoom : 1;
  const sections = elements.filter((el) => sectionOf(el) !== undefined);
  if (sections.length === 0) return;
  const covered = new Set<string>();
  for (const section of sections) {
    if (!sectionOf(section)?.hidden || covered.has(section.id)) continue;
    const members = sectionMemberIds(elements, section);
    for (const id of members) covered.add(id);
    paintCover(ctx, section, members.length, z);
  }
  if (opts.titles === false) return;
  for (const section of sections) {
    if (covered.has(section.id)) continue;
    paintTitle(ctx, section, sectionOf(section)!, z);
  }
}
