import { isSafeUrl } from '@wafflebase/core/url';

/**
 * Detects whether a cell's plain value is a standalone hyperlink and returns
 * the normalized URL, or `null` when it is not a link.
 *
 * A cell is treated as a link only when its trimmed value is a single
 * `http(s)://` token with no interior whitespace and a safe protocol. This
 * mirrors the whole-token URL detection used in the Docs editor while staying
 * render-time only — nothing about the cell is persisted, so the Store model
 * is untouched. Callers must exclude formula cells (whose `v` is a computed
 * result, e.g. a HYPERLINK() label) themselves.
 */
export function cellHyperlink(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  return isSafeUrl(trimmed) ? trimmed : null;
}
