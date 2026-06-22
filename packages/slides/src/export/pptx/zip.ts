import JSZip from 'jszip';
import { contentTypesXml, rootRelsXml } from './templates.js';

interface Rel { id: string; type: string; target: string; }

export class PptxWriter {
  private parts = new Map<string, string>();
  private overrides: string[] = [];
  private rels = new Map<string, Rel[]>(); // ownerPartPath → rels
  private relCounters = new Map<string, number>();
  private media = new Map<string, Uint8Array>(); // path → bytes
  private mediaSeq = 0;

  addPart(path: string, xml: string, contentType?: string): void {
    this.parts.set(path, xml);
    if (contentType) this.addOverride(`/${path}`, contentType);
  }

  addOverride(partName: string, contentType: string): void {
    this.overrides.push(`  <Override PartName="${partName}" ContentType="${contentType}"/>`);
  }

  addMedia(bytes: Uint8Array, ext: string): string {
    const path = `media/image${++this.mediaSeq}.${ext}`;
    this.media.set(`ppt/${path}`, bytes);
    return path;
  }

  addRel(ownerPartPath: string, type: string, target: string): string {
    const n = (this.relCounters.get(ownerPartPath) ?? 0) + 1;
    this.relCounters.set(ownerPartPath, n);
    const id = `rId${n}`;
    const list = this.rels.get(ownerPartPath) ?? [];
    list.push({ id, type, target });
    this.rels.set(ownerPartPath, list);
    return id;
  }

  async build(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypesXml(this.overrides));
    zip.file('_rels/.rels', rootRelsXml());
    for (const [path, xml] of this.parts) zip.file(path, xml);
    for (const [path, bytes] of this.media) zip.file(path, bytes);
    for (const [owner, list] of this.rels) {
      const relsPath = relsPathFor(owner);
      const body = list
        .map((r) => `  <Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`)
        .join('\n');
      zip.file(
        relsPath,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${body}
</Relationships>`,
      );
    }
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    return new Uint8Array(buf);
  }
}

function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : partPath.slice(0, slash + 1);
  const name = slash === -1 ? partPath : partPath.slice(slash + 1);
  return `${dir}_rels/${name}.rels`;
}
