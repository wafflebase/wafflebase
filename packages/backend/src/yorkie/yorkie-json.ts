/**
 * Yorkie object proxies serialise via a `toJSON()` method that returns a
 * JSON *string* (not a plain object). Spread / JSON.stringify therefore
 * double-encode. This helper detects the proxy shape and parses back to
 * a plain JS value; plain inputs (or `undefined`) pass through.
 */
export function unwrapJson<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  if (typeof value === 'object') {
    const maybeJson = (value as { toJSON?: () => string }).toJSON;
    if (typeof maybeJson === 'function') {
      const str = maybeJson.call(value);
      if (typeof str === 'string') {
        return JSON.parse(str) as T;
      }
    }
  }
  return value as T;
}
