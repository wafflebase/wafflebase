#!/usr/bin/env node
// Entry point for the PreToolUse(Bash) hook; the decision logic and its
// rationale live in guard-lib.mjs.

import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, safe } from './guard-lib.mjs';

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

/**
 * A path with symlinks resolved, also for a file that does not exist yet:
 * the nearest existing ancestor is resolved and the rest re-appended, so a
 * symlinked directory cannot carry an edit into the plugin unnoticed.
 */
function realPath(p) {
  let head = p;
  const tail = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail.reverse());
    } catch {
      const parent = dirname(head);
      if (parent === head) return p;
      tail.push(basename(head));
      head = parent;
    }
  }
}

const PLUGIN_ROOT = realPath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function emit(result) {
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

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return;
  }
  // The plugin's own files decide every later answer: an edit to them asks.
  if (FILE_TOOLS.has(input?.tool_name)) {
    const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (typeof target !== 'string') return;
    const rel = relative(PLUGIN_ROOT, realPath(resolve(input.cwd ?? process.cwd(), target)));
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
      emit({
        decision: 'ask',
        reason: `This edits the Wafflebase plugin's own files (${safe(rel)}), which decide what later commands are allowed.`,
      });
    }
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
      autoAllowReads: /^(true|1)$/i.test(
        process.env.CLAUDE_PLUGIN_OPTION_AUTO_ALLOW_READS ?? '',
      ),
      autoApproveWrites: /^(true|1)$/i.test(
        process.env.CLAUDE_PLUGIN_OPTION_AUTO_APPROVE_WRITES ?? '',
      ),
      pluginRoot: PLUGIN_ROOT,
    });
  } catch (e) {
    // A guard that failed must fail toward the prompt for its own commands.
    if (!/wafflebase/i.test(command)) return;
    result = {
      decision: 'ask',
      reason: `The Wafflebase plugin guard could not classify this command (${safe(e instanceof Error ? e.message : String(e))}).`,
    };
  }
  emit(result);
}

main();
