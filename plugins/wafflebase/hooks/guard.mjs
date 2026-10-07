#!/usr/bin/env node
// Entry point for the PreToolUse(Bash) hook; the decision logic and its
// rationale live in guard-lib.mjs.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './guard-lib.mjs';

function loadTable() {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, 'command-safety.json'), 'utf8'));
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return;
  }
  if (input?.tool_name !== 'Bash') return;
  const command = input.tool_input?.command;
  if (typeof command !== 'string') return;

  let result;
  try {
    result = decide(command, loadTable(), {
      // Claude Code exports each userConfig option to hook processes as
      // CLAUDE_PLUGIN_OPTION_<KEY>. Anything but true/1 leaves writes asking.
      autoApproveWrites: /^(true|1)$/i.test(
        process.env.CLAUDE_PLUGIN_OPTION_AUTO_APPROVE_WRITES ?? '',
      ),
    });
  } catch (e) {
    // A guard that failed must fail toward the prompt for its own commands.
    if (!/\bwafflebase\b/.test(command)) return;
    result = {
      decision: 'ask',
      reason: `The Wafflebase plugin guard could not classify this command (${e instanceof Error ? e.message : String(e)}).`,
    };
  }
  if (!result) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.decision,
        permissionDecisionReason: result.reason,
      },
    }),
  );
}

main();
