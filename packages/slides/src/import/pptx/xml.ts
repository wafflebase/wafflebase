/**
 * Thin DOMParser facade + namespace-tolerant traversal helpers.
 *
 * PPTX XML uses several namespaces (`p:`, `a:`, `r:` plus a handful of
 * extension namespaces). Rather than threading the namespace URI through
 * every lookup, this module matches on `localName` so callers don't have
 * to distinguish between `p:sp` and `sp` etc.
 *
 * Node consumers (the CLI) must polyfill `DOMParser` before calling into
 * the importer — `@wafflebase/cli`'s `dom-polyfill.ts` already does this
 * as a side-effect import for the docs importer.
 */

export const NS = {
  /** PresentationML — `p:` */
  P: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  /** DrawingML — `a:` */
  A: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  /** Relationships (per-part) — `r:` */
  R: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  /** Relationships (package-level `.rels` files) */
  RELS: 'http://schemas.openxmlformats.org/package/2006/relationships',
} as const;

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  // DOMParser emits a `<parsererror>` element rather than throwing.
  // Surface it as an Error so callers don't proceed with a junk tree.
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    throw new Error(`Invalid XML: ${err.textContent ?? 'unknown parse error'}`);
  }
  return doc;
}

/** First child element with matching `localName`, or `undefined`. */
export function child(parent: Element | Document, localName: string): Element | undefined {
  const root: ParentNode = parent;
  const nodes = root.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nodeType === 1 && (n as Element).localName === localName) {
      return n as Element;
    }
  }
  return undefined;
}

/** Every direct child element with matching `localName`. */
export function children(parent: Element | Document, localName: string): Element[] {
  const out: Element[] = [];
  const nodes = parent.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nodeType === 1 && (n as Element).localName === localName) {
      out.push(n as Element);
    }
  }
  return out;
}

/**
 * First descendant element with matching `localName`. Useful for reading
 * a single deeply-nested attribute (e.g. `<p:sldSz>` inside the root).
 */
export function descendant(parent: Element | Document, localName: string): Element | undefined {
  // Document and Element both expose `getElementsByTagName` (`*` matches any).
  // We then filter by `localName` to stay namespace-agnostic.
  const all = (parent as Element | Document).getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) return all[i];
  }
  return undefined;
}

export function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v === null ? undefined : v;
}

/** Parse an int attribute; returns `undefined` if missing or not a number. */
export function attrInt(el: Element, name: string): number | undefined {
  const v = el.getAttribute(name);
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function textOf(el: Element): string {
  return el.textContent ?? '';
}
