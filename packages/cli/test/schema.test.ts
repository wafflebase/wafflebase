import { describe, it, expect } from 'vitest';
import { getCommandSchema, getAllCommandSchemas } from '../src/schema/registry.js';

describe('schema registry', () => {
  it('returns all commands', () => {
    const all = getAllCommandSchemas();
    expect(all.length).toBeGreaterThan(0);
    for (const cmd of all) {
      expect(cmd.name).toBeTruthy();
      expect(cmd.safety).toMatch(/^(read-only|write|destructive)$/);
    }
  });

  it('returns schema for known command', () => {
    const schema = getCommandSchema('cell.get');
    expect(schema).toBeDefined();
    expect(schema!.safety).toBe('read-only');
    expect(schema!.parameters['doc-id']).toBeDefined();
  });

  it('returns undefined for unknown command', () => {
    expect(getCommandSchema('nonexistent')).toBeUndefined();
  });

  it('has correct safety levels', () => {
    expect(getCommandSchema('doc.list')!.safety).toBe('read-only');
    expect(getCommandSchema('doc.create')!.safety).toBe('write');
    expect(getCommandSchema('doc.delete')!.safety).toBe('destructive');
    expect(getCommandSchema('cell.set')!.safety).toBe('write');
    expect(getCommandSchema('cell.delete')!.safety).toBe('destructive');
  });
});
