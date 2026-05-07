import { describe, it, expect } from 'vitest';
import type { Element } from '../../../model/element';
import { serializeElements, deserializeElements, MIME_TYPE } from './clipboard';

const rect = (id: string, x = 0): Element => ({
  id,
  type: 'shape',
  frame: { x, y: 0, w: 100, h: 50, rotation: 0 },
  data: { kind: 'rect', fill: '#abc' },
});

describe('clipboard serialization', () => {
  it('round-trips two shapes through JSON', () => {
    const json = serializeElements([rect('a', 10), rect('b', 20)]);
    const parsed = deserializeElements(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].frame.x).toBe(10);
    expect(parsed[1].frame.x).toBe(20);
    // Ids are stripped — paste assigns fresh ones.
    expect((parsed[0] as { id?: string }).id).toBeUndefined();
  });

  it('rejects non-slides JSON', () => {
    expect(() => deserializeElements('{"foo": "bar"}')).toThrow(/wafflebase\/slides/i);
  });

  it('exports a stable MIME type with the W3C-required `web ` prefix', () => {
    // Without the `web ` prefix, Chrome silently rejects ClipboardItem
    // for custom MIME types. See
    // https://w3c.github.io/clipboard-apis/#optional-data-types-x.
    expect(MIME_TYPE).toBe('web application/x-wafflebase-slides+json');
  });
});
