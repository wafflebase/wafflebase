/**
 * Filename advertised by a `Content-Disposition` header, or `undefined` when
 * the header is absent or carries none.
 *
 * The backend always sends the RFC 5987 `filename*=UTF-8''…` form (see
 * `packages/backend/src/document/file-response.util.ts`), so that is the
 * preferred branch; the plain `filename="…"` form is read as a fallback for
 * proxies that rewrite the header.
 *
 * The result is a *suggestion* from the server and is never used as a path on
 * its own — `resolveDownloadTarget` strips any directory component before it
 * reaches the filesystem.
 */
export function parseContentDispositionFilename(
  header: string | null | undefined,
): string | undefined {
  if (!header) return undefined;

  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      const decoded = decodeURIComponent(extended[1].trim()).trim();
      if (decoded) return decoded;
    } catch {
      // Malformed percent-encoding: fall through to the plain form.
    }
  }

  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(header);
  const value = (plain?.[1] ?? plain?.[2])?.trim();
  return value || undefined;
}
