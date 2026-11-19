import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProgram } from '../src/cli.js';
import {
  decideNextRound,
  readCritique,
  runCritiqueCheck,
  summarizeCritique,
  validateCritique,
  type CritiqueFinding,
} from '../src/slides/critique.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'wfb-critique-'));

const finding = (over: Partial<CritiqueFinding> = {}): CritiqueFinding => ({
  slideId: 's1',
  severity: 'minor',
  category: 'alignment-spacing',
  problem: 'Card padding differs between the two cards',
  fix: 'Use the same inset on both cards',
  ...over,
});

const major = (n: number) => Array.from({ length: n }, () => finding({ severity: 'major' }));
const minor = (n: number) => Array.from({ length: n }, () => finding());

describe('validateCritique', () => {
  it('accepts a wrapped file and a bare array', () => {
    const wrapped = validateCritique({ round: 2, findings: [finding()] });
    expect(wrapped).toEqual({ ok: true, critique: { round: 2, findings: [finding()] } });
    expect(validateCritique([finding()])).toMatchObject({ ok: true });
    expect(validateCritique({ findings: [] })).toMatchObject({ ok: true });
  });

  it('reports every problem at once, unknown keys included', () => {
    const r = validateCritique({
      round: 0,
      extra: true,
      findings: [
        { ...finding(), severty: 'major' },
        { slideId: '', severity: 'blocker', category: 'vibes', problem: ' ', fix: 'x' },
        null,
      ],
    });
    expect(r.ok).toBe(false);
    const errors = (r as { errors: string[] }).errors;
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/unknown key "extra"/),
        expect.stringMatching(/"round" must be a positive integer/),
        expect.stringMatching(/findings\[0\]: unknown key "severty"/),
        expect.stringMatching(/findings\[1\]: "slideId"/),
        expect.stringMatching(/findings\[1\]: "severity" must be one of major, minor/),
        expect.stringMatching(/findings\[1\]: "category"/),
        expect.stringMatching(/findings\[1\]: "problem"/),
        expect.stringMatching(/findings\[2\]: must be an object/),
      ]),
    );
  });

  it('refuses a non-object root and a missing findings array', () => {
    expect(validateCritique('x')).toMatchObject({ ok: false });
    expect(validateCritique({ round: 1 })).toMatchObject({
      ok: false,
      errors: ['"findings" must be an array'],
    });
  });

  it('readCritique names the file on bad JSON and on an invalid critique', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'bad.json'), '{');
    writeFileSync(join(dir, 'invalid.json'), JSON.stringify([{ slideId: 's1' }]));
    expect(() => readCritique(join(dir, 'bad.json'))).toThrow(/bad\.json/);
    expect(() => readCritique(join(dir, 'invalid.json'))).toThrow(/invalid\.json: invalid critique/);
  });
});

describe('summarizeCritique', () => {
  it('counts by severity and by category', () => {
    const c = summarizeCritique({
      findings: [
        finding({ severity: 'major', category: 'curation' }),
        finding({ severity: 'minor', category: 'curation' }),
        finding({ severity: 'minor', category: 'pptx-parity' }),
      ],
    });
    expect(c).toEqual({
      major: 1,
      minor: 2,
      byCategory: { curation: { major: 1, minor: 1 }, 'pptx-parity': { major: 0, minor: 1 } },
    });
  });
});

describe('decideNextRound (the stop rule)', () => {
  const at = (major: number, minor: number) => ({ major, minor });

  it.each([
    ['majors open → continue', at(2, 5), undefined, 1, 'continue', 'major-open'],
    ['clean → stop', at(0, 0), at(3, 4), 2, 'stop', 'clean'],
    // The #1112 dogfood: round 1 had 7 majors, round 2 had 0 majors and 13
    // minors. Stopping there would have dropped all 13.
    ['first major-free round → polish', at(0, 13), at(7, 0), 2, 'continue', 'polish-round'],
    ['no previous, minors only → polish', at(0, 4), undefined, 1, 'continue', 'polish-round'],
    ['minors falling → continue', at(0, 3), at(0, 6), 2, 'continue', 'minor-decreasing'],
    ['minors flat → stop', at(0, 6), at(0, 6), 2, 'stop', 'minor-plateau'],
    ['minors rising → stop', at(0, 8), at(0, 6), 2, 'stop', 'minor-plateau'],
    ['cap reached, clean of majors', at(0, 3), at(0, 6), 3, 'stop', 'max-rounds'],
  ] as const)('%s', (_label, cur, prev, round, verdict, reason) => {
    expect(decideNextRound(cur, prev, round, 3)).toMatchObject({ verdict, reason });
  });

  it('escalates only when it stops at the cap with majors still open', () => {
    expect(decideNextRound(at(1, 0), at(2, 0), 3, 3)).toEqual({
      verdict: 'stop',
      reason: 'max-rounds',
      escalate: true,
    });
    expect(decideNextRound(at(0, 1), at(0, 2), 3, 3).escalate).toBe(false);
  });
});

describe('runCritiqueCheck', () => {
  it('infers the round: flag, then file, then previous + 1, then 1', () => {
    const cur = { findings: minor(1) };
    expect(runCritiqueCheck({ current: cur }).round).toBe(1);
    expect(runCritiqueCheck({ current: cur, previous: { round: 2, findings: [] } }).round).toBe(3);
    expect(runCritiqueCheck({ current: { round: 2, findings: [] } }).round).toBe(2);
    expect(runCritiqueCheck({ current: { round: 2, findings: [] }, round: 1 }).round).toBe(1);
  });

  it('returns one flat record with the previous counts', () => {
    const r = runCritiqueCheck({
      current: { round: 2, findings: minor(13) },
      previous: { round: 1, findings: major(7) },
    });
    expect(r).toMatchObject({
      verdict: 'continue',
      reason: 'polish-round',
      escalate: false,
      round: 2,
      maxRounds: 3,
      major: 0,
      minor: 13,
      previousMajor: 7,
      previousMinor: 0,
    });
  });
});

describe('slides critique-check (command)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = 0;
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  const run = (...args: string[]) =>
    buildProgram().parseAsync(['node', 'wafflebase', 'slides', 'critique-check', ...args]);

  it('prints the verdict as JSON', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'r1.json'), JSON.stringify({ round: 1, findings: minor(6) }));
    writeFileSync(join(dir, 'r2.json'), JSON.stringify({ round: 2, findings: minor(6) }));
    await run('--file', join(dir, 'r2.json'), '--previous', join(dir, 'r1.json'));
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]))).toMatchObject({
      verdict: 'stop',
      reason: 'minor-plateau',
      round: 2,
    });
  });

  it('fails on an invalid findings file and on a bad --max-rounds', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'bad.json'), JSON.stringify([{ slideId: 's1', severity: 'huge' }]));
    await run('--file', join(dir, 'bad.json'));
    expect(process.exitCode).toBe(1);
    expect(String(errSpy.mock.calls.at(-1)?.[0])).toContain('invalid critique');

    process.exitCode = 0;
    writeFileSync(join(dir, 'ok.json'), '[]');
    await run('--file', join(dir, 'ok.json'), '--max-rounds', '0');
    expect(process.exitCode).toBe(1);
    expect(String(errSpy.mock.calls.at(-1)?.[0])).toContain('--max-rounds must be a positive integer');
  });
});
