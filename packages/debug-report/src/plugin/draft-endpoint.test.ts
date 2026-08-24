import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { draftBundle, renderItem, renderPrompt, __testables } from './draft-endpoint';

/** The real schema, imported the way a test may (vitest resolves the alias). */
const schema = { type: 'object' } as Record<string, unknown>;

const bundle = {
  items: [
    {
      id: 'i1',
      note: 'the toolbar icons are cramped',
      target: {
        kind: 'dom',
        tag: 'button',
        selector: 'div.toolbar > button',
        testId: 'bold',
        text: 'Bold',
        rect: { x: 0, y: 0, w: 32, h: 32 },
      },
      capture: undefined,
      disposition: 'verify',
    },
    {
      id: 'i2',
      note: 'the merged border looks broken',
      target: { kind: 'canvas', surface: 'sheet', address: 'Sheet1!C7', rect: { x: 0, y: 0, w: 80, h: 21 } },
      capture: { id: 'c1' },
      disposition: 'verify',
    },
  ],
  env: { route: '/s/:id', viewport: { w: 1280, h: 800 }, dpr: 2, theme: 'light' },
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
    const outcome = await draftBundle({ items: [] }, { client: c, schema });
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
