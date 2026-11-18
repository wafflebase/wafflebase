import { bandBlockNumerics } from '@wafflebase/docs';
import type { TextBody } from '@wafflebase/slides';

/**
 * Connector `label` storage, shared by `YorkieSlidesStore` and
 * `YorkieBoardStore`. A label is a plain JSON field on the connector
 * object (like `stroke`), written whole: last writer wins, the same
 * on-blur granularity a shape's text body has. A document written before
 * labels existed simply has no field, and reads as "no label".
 */

/** Plain-value read of a connector proxy's `label` (or `undefined`). */
function readConnectorLabel(raw: unknown): TextBody | undefined {
  if (raw === undefined || raw === null) return undefined;
  const plain = toPlain<TextBody>(raw);
  if (!plain || !Array.isArray(plain.blocks)) return undefined;
  return { ...plain, blocks: bandBlockNumerics(plain.blocks) };
}

/**
 * `{ label }` for a connector proxy that has one, else `{}`: spread into
 * the plain element a store's `readElement` builds.
 */
export function withConnectorLabel(connector: object): { label?: TextBody } {
  const label = readConnectorLabel((connector as { label?: unknown }).label);
  return label ? { label } : {};
}

/** Set or remove `label` on a connector proxy inside a `doc.update`. */
export function writeConnectorLabel(
  connector: object,
  label: TextBody | undefined,
): void {
  const c = connector as { label?: TextBody };
  if (label === undefined) {
    delete c.label;
  } else {
    c.label = JSON.parse(JSON.stringify(label)) as TextBody;
  }
}

function toPlain<T>(value: unknown): T {
  if (value && typeof value === 'object') {
    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === 'function') {
      const out = toJSON.call(value);
      if (typeof out === 'string') return JSON.parse(out) as T;
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }
  return value as T;
}
