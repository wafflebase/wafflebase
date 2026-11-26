import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { SeedThumbnail } from './template-sync';

/**
 * Reading `pnpm frontend render:thumbnails`' output directory
 * (docs/design/template-catalog-scaling.md §3).
 *
 * The manifest is the contract between the two commands: the renderer writes
 * `<slug>.webp` plus `manifest.json`, and this side refuses any file whose
 * bytes no longer match the hash the renderer recorded.
 */

export interface ThumbnailManifestItem {
  file: string;
  mimeType: string;
  sha256: string;
  contentHash: string;
}

export interface ThumbnailManifest {
  version: 1;
  items: Record<string, ThumbnailManifestItem>;
  /** Seeds of a type with no renderer yet, by slug, with the reason. */
  skipped?: Record<string, string>;
  /** Seeds whose render failed, by slug, with the reason. */
  failed?: Record<string, string>;
}

export type ThumbnailLookup =
  | { kind: 'ok'; thumbnail: SeedThumbnail }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string };

const ALLOWED_MIME = new Set(['image/webp', 'image/png']);

export class ThumbnailDirectory {
  private constructor(
    private readonly dir: string,
    private readonly manifest: ThumbnailManifest,
  ) {}

  static async open(dir: string): Promise<ThumbnailDirectory> {
    const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw) as ThumbnailManifest;
    if (manifest?.version !== 1 || typeof manifest.items !== 'object') {
      throw new Error(
        `${dir}/manifest.json is not a version-1 thumbnail manifest`,
      );
    }
    return new ThumbnailDirectory(dir, manifest);
  }

  async get(slug: string): Promise<ThumbnailLookup> {
    const item = this.manifest.items[slug];
    if (!item) {
      const skipped = this.manifest.skipped?.[slug];
      if (skipped) return { kind: 'skipped', reason: skipped };
      return {
        kind: 'failed',
        reason: this.manifest.failed?.[slug] ?? 'no thumbnail was rendered',
      };
    }
    // The file name comes from a manifest on disk; keep it inside the
    // directory rather than trusting it to.
    if (path.basename(item.file) !== item.file) {
      return { kind: 'failed', reason: `unsafe thumbnail path ${item.file}` };
    }
    if (!ALLOWED_MIME.has(item.mimeType)) {
      return { kind: 'failed', reason: `unexpected type ${item.mimeType}` };
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(this.dir, item.file));
    } catch {
      return { kind: 'failed', reason: `missing ${item.file}` };
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== item.sha256) {
      return {
        kind: 'failed',
        reason: `${item.file} does not match its manifest hash`,
      };
    }
    return {
      kind: 'ok',
      thumbnail: {
        bytes,
        mimeType: item.mimeType,
        sha256,
        contentHash: item.contentHash,
      },
    };
  }
}
