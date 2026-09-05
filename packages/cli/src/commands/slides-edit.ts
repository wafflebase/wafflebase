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

/**
 * Per-slide editing, plus the layout catalog that makes `--layout` guessable.
 *
 * `slides set-content` can already replace a whole deck, but adding one slide
 * through it means reading the deck, hand-building a slide with placeholder
 * elements seeded from the master's styles, and writing everything back —
 * losing any concurrent edit in between. These verbs each touch one slide.
 *
 * Positions are 1-based (`1` = first slide), matching `sheets insert` and the
 * rest of this surface, and clamp rather than fail: a number past the end
 * means "last".
 */
export function registerSlidesEditCommand(parent: Command) {
  parent
    .command('layouts <doc-id>')
    .alias('layout')
    .description("List the layout ids this deck's slides can be built from")
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'GET',
            `/documents/${seg(docId)}/layouts`,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).listSlideLayouts(docId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  const slide = parent
    .command('slide')
    .description('Add, duplicate, move and delete individual slides');

  slide
    .command('add <doc-id>')
    .description('Append a slide (or insert it at --index)')
    .option('--layout <layout-id>', 'Layout to build it from', 'blank')
    .option('--index <n>', '1-based position to insert at (default: append)')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { layout, index: indexArg } = this.opts<{
        layout: string;
        index?: string;
      }>();

      // Parsed before the dry run: previewing a body the server rejects is
      // worse than no preview at all.
      let index: number | undefined;
      if (indexArg !== undefined) {
        index = Number(indexArg);
        if (!Number.isInteger(index) || index < 1) {
          outputError(
            new Error(
              `Invalid --index "${indexArg}". Use a positive integer (1 = first slide).`,
            ),
            this,
          );
          return;
        }
      }
      const body = index === undefined ? { layoutId: layout } : { layoutId: layout, index };

      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/slides`,
            body,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).addSlide(docId, body);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  slide
    .command('duplicate <doc-id> <slide-id>')
    .description('Copy a slide and insert the copy right after it')
    .action(async function (this: Command, docId: string, slideId: string) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/slides/${seg(slideId)}/duplicate`,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).duplicateSlide(docId, slideId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  slide
    .command('move <doc-id> <slide-id> <index>')
    .description('Move a slide to a 1-based position in the deck')
    .action(async function (
      this: Command,
      docId: string,
      slideId: string,
      indexArg: string,
    ) {
      const opts = getGlobalOpts(this);
      const index = Number(indexArg);
      if (!Number.isInteger(index) || index < 1) {
        outputError(
          new Error(
            `Invalid index "${indexArg}". Use a positive integer (1 = first slide).`,
          ),
          this,
        );
        return;
      }
      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'POST',
            `/documents/${seg(docId)}/slides/${seg(slideId)}/move`,
            { index },
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).moveSlide(docId, slideId, index);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  slide
    .command('delete <doc-id> <slide-id>')
    .description('Delete a slide (refuses the last remaining one)')
    .action(async function (this: Command, docId: string, slideId: string) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'DELETE',
            `/documents/${seg(docId)}/slides/${seg(slideId)}`,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).deleteSlide(docId, slideId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
