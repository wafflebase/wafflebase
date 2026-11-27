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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `map[slug]`, but only for an own property. The maps come from
 * `JSON.parse`, so they inherit `Object.prototype`: a slug such as
 * `constructor` would otherwise resolve to a function.
 */
function own(map: Record<string, unknown> | undefined, slug: string): unknown {
  return map && Object.prototype.hasOwnProperty.call(map, slug)
    ? map[slug]
    : undefined;
}

function isManifestItem(value: unknown): value is ThumbnailManifestItem {
  return (
    isPlainObject(value) &&
    typeof value.file === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.sha256 === 'string' &&
    typeof value.contentHash === 'string'
  );
}

export class ThumbnailDirectory {
  private constructor(
    private readonly dir: string,
    private readonly manifest: ThumbnailManifest,
  ) {}

  /**
   * Fails the whole run only for a manifest that is not one at all. An entry
   * that is malformed fails its own seed, in {@link get}.
   */
  static async open(dir: string): Promise<ThumbnailDirectory> {
    const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8');
    const manifest: unknown = JSON.parse(raw);
    if (
      !isPlainObject(manifest) ||
      manifest.version !== 1 ||
      !isPlainObject(manifest.items) ||
      (manifest.skipped !== undefined && !isPlainObject(manifest.skipped)) ||
      (manifest.failed !== undefined && !isPlainObject(manifest.failed))
    ) {
      throw new Error(
        `${dir}/manifest.json is not a version-1 thumbnail manifest`,
      );
    }
    return new ThumbnailDirectory(
      dir,
      manifest as unknown as ThumbnailManifest,
    );
  }

  async get(slug: string): Promise<ThumbnailLookup> {
    const item = own(this.manifest.items, slug);
    if (item === undefined) {
      const skipped = own(this.manifest.skipped, slug);
      if (typeof skipped === 'string' && skipped) {
        return { kind: 'skipped', reason: skipped };
      }
      const failed = own(this.manifest.failed, slug);
      return {
        kind: 'failed',
        reason:
          typeof failed === 'string' && failed
            ? failed
            : 'no thumbnail was rendered',
      };
    }
    if (!isManifestItem(item)) {
      return { kind: 'failed', reason: 'malformed manifest entry' };
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
