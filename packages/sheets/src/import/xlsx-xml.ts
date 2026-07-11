// Shared XLSX XML traversal helpers used by the workbook importer and the
// style-table parser. XLSX parts are namespaced; we match by local name so the
// same code works regardless of prefix.

export function childrenByLocalName(
  parent: Element | Document,
  localName: string,
): Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', localName));
}

export function firstChildByLocalName(
  parent: Element | Document,
  localName: string,
): Element | null {
  return childrenByLocalName(parent, localName)[0] ?? null;
}

/**
 * Returns only the direct child elements with the given local name, filtering
 * out the deeper descendants `getElementsByTagNameNS` also returns.
 */
export function directChildren(parent: Element, localName: string): Element[] {
  return childrenByLocalName(parent, localName).filter(
    (el) => el.parentElement === parent,
  );
}

export function firstDirectChild(
  parent: Element,
  localName: string,
): Element | null {
  return directChildren(parent, localName)[0] ?? null;
}

export function readText(node: Node | null | undefined): string {
  return node?.textContent ?? '';
}

/**
 * Parses an XLSX XML part, throwing on malformed XML.
 */
export function parseXml(xml: string, path: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Invalid XLSX XML in ${path}.`);
  }
  return doc;
}

/**
 * Parses an XLSX XML part, returning undefined on malformed XML instead of
 * throwing — for optional parts (e.g. styles) where a failure should degrade
 * gracefully rather than abort the whole import.
 */
export function tryParseXml(xml: string): Document | undefined {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return undefined;
  }
  return doc;
}
