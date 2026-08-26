import { strict as assert } from 'node:assert';
import { describe, expect, it } from 'vitest';
import {
  draftBundle,
  isExhausted,
  isNotConfigured,
  readPoolSlots,
  renderItem,
  renderPrompt,
  sessionOptions,
  TOKEN_ENV,
  __testables,
  type AgentQuery,
} from './draft-endpoint';
import type { DraftRequest } from '../types';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

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

describe('the session the drafting call opens', () => {
  it('grants NO tools and inherits no project config', () => {
    // The whole credential argument. `allowedTools: []` alone would not hold:
    // without `settingSources: []` the session inherits this project's skills,
    // hooks and MCP servers, and the empty grant would describe nothing.
    const options = sessionOptions({ schema, env: {} });
    expect(options.allowedTools).toEqual([]);
    expect(options.settingSources).toEqual([]);
    expect(options.permissionMode).toBe('dontAsk');
  });

  it('holds the answer to the schema it was given', () => {
    expect(sessionOptions({ schema, env: {} }).outputFormat).toEqual({
      type: 'json_schema',
      schema,
    });
  });

  it('REPLACES the environment with a spread, or the CLI loses PATH', () => {
    // `Options.env` replaces rather than merges. Without the spread the
    // subprocess starts without `PATH` and never runs at all.
    const options = sessionOptions({ schema, token: 'oat-2', env: { PATH: '/usr/bin', X: '1' } });
    expect(options.env).toEqual({ PATH: '/usr/bin', X: '1', [TOKEN_ENV]: 'oat-2' });
  });

  it('passes no env at all when there is no token, so the ambient one stands', () => {
    expect(sessionOptions({ schema, env: { PATH: '/usr/bin' } }).env).toBeUndefined();
  });
});

describe('the credential pool', () => {
  it('reads the base name and its eight slots, in order', () => {
    const slots = readPoolSlots({
      [TOKEN_ENV]: 'a',
      [`${TOKEN_ENV}_1`]: 'b',
      [`${TOKEN_ENV}_8`]: 'c',
    });
    expect(slots.map((s) => s.token)).toEqual(['a', 'b', 'c']);
    expect(slots.map((s) => s.name)).toEqual([TOKEN_ENV, `${TOKEN_ENV}_1`, `${TOKEN_ENV}_8`]);
  });

  it('drops empties and duplicates, so a position is not a slot number', () => {
    // The NAME is what an operator can act on; deduping means the index is not
    // the suffix, so a diagnostic must never say "slot 3".
    const slots = readPoolSlots({
      [TOKEN_ENV]: '  ',
      [`${TOKEN_ENV}_1`]: 'dupe',
      [`${TOKEN_ENV}_2`]: 'dupe',
      [`${TOKEN_ENV}_3`]: 'other',
    });
    expect(slots.map((s) => [s.name, s.token])).toEqual([
      [`${TOKEN_ENV}_1`, 'dupe'],
      [`${TOKEN_ENV}_3`, 'other'],
    ]);
  });
});

describe('what a failure is taken to mean', () => {
  it('treats a closed window as this credential being out', () => {
    for (const text of ['429 Too Many Requests', 'weekly limit reached', 'rate limit', 'quota']) {
      expect(isExhausted(text)).toBe(true);
    }
  });

  it('treats a rejected or absent secret as not-configured', () => {
    for (const text of ['401 Unauthorized', 'authentication failed', 'invalid api key']) {
      expect(isNotConfigured(text)).toBe(true);
    }
  });

  it('treats an unrelated failure as neither', () => {
    expect(isExhausted('ECONNRESET')).toBe(false);
    expect(isNotConfigured('ECONNRESET')).toBe(false);
  });
});

/**
 * One session, scripted.
 *
 * The messages are cast to `SDKMessage`: a real `SDKResultSuccess` carries
 * fourteen more fields of cost, usage and session accounting that nothing under
 * test reads, and spelling them out would describe the SDK rather than this
 * module. The cast is the double's, not the endpoint's — the endpoint now holds
 * the SDK's own types with no cast at all.
 */
const querying = (
  script: Array<{ subtype: string; structured?: unknown; errors?: string[] }>,
): { query: AgentQuery; calls: Options[] } => {
  const calls: Options[] = [];
  let n = 0;
  const query: AgentQuery = ({ options }) => {
    calls.push(options);
    const step = script[Math.min(n++, script.length - 1)];
    return (async function* () {
      yield { type: 'system', subtype: 'init' } as unknown as SDKMessage;
      yield {
        type: 'result',
        subtype: step.subtype,
        ...(step.structured !== undefined ? { structured_output: step.structured } : {}),
        errors: step.errors ?? [],
      } as unknown as SDKMessage;
    })();
  };
  return { query, calls };
};

