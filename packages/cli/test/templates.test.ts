import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/commands/root.js';
import { registerTemplatesCommand } from '../src/commands/templates.js';

/**
 * Drives the REAL commands through commander. What this namespace can get
 * silently wrong is what goes on the wire rather than what comes back:
 *
 * - `publish` is an upsert whose absent fields fall back to the live listing,
 *   so an option the caller did not pass must be *absent* from the body. A
 *   `visibility: null` would widen a workspace listing to anyone holding its
 *   id; a `category: null` would quietly blank the facet it is listed under.
 * - `list` must send `workspaceId` for the workspace scope (the server
 *   refuses the scope without it) and must NOT send it for the public one.
 * - These URLs are the browser routes, not `/api/v1/workspaces/:id/…`, so the
 *   previews assert the full URL rather than a path.
 */

const browseTemplates = vi.fn();
const publishTemplate = vi.fn();
const useTemplate = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    browseTemplates = (...a: unknown[]) => browseTemplates(...a);
    publishTemplate = (...a: unknown[]) => publishTemplate(...a);
    useTemplate = (...a: unknown[]) => useTemplate(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const DOC = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const LISTING = '11111111-2222-3333-4444-555555555555';

function run(argv: string[]) {
  const program = createProgram();
  registerTemplatesCommand(program);
  return program.parseAsync(
    ['--server', SERVER, '--workspace', WORKSPACE, ...argv],
    { from: 'user' },
  );
}

const ok = (data: unknown) => ({ ok: true, status: 200, data });

describe('templates commands', () => {
  let stdout: string[];
  let stderr: string[];
  const originalEnv = {
    WAFFLEBASE_SESSION: process.env.WAFFLEBASE_SESSION,
    WAFFLEBASE_CONFIG: process.env.WAFFLEBASE_CONFIG,
  };

  beforeEach(() => {
    stdout = [];
    stderr = [];
    for (const m of [browseTemplates, publishTemplate, useTemplate]) {
      m.mockReset();
    }
    // Never read the developer's real session/config: the flags above pin the
    // server and workspace, and an on-disk profile must not change what these
    // assertions see.
    process.env.WAFFLEBASE_SESSION = '/nonexistent/wafflebase-session.json';
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-config.yaml';
    vi.spyOn(console, 'log').mockImplementation((v) => {
      stdout.push(String(v));
    });
    vi.spyOn(console, 'error').mockImplementation((v) => {
      stderr.push(String(v));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.exitCode = undefined;
  });

  describe('list', () => {
    it('browses the active workspace by default', async () => {
      browseTemplates.mockResolvedValue(
        ok({ items: [{ id: LISTING, title: 'Weekly Report' }], nextCursor: null }),
      );

      await run(['templates', 'list']);

      expect(browseTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'workspace', workspaceId: WORKSPACE }),
      );
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({
        items: [{ id: LISTING }],
      });
      expect(process.exitCode).toBeUndefined();
    });

    // The public gallery is nobody's workspace: sending one would read as a
    // filter the caller never asked for.
    it('omits the workspace for the public scope', async () => {
      browseTemplates.mockResolvedValue(ok({ items: [], nextCursor: null }));

      await run(['templates', 'list', '--scope', 'public']);

      const query = browseTemplates.mock.calls[0][0] as Record<string, unknown>;
      expect(query.scope).toBe('public');
      expect(query.workspaceId).toBeUndefined();
    });

    it('passes the facets through to the query', async () => {
      browseTemplates.mockResolvedValue(ok({ items: [], nextCursor: null }));

      await run([
        'templates',
        'list',
        '--scope',
        'public',
        '--type',
        'slides',
        '--category',
        'Finance',
        '--tag',
        'budget',
        '--query',
        'quarterly',
        '--sort',
        'recent',
        '--limit',
        '5',
        '--cursor',
        LISTING,
      ]);

      expect(browseTemplates).toHaveBeenCalledWith({
        scope: 'public',
        type: 'slides',
        category: 'Finance',
        tag: 'budget',
        q: 'quarterly',
        sort: 'recent',
        limit: '5',
        cursor: LISTING,
      });
    });

    it('previews the browse URL with its query string', async () => {
      await run(['templates', 'list', '--sort', 'popular', '--dry-run']);

      expect(browseTemplates).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${SERVER}/templates?scope=workspace&workspaceId=${WORKSPACE}&sort=popular`,
      });
    });

    it('accepts the singular `template` alias', async () => {
      browseTemplates.mockResolvedValue(ok({ items: [], nextCursor: null }));
      await run(['template', 'list']);
      expect(browseTemplates).toHaveBeenCalledTimes(1);
    });
  });

  describe('publish', () => {
    // The one thing publishing can get silently wrong: an option nobody
    // passed must not reach the body, because the endpoint reads a present
    // field as "set it to this" and an absent one as "leave it alone".
    it('sends an empty body when no option is given', async () => {
      publishTemplate.mockResolvedValue(ok({ id: LISTING, documentId: DOC }));

      await run(['templates', 'publish', DOC]);

      expect(publishTemplate).toHaveBeenCalledWith(DOC, {});
    });

    it('sends only the options given', async () => {
      publishTemplate.mockResolvedValue(ok({ id: LISTING }));

      await run([
        'templates',
        'publish',
        DOC,
        '--title',
        'Weekly Report',
        '--category',
        'Business',
      ]);

      expect(publishTemplate).toHaveBeenCalledWith(DOC, {
        title: 'Weekly Report',
        category: 'Business',
      });
    });

    it('collects repeated tags', async () => {
      publishTemplate.mockResolvedValue(ok({ id: LISTING }));

      await run([
        'templates',
        'publish',
        DOC,
        '--tag',
        'budget',
        '--tag',
        'q1',
        '--visibility',
        'workspace',
      ]);

      expect(publishTemplate).toHaveBeenCalledWith(DOC, {
        tags: ['budget', 'q1'],
        visibility: 'workspace',
      });
    });

    it('previews the POST against the document route', async () => {
      await run([
        'templates',
        'publish',
        DOC,
        '--title',
        'Weekly Report',
        '--dry-run',
      ]);

      expect(publishTemplate).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${SERVER}/documents/${DOC}/template`,
        body: { title: 'Weekly Report' },
      });
    });

    it('forwards a refusal verbatim', async () => {
      publishTemplate.mockResolvedValue({
        ok: false,
        status: 400,
        data: {
          message:
            'This template was removed by a reviewer and cannot be republished',
        },
      });

      await run(['templates', 'publish', DOC]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/removed by a reviewer/);
    });

    it('refuses a traversing id before any request', async () => {
      await run(['templates', 'publish', '..', '--dry-run']);

      expect(stdout).toEqual([]);
      expect(publishTemplate).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { command: string } }).error
          .command,
      ).toBe('templates.publish');
    });
  });

  describe('use', () => {
    it('lands the copy in the active workspace by default', async () => {
      useTemplate.mockResolvedValue(ok({ id: 'doc-2', title: 'Weekly Report' }));

      await run(['templates', 'use', LISTING]);

      expect(useTemplate).toHaveBeenCalledWith(LISTING, WORKSPACE);
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ id: 'doc-2' });
    });

    it('honours --into', async () => {
      useTemplate.mockResolvedValue(ok({ id: 'doc-2' }));

      await run(['templates', 'use', LISTING, '--into', 'other-ws']);

      expect(useTemplate).toHaveBeenCalledWith(LISTING, 'other-ws');
    });

    it('previews the use POST with its destination', async () => {
      await run(['templates', 'use', LISTING, '--dry-run']);

      expect(useTemplate).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${SERVER}/templates/${LISTING}/use`,
        body: { workspaceId: WORKSPACE },
      });
    });
  });
});
