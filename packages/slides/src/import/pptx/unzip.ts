import JSZip from 'jszip';

/**
 * A read-only view over an unzipped .pptx archive.
 *
 * Mirrors the access patterns we need throughout the importer:
 *   - `readText(path)` for XML parts
 *   - `readBytes(path)` for media (uploaded via the host's image API)
 *   - `list(prefix)` for enumerating slides / layouts / media
 *
 * Returns `undefined` for missing entries rather than throwing — callers
 * decide whether absence is fatal (e.g., `ppt/presentation.xml`) or
 * tolerable (e.g., a slide rels file with no images).
 */
export interface PptxArchive {
  readText(path: string): Promise<string | undefined>;
  readBytes(path: string): Promise<Uint8Array | undefined>;
  list(prefix: string): string[];
}

export async function unzipPptx(buffer: ArrayBuffer): Promise<PptxArchive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new Error(
      `Invalid .pptx: failed to unzip (${(err as Error).message})`,
    );
  }

  // Minimal sanity check — a valid PPTX always has `[Content_Types].xml`.
  if (!zip.file('[Content_Types].xml')) {
    throw new Error(
      'Invalid .pptx: missing [Content_Types].xml (not an OOXML package)',
    );
  }

  return {
    async readText(path) {
      return zip.file(path)?.async('string');
    },
    async readBytes(path) {
      const data = await zip.file(path)?.async('uint8array');
      return data;
    },
    list(prefix) {
      return Object.keys(zip.files).filter(
        (name) => name.startsWith(prefix) && !zip.files[name].dir,
      );
    },
  };
}
