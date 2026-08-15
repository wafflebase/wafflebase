/**
 * The extension to store in a blob's S3 key, taken from the client-supplied
 * filename. That filename is untrusted input flowing into an object key, so
 * this sanitizes rather than validates: anything that is not a short
 * alphanumeric run is dropped and the blob is stored without an extension.
 * The uuid prefix means the key is never attacker-chosen either way.
 */
export function safeExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : null;
}
