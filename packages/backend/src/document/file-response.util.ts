/** The only stored content types ever echoed back to a browser. */
const INLINE_IMAGE_MIME = /^image\/(png|jpeg|gif|webp)$/;

const OCTET_STREAM = 'application/octet-stream';

/**
 * Response headers for a document's stored blob, derived from the document
 * `type` — never echoed blindly from storage.
 *
 * Hosting arbitrary user bytes has one serious failure mode: content the
 * browser treats as active, rendered in the backend origin with the session
 * cookie in scope. `nosniff` does not help against an explicit `text/html`,
 * and an upload-time extension blacklist is defeated by renaming. So the
 * decision is made here, from server-held state: a `file` document is always
 * an opaque attachment, and the viewer types are pinned to what their viewer
 * can actually render.
 */
export function fileResponseHeaders(
  type: string,
  storedContentType: string,
  title: string,
): { contentType: string; disposition: string } {
  if (type === 'pdf') {
    return { contentType: 'application/pdf', disposition: 'inline' };
  }
  if (type === 'image' && INLINE_IMAGE_MIME.test(storedContentType)) {
    return { contentType: storedContentType, disposition: 'inline' };
  }
  return {
    contentType: OCTET_STREAM,
    disposition: `attachment; filename*=UTF-8''${encodeRfc5987(title)}`,
  };
}

/**
 * RFC 5987 `filename*` encoding. CR/LF are stripped before encoding as
 * defense in depth — `encodeURIComponent` would percent-encode them anyway,
 * but header safety should not rest on that detail.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value.replace(/[\r\n]/g, ' ')).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}
