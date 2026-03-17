import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { createProgram } from '../src/commands/root.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

describe('version', () => {
  it('should match package.json version', () => {
    const program = createProgram();
    expect(program.version()).toBe(pkg.version);
  });
});