describe('draftBundle', () => {
  const drafts = { drafts: [{ itemId: 'i1' }], proposedGroups: [] };

  it('returns the session’s structured output', async () => {
    const { query } = querying([{ subtype: 'success', structured: drafts }]);
    await expect(draftBundle(bundle, { query, schema, env: {} })).resolves.toEqual({
      ok: true,
      result: drafts,
    });
  });

  it('reports an empty bundle without opening a session', async () => {
    const { query, calls } = querying([{ subtype: 'success', structured: drafts }]);
    const outcome = await draftBundle({ ...bundle, items: [] }, { query, schema, env: {} });
    expect(outcome).toMatchObject({ ok: false, reason: 'empty' });
    expect(calls).toHaveLength(0);
  });

  it('moves to the next credential when one is drained, and no further', async () => {
    // The reason a pool exists: a drained credential answers 429, and drafting
    // runs while somebody waits at a preview panel.
    const { query, calls } = querying([
      { subtype: 'error_during_execution', errors: ['429 rate limit'] },
      { subtype: 'success', structured: drafts },
    ]);
    const env = { [TOKEN_ENV]: 'one', [`${TOKEN_ENV}_1`]: 'two' };
    await expect(draftBundle(bundle, { query, schema, env })).resolves.toEqual({
      ok: true,
      result: drafts,
    });
    expect(calls.map((c) => c.env?.[TOKEN_ENV])).toEqual(['one', 'two']);
  });

  it('does NOT retry a failure another credential cannot fix', async () => {
    // A malformed schema fails identically on all nine, so trying them costs
    // nine times to learn nothing.
    const { query, calls } = querying([{ subtype: 'error_during_execution', errors: ['ECONNRESET'] }]);
    const env = { [TOKEN_ENV]: 'one', [`${TOKEN_ENV}_1`]: 'two' };
    const outcome = await draftBundle(bundle, { query, schema, env });
    expect(outcome).toMatchObject({ ok: false, reason: 'failed' });
    expect(calls).toHaveLength(1);
  });

  it('reports a drained POOL as failed, not as a missing credential', async () => {
    // `not-configured` copy tells the reporter to set a secret they already
    // have. The window is the problem, not the secret.
    const { query } = querying([{ subtype: 'error_during_execution', errors: ['429 rate limit'] }]);
    const env = { [TOKEN_ENV]: 'one', [`${TOKEN_ENV}_1`]: 'two' };
    await expect(draftBundle(bundle, { query, schema, env })).resolves.toMatchObject({
      ok: false,
      reason: 'failed',
    });
  });

  it('names the variable when there is no usable credential', async () => {
    const { query } = querying([{ subtype: 'error_during_execution', errors: ['401 Unauthorized'] }]);
    const outcome = await draftBundle(bundle, { query, schema, env: {} });
    expect(outcome).toMatchObject({ ok: false, reason: 'not-configured' });
    if (!outcome.ok) expect(outcome.detail).toContain(TOKEN_ENV);
  });

  it('reads a failure’s text from `errors`, where the CLI puts it', async () => {
    // A failed result carries NO `result` field — the bundled CLI builds every
    // `error_during_execution` with `errors: [...]` — so reading `result` left
    // the detail as the bare subtype, `isExhausted` saw no 429, and the pool
    // never failed over on a result message.
    const { query } = querying([{ subtype: 'error_during_execution', errors: ['429 rate limit'] }]);
    const outcome = await draftBundle(bundle, { query, schema, env: {} });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.detail).toContain('429 rate limit');
  });

  it('refuses a structured output that is not an object', async () => {
    // `SDKResultSuccess.structured_output` is `unknown`: the schema is the
    // server's promise, not TypeScript's. A bare string is truthy, so typing it
    // as an object handed the panel a "draft" of the wrong shape.
    const { query } = querying([{ subtype: 'success', structured: 'not an object' }]);
    await expect(draftBundle(bundle, { query, schema, env: {} })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('treats a success with no structured output as a failure, not a draft', async () => {
    // `parseDraftResult` would refuse it anyway; saying so here is clearer than
    // handing the panel an empty answer.
    const { query } = querying([{ subtype: 'success' }]);
    await expect(draftBundle(bundle, { query, schema, env: {} })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('tries once with the ambient environment when no slot is set', async () => {
    const { query, calls } = querying([{ subtype: 'success', structured: drafts }]);
    await draftBundle(bundle, { query, schema, env: {} });
    expect(calls).toHaveLength(1);
    expect(calls[0].env).toBeUndefined();
  });
});

describe('the SDK is not loaded until a draft is actually asked for', () => {
  it('is imported lazily, because vite.config reaches this module', async () => {
    // A CONSUMER's `vite.config.ts` mounts this plugin, and every vitest worker
    // in that consumer loads the config — so a static import costs real time per
    // worker for a dependency only a drafting request needs. Measured in this
    // repository before the move, where it pushed a 5-second boundary test over.
    //
    // Read by path rather than by `import.meta.url`: under vitest the module id
    // is not a `file:` URL.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(process.cwd(), 'src', 'plugin', 'draft-endpoint.ts'), 'utf8');
    // `import type` is EXEMPT, and deliberately so: it is erased by tsc and by
    // Node's type stripping alike, so the module's SDK type contract loads
    // nothing. What must stay lazy is the value import.
    assert(
      !/^import (?!type )[^\n]*@anthropic-ai/m.test(source),
      'the SDK must not load at module scope',
    );
    assert(
      /await import\("@anthropic-ai\/claude-agent-sdk"\)/.test(source),
      'loaded where it is used',
    );
  });
});
