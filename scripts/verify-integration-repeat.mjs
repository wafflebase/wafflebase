/**
 * Repeat-run stability check for integration tests.
 *
 * Runs `pnpm verify:integration` N times (default 3, override with
 * REPEAT_COUNT env var) and reports whether all runs passed consistently.
 *
 * Usage:
 *   pnpm verify:integration:repeat
 *   REPEAT_COUNT=5 pnpm verify:integration:repeat
 */

import { spawn } from 'node:child_process';

const REPEAT_COUNT = parseInt(process.env.REPEAT_COUNT || '3', 10);

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', () => resolve(1));
    child.once('exit', (code, signal) => {
      resolve(signal ? 1 : (code ?? 1));
    });
  });
}

const results = [];

for (let i = 1; i <= REPEAT_COUNT; i++) {
  console.log(`\n=== Integration run ${i}/${REPEAT_COUNT} ===\n`);
  const code = await run('pnpm', ['verify:integration']);
  results.push({ run: i, passed: code === 0 });
}

console.log('\n=== Repeat-run summary ===');
for (const r of results) {
  console.log(`  Run ${r.run}: ${r.passed ? 'PASS' : 'FAIL'}`);
}

const passed = results.filter((r) => r.passed).length;
const allPassed = passed === REPEAT_COUNT;
console.log(
  `\nResult: ${allPassed ? 'STABLE' : 'FLAKY'} (${passed}/${REPEAT_COUNT} passed)`,
);
process.exit(allPassed ? 0 : 1);
