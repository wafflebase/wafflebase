/**
 * Yorkie object proxies serialise via a `toJSON()` method that returns a
 * JSON *string* (not a plain object). Spread / JSON.stringify therefore
 * double-encode. This helper detects the proxy shape and parses back to
 * a plain JS value; plain inputs (or `undefined`) pass through.
 *
 * Parsing goes through {@link parseJsonSnapshot}, not bare `JSON.parse`: the
 * same raw-JSON path this unwraps leaves control characters *inside* string
 * values unescaped, so a value holding a multi-line string (a spreadsheet cell
 * with a newline in it) would otherwise throw a `SyntaxError` and surface as a
 * 500. {@link detachYorkieValue} is the last resort for anything the repaired
 * parse still cannot read.
 */
export function unwrapJson<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  if (typeof value === 'object') {
    const maybeJson = (value as { toJSON?: () => string }).toJSON;
    if (typeof maybeJson === 'function') {
      const str = maybeJson.call(value);
      if (typeof str === 'string') {
        try {
          return parseJsonSnapshot(str) as T;
        } catch {
          return detachYorkieValue(value) as T;
        }
      }
    }
  }
  return value as T;
}

/** A Yorkie root made of plain JSON. */
export type JsonRoot = Record<string, unknown>;

/**
 * Escape the control characters Yorkie's raw JSON string path leaves
 * unescaped, so the result is parseable JSON.
 *
 * Only characters *inside* string literals are rewritten — the scanner tracks
 * quoting and backslash escaping so a `\n` already written as an escape pair
 * is left alone rather than double-escaped.
 */
function escapeControlCharsInJson(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;

  for (const char of input) {
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }

    const code = char.charCodeAt(0);
    if (code < 0x20) {
      switch (char) {
        case '\b':
          output += '\\b';
          break;
        case '\f':
          output += '\\f';
          break;
        case '\n':
          output += '\\n';
          break;
        case '\r':
          output += '\\r';
          break;
        case '\t':
          output += '\\t';
          break;
        default:
          output += `\\u${code.toString(16).padStart(4, '0')}`;
          break;
      }
      continue;
    }

    output += char;
  }

  return output;
}

/**
 * `JSON.parse` for a Yorkie snapshot string, repairing the one malformation
 * the CRDT's raw JSON path is known to emit: unescaped control characters
 * inside string values. Any other syntax error is a real error and rethrows.
 */
export function parseJsonSnapshot(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (
      !(error instanceof SyntaxError) ||
      !error.message.includes('control character')
    ) {
      throw error;
    }
    return JSON.parse(escapeControlCharsInJson(value));
  }
}

/**
 * Unwrap nested JSON string layers (a proxy's `toJSON` yields a string, so a
 * snapshot can arrive one or more encodings deep) and assert the result is an
 * object. Every unwrap goes through {@link parseJsonSnapshot}, so a control
 * character buried in an inner layer is repaired there too.
 */
export function normalizeJsonSnapshot(value: unknown): JsonRoot {
  let current = value;
  while (typeof current === 'string') {
    current = parseJsonSnapshot(current);
  }
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new Error('Yorkie document root snapshot is not an object');
  }
  return current as JsonRoot;
}

/**
 * Walk a Yorkie proxy by hand into plain JS, never touching `toJSON`. The last
 * resort when both string paths fail: it cannot hit a JSON parse error because
 * it never produces JSON.
 *
 * `bigint` (how Yorkie hands back a Long) degrades to a number when that is
 * lossless and to its decimal string otherwise; functions and symbols are
 * dropped rather than serialised as `null`.
 */
export function detachYorkieValue(value: unknown): unknown {
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }

  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => detachYorkieValue(item));
  }

  if (typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as JsonRoot).flatMap(([key, child]) => {
      const detached = detachYorkieValue(child);
      return detached === undefined ? [] : [[key, detached]];
    }),
  );
}

/**
 * The whole Yorkie root as detached plain JSON, tried three ways because the
 * cheapest one does not always work:
 *
 * 1. `doc.toJSON()` — the CRDT's own snapshot string.
 * 2. `JSON.stringify(root)` — the proxy's `toJSON` makes this double-encode
 *    into a *quoted* copy of that same string, which `normalizeJsonSnapshot`
 *    unwraps. Unlike step 1 the outer encoding is done by `JSON.stringify`, so
 *    a value that broke step 1's escaping arrives intact here.
 * 3. `detachYorkieValue(root)` — walk the proxy, no JSON in the loop at all.
 *
 * Steps 2 and 3 exist for documents holding control characters that Yorkie's
 * raw JSON string path does not escape, which make a plain
 * `JSON.parse(doc.toJSON())` throw. Shared with
 * `scripts/copy-yorkie-documents.ts`, which copies roots between Yorkie
 * servers the same way.
 */
export function snapshotJsonRoot(doc: {
  toJSON: () => string;
  getRoot?: () => unknown;
}): JsonRoot {
  try {
    return normalizeJsonSnapshot(parseJsonSnapshot(doc.toJSON()));
  } catch (err) {
    if (typeof doc.getRoot !== 'function') throw err;
    const root = doc.getRoot();
    try {
      return normalizeJsonSnapshot(parseJsonSnapshot(JSON.stringify(root)));
    } catch {
      return normalizeJsonSnapshot(detachYorkieValue(root));
    }
  }
}
