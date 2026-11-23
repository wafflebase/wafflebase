/**
 * QR encoding and export, entirely in the browser.
 *
 * `uqr` is a zero-dependency encoder, so a share token is never handed to a
 * QR image service. The modules are always painted `#000` on `#fff`
 * regardless of the app theme — a scanner needs dark-on-light with a quiet
 * zone, and a QR that followed `currentColor` would be unreadable in dark
 * mode.
 *
 * The React side lives in `@/components/qr-code`.
 */

import { encode } from "uqr";

/** Quiet-zone width, in modules. Four is what the QR spec asks for. */
const QUIET_ZONE = 4;

/** Edge of the exported image, in device pixels. Big enough to print. */
export const QR_EXPORT_SIZE = 1024;

export type QrMatrix = {
  /** Module count per side, quiet zone included. */
  size: number;
  /** `true` where the module is dark. Row-major, quiet zone included. */
  rows: boolean[][];
};

/**
 * Encodes `value` into a module matrix.
 *
 * Error correction `M` rather than `uqr`'s default `L`: these codes get
 * photographed off a screen or a printout at an angle, and the extra
 * redundancy costs a slightly denser grid and nothing else.
 */
export function encodeQr(value: string): QrMatrix {
  const result = encode(value, { ecc: "M", border: QUIET_ZONE });
  return { size: result.size, rows: result.data };
}

/**
 * The dark modules as a single SVG path, one `M…h1v1h-1z` per module.
 * One path keeps the DOM small on a version-10 code (nearly 3,000 modules)
 * and makes the SVG export a single element too.
 */
export function qrModulesPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y++) {
    const row = matrix.rows[y];
    for (let x = 0; x < matrix.size; x++) {
      if (row[x]) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join("");
}

/**
 * A standalone SVG document for `value` — what "Download SVG" writes.
 * The viewBox is the module grid, so the file scales to any print size.
 */
export function qrCodeSvgDocument(value: string): string {
  const matrix = encodeQr(value);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${matrix.size} ${matrix.size}"`,
    ` width="${QR_EXPORT_SIZE}" height="${QR_EXPORT_SIZE}" shape-rendering="crispEdges">`,
    `<rect width="${matrix.size}" height="${matrix.size}" fill="#fff"/>`,
    `<path fill="#000" d="${qrModulesPath(matrix)}"/>`,
    `</svg>`,
  ].join("");
}

/**
 * Paints `value` onto a canvas and returns it as a PNG blob.
 *
 * Drawn from the same matrix the SVG uses, so the two exports cannot
 * disagree about what was encoded. Resolves `null` when the environment has
 * no usable canvas (jsdom, a browser that refuses `toBlob`) — the caller
 * reports that rather than throwing.
 */
export async function qrCodePngBlob(value: string): Promise<Blob | null> {
  const matrix = encodeQr(value);
  const canvas = document.createElement("canvas");
  canvas.width = QR_EXPORT_SIZE;
  canvas.height = QR_EXPORT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof canvas.toBlob !== "function") return null;

  // Integer module size keeps every module the same width; the remainder is
  // split into the quiet zone, which is white anyway.
  const scale = Math.floor(QR_EXPORT_SIZE / matrix.size);
  const offset = Math.floor((QR_EXPORT_SIZE - scale * matrix.size) / 2);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, QR_EXPORT_SIZE, QR_EXPORT_SIZE);
  ctx.fillStyle = "#000";
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.rows[y][x]) {
        ctx.fillRect(offset + x * scale, offset + y * scale, scale, scale);
      }
    }
  }
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob)));
}

/** Saves `blob` under `fileName` through a throwaway object URL. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
