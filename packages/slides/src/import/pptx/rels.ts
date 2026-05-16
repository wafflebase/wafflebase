import { NS, parseXml } from './xml';

export interface PptxRel {
  /** Short type name (last URL segment), e.g. `'image'`, `'hyperlink'`. */
  type: string;
  /** Target path, possibly relative (`../media/image1.png`). */
  target: string;
  /** External hyperlinks expose `TargetMode="External"`. */
  external: boolean;
}

/**
 * Parse a `.rels` XML file into a map of relationship id → entry.
 *
 * Same shape as docs's `parseRelationships`, kept separate so the slides
 * package doesn't depend on docs internals.
 */
export function parseRels(xml: string): Map<string, PptxRel> {
  const doc = parseXml(xml);
  const out = new Map<string, PptxRel>();
  const elements = doc.getElementsByTagNameNS(NS.RELS, 'Relationship');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const id = el.getAttribute('Id') ?? '';
    const target = el.getAttribute('Target') ?? '';
    const fullType = el.getAttribute('Type') ?? '';
    const type = fullType.split('/').pop() ?? '';
    const external = el.getAttribute('TargetMode') === 'External';
    if (id) out.set(id, { type, target, external });
  }
  return out;
}

/**
 * Resolve a rels target path against the part it's attached to.
 *
 *   resolveRelsTarget('ppt/slides/slide1.xml', '../media/image1.png')
 *     → 'ppt/media/image1.png'
 *
 * External targets (`https://...`) are returned as-is.
 */
export function resolveRelsTarget(partPath: string, target: string): string {
  if (/^[a-z]+:\/\//i.test(target)) return target;
  // Drop the part filename and join with the target.
  const lastSlash = partPath.lastIndexOf('/');
  const baseDir = lastSlash >= 0 ? partPath.slice(0, lastSlash) : '';
  const segments = (baseDir + '/' + target).split('/');
  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}
