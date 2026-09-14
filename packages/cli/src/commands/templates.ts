import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRunUrl } from '../client/dry-run.js';
import {
  documentTemplateUrl,
  templateBrowseParams,
  templatesUrl,
  templateUseUrl,
  type TemplateBrowseQuery,
} from '../client/url.js';
import type { PublishTemplateBody } from '../client/http-client.js';

/**
 * `templates` — the gallery (docs/design/template-gallery.md): list what has
 * been published, publish a document, start a new one from a listing.
 *
 * These are the **browser** routes (`/templates`, `/documents/:id/template`),
 * not `/api/v1/workspaces/:id/…` — a listing is workspace-scoped through its
 * document rather than through the path, and `use` deliberately crosses a
 * workspace boundary. So, exactly like `api-keys`, the URL comes from a
 * builder in `client/url.ts` that `HttpClient` fetches with and the preview
 * prints.
 *
 * `publish` and `use` are `JwtAuthGuard`-only, so they need a JWT session
 * (`wafflebase login`) and refuse an API key, as `api-keys` does. `list` takes
 * optional auth: `--scope public` answers an unauthenticated caller — an API
 * key is ignored rather than honoured, since it is not a session — while
 * `--scope workspace` needs one.
 */

/** Collect a repeatable `--tag`, leaving it absent when never passed. */
function collectTag(value: string, previous?: string[]): string[] {
  return [...(previous ?? []), value];
}

interface ListOpts {
  scope: string;
  type?: string;
  category?: string;
  tag?: string;
  query?: string;
  sort?: string;
  limit?: string;
  cursor?: string;
}

interface PublishOpts {
  title?: string;
  description?: string;
  category?: string;
  tag?: string[];
  visibility?: string;
}

export function registerTemplatesCommand(program: Command) {
  const templates = program
    .command('templates')
    .alias('template')
    .description('Browse, publish, and use templates');

  templates
    .command('list')
    .description(
      'List templates published to the workspace (or the public gallery)',
    )
    .option(
      '--scope <scope>',
      'workspace (the active workspace) or public',
      'workspace',
    )
    .option('--type <type>', 'Document type facet (sheet|doc|slides|note|board)')
    .option('--category <category>', 'Category facet')
    .option('--tag <tag>', 'Tag facet (a single tag)')
    .option('--query <text>', 'Free text over title, description, and tags')
    .option('--sort <sort>', 'popular or recent')
    .option('--limit <n>', 'Page size (1-50; server default 24)')
    .option('--cursor <id>', 'Keyset cursor: the `nextCursor` of a prior page')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      const o = this.opts<ListOpts>();
      try {
        const fmt = parseOutputFormat(opts.format);
        // The workspace goes on the query only for the workspace scope: the
        // public gallery is not a workspace's, and sending one would read as a
        // filter the caller never asked for.
        const query: TemplateBrowseQuery = {
          scope: o.scope as TemplateBrowseQuery['scope'],
          ...(o.scope === 'workspace'
            ? { workspaceId: getConfig(opts).workspace }
            : {}),
          type: o.type,
          category: o.category,
          tag: o.tag,
          q: o.query,
          sort: o.sort,
          limit: o.limit,
          cursor: o.cursor,
        };
        if (opts.dryRun) {
          printDryRunUrl(
            templatesUrl(getConfig(opts), templateBrowseParams(query)),
            'GET',
          );
          return;
        }
        const res = await getClient(opts).browseTemplates(query);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  templates
    .command('publish <doc-id>')
    .description('Publish (or re-publish) a document as a template')
    .option('--title <title>', 'Listing title (default: the document title)')
    .option('--description <text>', 'Listing description')
    .option('--category <category>', 'Category (one of the closed taxonomy)')
    .option('--tag <tag>', 'Add a tag (repeatable)', collectTag)
    .option(
      '--visibility <visibility>',
      'unlisted (anyone holding the id) or workspace; public needs review',
    )
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const o = this.opts<PublishOpts>();
      try {
        // Only the fields the caller named. Publishing is an upsert that falls
        // back to the existing listing field by field, so sending an unset
        // option would blank a live listing — and for `visibility` would widen
        // a workspace listing to anyone holding its id.
        const body: PublishTemplateBody = {
          ...(o.title !== undefined ? { title: o.title } : {}),
          ...(o.description !== undefined
            ? { description: o.description }
            : {}),
          ...(o.category !== undefined ? { category: o.category } : {}),
          ...(o.tag !== undefined ? { tags: o.tag } : {}),
          ...(o.visibility !== undefined ? { visibility: o.visibility } : {}),
        };
        // Inside the try and before `--format` narrowing: the preview path is
        // built from an id, and `seg()`'s refusal of a `.` / `..` one has to
        // reach `outputError` as the error envelope.
        if (opts.dryRun) {
          printDryRunUrl(
            documentTemplateUrl(getConfig(opts), docId),
            'POST',
            body,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).publishTemplate(docId, body);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  templates
    .command('use <template-id>')
    .description('Start a new document from a template')
    .option(
      '--into <workspace>',
      'Destination workspace id or slug (default: the active workspace)',
    )
    .action(async function (this: Command, templateId: string) {
      const opts = getGlobalOpts(this);
      const { into } = this.opts<{ into?: string }>();
      try {
        // The destination is the caller's own workspace unless they name one:
        // this is the one route where a document crosses a workspace boundary,
        // and the read authority is the listing's while the write authority is
        // membership of wherever it lands.
        const workspaceId = into ?? getConfig(opts).workspace;
        if (opts.dryRun) {
          printDryRunUrl(
            templateUseUrl(getConfig(opts), templateId),
            'POST',
            { workspaceId },
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).useTemplate(templateId, workspaceId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
