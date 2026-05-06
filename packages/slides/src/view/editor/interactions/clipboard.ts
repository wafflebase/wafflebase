import type { Element, ElementInit } from '../../../model/element';

/**
 * Custom MIME type used for slides element clipboard payloads. Phase 4's
 * React wrapper reads/writes the same MIME type, so a copy from the slides
 * demo can paste into the eventual frontend editor and vice versa.
 */
export const MIME_TYPE = 'application/x-wafflebase-slides+json';

const MAGIC = 'wafflebase/slides@v1';

interface Payload {
  magic: string;
  elements: ElementInit[];
}

/**
 * JSON-encode the given elements for the custom MIME type. The `id`
 * field is stripped from each element — paste assigns fresh ids.
 */
export function serializeElements(elements: readonly Element[]): string {
  const stripped: ElementInit[] = elements.map((e) => {
    const { id: _drop, ...rest } = e;
    return rest as ElementInit;
  });
  const payload: Payload = { magic: MAGIC, elements: stripped };
  return JSON.stringify(payload);
}

/**
 * Parse a JSON payload produced by {@link serializeElements}. Throws if
 * the payload is not JSON or is missing the slides magic.
 */
export function deserializeElements(json: string): ElementInit[] {
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
