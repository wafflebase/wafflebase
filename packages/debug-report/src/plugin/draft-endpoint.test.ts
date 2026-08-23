import { strict as assert } from 'node:assert';
import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { draftBundle, renderItem, renderPrompt, __testables } from './draft-endpoint';
import type { DraftRequest } from '../types';

/** The real schema, imported the way a test may (vitest resolves the alias). */
const schema = { type: 'object' } as Record<string, unknown>;

/**
 * The REAL model, not a loose mirror of it.
 *
 * `report-endpoint.ts` runs `parseDraftRequest` before anything reaches this
 * module, so a fixture that omits `createdAt` or `agentCandidate` is a shape the
 * endpoint could never hand over.
 */
const bundle: DraftRequest = {
  items: [
    {
      id: 'i1',
      createdAt: 1_700_000_000_000,
      note: 'the toolbar icons are cramped',
      target: {
        kind: 'dom',
        tag: 'button',
        selector: 'div.toolbar > button',
        testId: 'bold',
        text: 'Bold',
        rect: { x: 0, y: 0, w: 32, h: 32 },
      },
      disposition: 'verify',
      agentCandidate: false,
    },
    {
      id: 'i2',
      createdAt: 1_700_000_001_000,
      note: 'the merged border looks broken',
      target: {
        kind: 'canvas',
        surface: 'sheet',
        address: 'Sheet1!C7',
        rect: { x: 0, y: 0, w: 80, h: 21 },
      },
      capture: { id: 'c1', w: 80, h: 21, bytes: 900, layers: 1, mime: 'image/png' },
      disposition: 'verify',
      agentCandidate: false,
    },
  ],
  env: {
    route: '/s/:id',
    viewport: { w: 1280, h: 800 },
    dpr: 2,
    theme: 'light',
    userAgent: 'vitest',
  },
};

const message = (text: string): Anthropic.Message =>
  ({
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
  }) as unknown as Anthropic.Message;

describe('what the model is shown', () => {
  it('describes a DOM target by selector, test id and text', () => {
    const rendered = renderItem(bundle.items[0]);
    expect(rendered).toContain('div.toolbar > button');
    expect(rendered).toContain('data-testid="bold"');
    expect(rendered).toContain('"Bold"');
  });

  it('describes a canvas target by its address', () => {
    expect(renderItem(bundle.items[1])).toContain('sheet canvas at Sheet1!C7');
  });

  it('says an image EXISTS without sending it', () => {
    // A screenshot can hold another person's document; the mitigation is not
    // shipping it further than it has to go.
    expect(renderItem(bundle.items[1])).toContain('screenshot exists: yes');
    expect(renderItem(bundle.items[1])).not.toContain('base64');
  });

  it('tells the model when the build is unknown rather than leaving it blank', () => {
    expect(renderPrompt(bundle)).toMatch(/build: UNKNOWN/);
    expect(renderPrompt({ ...bundle, env: { ...bundle.env, buildSha: 'abc123' } })).toContain(
      'build: abc123',
    );
  });

  it('states the grouping rules in the system prompt', () => {
    expect(__testables.SYSTEM_PROMPT).toMatch(/never group/);
    expect(__testables.SYSTEM_PROMPT).toMatch(/no tools and no repository access/);
  });
});

describe('draftBundle', () => {
  const client = (impl: () => Promise<Anthropic.Message>) => {
    const create =
      vi.fn<(params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>>(
        impl,
      );
    return { messages: { create } };
  };

  it('sends NO tools, which is the whole credential argument', async () => {
    const c = client(async () => message('{"drafts":[],"proposedGroups":[]}'));
    await draftBundle(bundle, { client: c, schema });
    const params = c.messages.create.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect('tools' in params).toBe(false);
    expect(params.model).toBe('claude-opus-5');
    expect(params.output_config).toEqual({
      format: { type: 'json_schema', schema: expect.any(Object) },
    });
  });

  it('returns the parsed answer', async () => {
    const c = client(async () => message('{"drafts":[{"itemId":"i1"}],"proposedGroups":[]}'));
    const outcome = await draftBundle(bundle, { client: c, schema });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result).toEqual({ drafts: [{ itemId: 'i1' }], proposedGroups: [] });
  });

  it('reports an empty bundle without calling the model', async () => {
    const c = client(async () => message('{}'));
    const outcome = await draftBundle({ ...bundle, items: [] }, { client: c, schema });
    expect(outcome).toMatchObject({ ok: false, reason: 'empty' });
    expect(c.messages.create).not.toHaveBeenCalled();
  });

  it('reports a refusal as a failure, with its category', async () => {
    const c = client(async () =>
      ({
        content: [],
        stop_reason: 'refusal',
        stop_details: { category: 'cyber' },
      }) as unknown as Anthropic.Message,
    );
    const outcome = await draftBundle(bundle, { client: c, schema });
    expect(outcome).toMatchObject({ ok: false, reason: 'failed' });
    if (!outcome.ok) expect(outcome.detail).toContain('cyber');
  });

  it('reports a non-JSON answer rather than repairing it', async () => {
    const c = client(async () => message('I think the toolbar is fine'));
    expect(await draftBundle(bundle, { client: c, schema })).toMatchObject({
      ok: false,
      reason: 'failed',
      detail: 'the response was not JSON',
    });
  });

  it('reports an empty answer', async () => {
    const c = client(async () => message('   '));
    expect(await draftBundle(bundle, { client: c, schema })).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('turns a transport failure into a typed outcome, not an exception', async () => {
    const c = client(async () => {
      throw new Error('socket hang up');
    });
    expect(await draftBundle(bundle, { client: c, schema })).toMatchObject({
      ok: false,
      reason: 'failed',
      detail: 'socket hang up',
    });
  });
});

describe('the SDK is not loaded until a draft is actually asked for', () => {
  it('is imported lazily, because vite.config reaches this module', async () => {
    // A CONSUMER's `vite.config.ts` mounts this plugin, and every vitest worker
    // in that consumer loads the config — so a static
    // `import Anthropic from "@anthropic-ai/sdk"` costs ~500 ms per worker for a
    // dependency only a drafting request needs. Measured in this repository
    // before the move, where it pushed a 5-second boundary test over; now that
    // the plugin ships in a package the cost lands on every consumer instead,
    // which makes the guard matter more rather than less.
    //
    // Read by path rather than by `import.meta.url`: under vitest the module id
    // is not a `file:` URL.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(process.cwd(), 'src', 'plugin', 'draft-endpoint.ts'),
      'utf8',
    );
    assert(!/^import Anthropic from/m.test(source), 'the SDK must not load at module scope');
    assert(/^import type Anthropic from/m.test(source), 'types are erased, so they are free');
    assert(/await import\("@anthropic-ai\/sdk"\)/.test(source), 'loaded where it is used');
  });

  it('recognises a missing credential without the SDK loaded', async () => {
    // An injected client never loads the SDK, so `instanceof` cannot be the only
    // test — a 401 means the same thing either way.
    const outcome = await draftBundle(bundle, {
      schema,
      client: {
        messages: {
          create: async () => {
            throw Object.assign(new Error('missing key'), { status: 401 });
          },
        },
      } as never,
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'not-configured' });
  });
});
