#!/usr/bin/env node
// Entry point for the PreToolUse(Bash) hook; the decision logic and its
// rationale live in guard-lib.mjs.

import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decide,
  forgetListening,
  listenBot,
  listeningFor,
  recordListening,
  safe,
} from './guard-lib.mjs';

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

// Which sessions listen as a bot (docs/design/agent-runner.md § 5), in a
// directory of its own: bot names cannot contain "/", so no agent file can
// collide with it, and the guard protects it like the plugin's own files.
const GUARD_DIR = join(homedir(), '.wafflebase', 'guard');
const LISTEN_STATE = join(GUARD_DIR, 'listening.json');

function readListenState() {
  try {
    return JSON.parse(readFileSync(LISTEN_STATE, 'utf8'));
  } catch {
    return {};
  }
}

function writeListenState(state) {
  try {
    mkdirSync(GUARD_DIR, { recursive: true, mode: 0o700 });
    const tmp = `${LISTEN_STATE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, LISTEN_STATE);
  } catch {
    // Without the record the session simply is not listening: it asks.
  }
}

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

function insideDir(dir, target) {
  const rel = relative(dir, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * After a Bash call ran: an approved `agent next` that printed a task (or
 * `"task": null`) starts this session listening, and any plain wafflebase
 * call while listening keeps it alive. Recording here, not in PreToolUse,
 * means a proposed call the user rejected — or one that failed — grants
 * nothing.
 */
function afterBash(input, sessionId) {
  const command = input.tool_input?.command;
  if (typeof command !== 'string' || !sessionId) return;
  const table = loadTable();
  const now = Date.now();
  const state = readListenState();
  const stdout = String(input.tool_response?.stdout ?? '');
  const bot = listenBot(command, table);
  if (bot && /"task"\s*:/.test(stdout)) {
    writeListenState(recordListening(state, sessionId, bot, now));
    return;
  }
  const current = listeningFor(state, sessionId, now);
  if (current && /^\s*wafflebase\s/.test(command)) {
    writeListenState(recordListening(state, sessionId, current, now));
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return;
  }
  const sessionId = typeof input?.session_id === 'string' ? input.session_id : undefined;
  const event = input?.hook_event_name ?? 'PreToolUse';

  // The listen loop runs inside one turn, so the user typing anything — or
  // the session ending — ends it.
  if (event === 'UserPromptSubmit' || event === 'SessionEnd') {
    if (sessionId && listeningFor(readListenState(), sessionId, Date.now()) !== null) {
      writeListenState(forgetListening(readListenState(), sessionId));
    }
    return;
  }
  if (event === 'PostToolUse') {
    try {
      if (input?.tool_name === 'Bash') afterBash(input, sessionId);
    } catch {
      // A failed record only means the session keeps asking.
    }
    return;
  }

  // The plugin's own files — and the listen state — decide every later
  // answer: an edit to them asks.
  if (FILE_TOOLS.has(input?.tool_name)) {
    const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (typeof target !== 'string') return;
    const real = realPath(resolve(input.cwd ?? process.cwd(), target));
    if (insideDir(PLUGIN_ROOT, real) || insideDir(realPath(GUARD_DIR), real)) {
      emit({
        decision: 'ask',
        reason: `This edits the Wafflebase plugin's own files or its listen state (${safe(relative(PLUGIN_ROOT, real))}), which decide what later commands are allowed.`,
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
      listening: listeningFor(readListenState(), sessionId, Date.now()) !== null,
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
