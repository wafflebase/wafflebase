import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { seg } from '../client/url.js';
import type { SheetImage } from '../client/http-client.js';

/**
 * Floating images on one spreadsheet tab — pictures anchored to a cell, as
 * distinct from the top-level `images` namespace, which uploads and serves the
 * bytes. The two compose: `images upload` returns a URL, and that URL is the
 * `src` of an entry here.
 *
 * `get` reads the collection; `set` REPLACES it, keyed by each image's `id`,
 * so an image missing from the payload is deleted — the same rule `charts`
 * follows, and the reason `set` is registered as `destructive`.
 */
export function registerSheetsImagesCommand(parent: Command) {
  const images = parent
    .command('images')
    .alias('image')
    .description('Read and write floating images on a worksheet');

  images
    .command('get <doc-id>')
    .description('Get the floating images on a spreadsheet tab')
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab } = this.opts<{ tab: string }>();
      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'GET',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/images`,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getWorksheetImages(docId, tab);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  images
    .command('set <doc-id>')
    .description(
      'Replace all floating images on a tab (JSON from stdin or --data; omitted images are deleted)',
    )
    .option('--tab <tab-id>', 'Tab ID', 'tab-1')
    .option('--data <json>', 'Images as JSON string')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { tab, data: dataStr } = this.opts<{
        tab: string;
        data?: string;
      }>();

      // Parse inside a try: a malformed `--data`/stdin payload is user input,
      // and the message has to name which one it came from.
      let parsed: unknown;
      try {
        let raw: string;
        if (dataStr) {
          raw = dataStr;
        } else {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
          }
          raw = Buffer.concat(chunks).toString('utf-8');
        }
        parsed = JSON.parse(raw);
      } catch (e) {
        outputError(
          new Error(
            `Invalid JSON image data${dataStr ? ' in --data' : ' on stdin'}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
          this,
        );
        return;
      }

      // Both spellings are accepted so `images get` output pipes straight
      // back into `images set`. Unwrapped BEFORE the dry-run branch: the
      // printed body is the wire body, so previewing a doubly-wrapped payload
      // would preview a request the server rejects with a 400.
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed as { images?: unknown }).images;
      if (!Array.isArray(list)) {
        outputError(
          new Error(
            `Invalid image data${dataStr ? ' in --data' : ' on stdin'}: ` +
              'expected a JSON array of images, or an object { "images": [ ... ] }.',
          ),
          this,
        );
        return;
      }
      const imageList = list as SheetImage[];

      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'PUT',
            `/documents/${seg(docId)}/tabs/${seg(tab)}/images`,
            { images: imageList },
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).setWorksheetImages(
          docId,
          tab,
          imageList,
        );
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
