import { describe, it, expect, vi } from 'vitest';
import { chooseWorkspace } from '../src/commands/login.js';

const ACME = { id: 'aaaaaaaa-1111', name: 'Acme' };
const BETA = { id: 'bbbbbbbb-2222', name: 'Beta' };

/** An `ask` that answers from a script, recording each prompt. */
function scripted(answers: string[]) {
  const prompts: string[] = [];
  const ask = vi.fn(async (prompt: string) => {
    prompts.push(prompt);
    return answers.shift() ?? '';
  });
  return { ask, prompts };
}

describe('chooseWorkspace', () => {
  it('returns an empty id when there are no workspaces', async () => {
    const { ask } = scripted([]);
    const log = vi.fn();
    expect(await chooseWorkspace([], ask, log)).toBe('');
    expect(ask).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('No workspaces found.');
  });

  it('takes the only workspace without asking', async () => {
    const { ask } = scripted([]);
    expect(await chooseWorkspace([ACME], ask, vi.fn())).toBe(ACME.id);
    expect(ask).not.toHaveBeenCalled();
  });

  it('takes the numbered choice', async () => {
    const { ask } = scripted(['2']);
    expect(await chooseWorkspace([ACME, BETA], ask, vi.fn())).toBe(BETA.id);
  });

  it('asks again after an invalid number instead of taking the first', async () => {
    const { ask, prompts } = scripted(['9', 'beta', '2']);
    const log = vi.fn();
    expect(await chooseWorkspace([ACME, BETA], ask, log)).toBe(BETA.id);
    expect(prompts).toHaveLength(3);
    expect(log).toHaveBeenCalledWith('Enter a number from 1 to 2.');
  });

  it('falls back to the first only after three misses, and says how to change it', async () => {
    const { ask } = scripted(['', 'x', '0']);
    const log = vi.fn();
    expect(await chooseWorkspace([ACME, BETA], ask, log)).toBe(ACME.id);
    expect(ask).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledWith(
      'Using Acme. Change it later with `wafflebase ctx switch <name-or-id>`.',
    );
  });
});
