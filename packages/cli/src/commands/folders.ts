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
 * `folders` — the workspace's organizational tree.
 *
 * Workspace-scoped, not document-scoped: there is no doc id and no `--tab`
 * here. Folders carry no permissions of their own (see
 * docs/design/workspace-folders.md) — moving a document into one changes where
 * it is listed, never who can read it.
 *
 * The tree is returned flat; `parentId` reconstructs it, and `null` is the
 * workspace root. `move` takes the new parent as an optional positional for
 * the same reason: omitting it is the root, which is the only value that
 * cannot be spelled as an id.
 */
export function registerFoldersCommand(program: Command) {
  const folders = program
    .command('folders')
    .alias('folder')
    .description('Manage workspace folders');

  folders
    .command('list')
    .description('List folders in the workspace (flat; parentId builds a tree)')
    .action(async function (this: Command) {
      const opts = getGlobalOpts(this);
      try {
        const fmt = parseOutputFormat(opts.format);
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'GET', '/folders');
          return;
        }
        const res = await getClient(opts).listFolders();
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  folders
    .command('create <name>')
    .description('Create a folder (default: at the workspace root)')
    .option('--parent <folder-id>', 'Create it inside this folder')
    .action(async function (this: Command, name: string) {
      const opts = getGlobalOpts(this);
      const { parent } = this.opts<{ parent?: string }>();
      try {
        const fmt = parseOutputFormat(opts.format);
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'POST', '/folders', {
            name,
            ...(parent ? { parentId: parent } : {}),
          });
          return;
        }
        const res = await getClient(opts).createFolder(name, parent);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  folders
    .command('rename <folder-id> <name>')
    .description('Rename a folder')
    .action(async function (this: Command, folderId: string, name: string) {
      const opts = getGlobalOpts(this);
      try {
        // Inside the try, ahead of `--format` narrowing: the preview path is
        // built from an id and `seg()` refuses a `.` / `..` one, so that
        // refusal has to reach `outputError` as the error envelope rather
        // than escape the handler as a rejected action promise.
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'PATCH', `/folders/${seg(folderId)}`, {
            name,
          });
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).renameFolder(folderId, name);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  folders
    .command('move <folder-id> [parent-folder-id]')
    .description('Move a folder under a new parent (omit the parent for root)')
    .action(async function (
      this: Command,
      folderId: string,
      parentFolderId?: string,
    ) {
      const opts = getGlobalOpts(this);
      try {
        // `null`, not `undefined`: the backend reads an absent `parentId` as
        // "leave the parent alone", so the move to the root has to be an
        // explicit null on the wire.
        const parentId = parentFolderId ?? null;
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'PATCH', `/folders/${seg(folderId)}`, {
            parentId,
          });
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).moveFolder(folderId, parentId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  folders
    .command('delete <folder-id>')
    .description(
      'Delete a folder; its documents return to the workspace root (never deleted)',
    )
    .action(async function (this: Command, folderId: string) {
      const opts = getGlobalOpts(this);
      try {
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'DELETE', `/folders/${seg(folderId)}`);
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).deleteFolder(folderId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });
}
