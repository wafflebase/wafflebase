import { DOMParser as XmldomParser } from '@xmldom/xmldom';

/**
 * Make `DOMParser` available globally so `@wafflebase/docs`'s
 * `DocxImporter` can call `new DOMParser()` from a Node CLI process.
 *
 * `DocxImporter` was originally written for the browser and parses
 * `.docx` XML through the WHATWG DOMParser. Node has no built-in DOM,
 * so we substitute `@xmldom/xmldom`'s implementation — it's an XML-only
 * parser (no HTML quirks, no full DOM tree mutation) but covers the
 * `getElementsByTagNameNS` / `textContent` / `getAttribute` surface the
 * importer actually touches.
 *
 * The shim is idempotent: if a real `DOMParser` is already present
 * (jsdom-environment tests, future Node releases that ship one) we
 * leave it alone so production code continues to use the more featureful
 * implementation.
 *
 * Side-effect import — bring this file in *before* any code path that
 * calls `DocxImporter.import`.
 */
const g = globalThis as unknown as { DOMParser?: unknown };
if (typeof g.DOMParser === 'undefined') {
  // Assign through an `unknown` cast because `@xmldom/xmldom`'s
  // `DOMParser` shape is a runtime superset of WHATWG's but uses its
  // own type declarations. `DocxImporter` only consumes the XML subset
  // both implementations share, so the runtime contract holds even
  // though the static types don't unify.
  g.DOMParser = XmldomParser as unknown;
}
