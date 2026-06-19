import type { Element } from '../../../model/element';

/**
 * Custom MIME type used for slides element clipboard payloads. Phase 4's
 * React wrapper reads/writes the same MIME type, so a copy from the slides
 * demo can paste into the eventual frontend editor and vice versa.
 *
 * The `web ` prefix is required by the W3C Clipboard API for any custom
 * MIME type — without it, Chrome silently rejects the ClipboardItem.
 * See https://w3c.github.io/clipboard-apis/#optional-data-types-x.
 */
export const MIME_TYPE = 'web application/x-wafflebase-slides+json';

const MAGIC = 'wafflebase/slides@v1';

interface Payload {
  magic: string;
  elements: Element[];
}

/**
 * JSON-encode the given elements for the custom MIME type.
 *
 * Each element's `id` is preserved so the paste path can build a source→new
 * id map and remap attached connector endpoints onto the pasted copies (see
 * {@link pasteElements}). The id is otherwise harmless on paste: `addElement`
 * always overwrites the incoming id with a freshly generated one.
 */
export function serializeElements(elements: readonly Element[]): string {
  const payload: Payload = { magic: MAGIC, elements: [...elements] };
  return JSON.stringify(payload);
}

/**
 * Parse a JSON payload produced by {@link serializeElements}. Throws if
 * the payload is not JSON or is missing the slides magic.
 */
export function deserializeElements(json: string): Element[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('clipboard payload is not JSON');
  }
  if (!isPayload(parsed)) {
    throw new Error('clipboard payload missing wafflebase/slides magic');
  }
  return parsed.elements;
}

function isPayload(v: unknown): v is Payload {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { magic?: unknown }).magic === MAGIC &&
    Array.isArray((v as { elements?: unknown }).elements)
  );
}
