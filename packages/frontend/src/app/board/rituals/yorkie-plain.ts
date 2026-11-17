/**
 * A Yorkie proxy (or plain value) as plain JSON. Yorkie's object and
 * array proxies serialise themselves through `toJSON()` (a JSON string),
 * which is also what keeps live proxies from leaking out of the CRDT.
 */
export function yorkieJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  const maybe = value as { toJSON?: () => unknown };
  if (typeof maybe.toJSON === "function") {
    const out = maybe.toJSON();
    return typeof out === "string" ? out : JSON.stringify(out);
  }
  return JSON.stringify(value);
}

export function yorkiePlain<T>(value: unknown): T | undefined {
  const json = yorkieJson(value);
  return json ? (JSON.parse(json) as T) : undefined;
}
