// PreToolUse(Bash) guard for the Wafflebase plugin.
//
// Classifies `wafflebase …` commands with the table generated from the CLI
// (`command-safety.json`, see packages/cli/src/plugin/safety-table.ts) and
// answers:
//   - read-only, and the whole Bash command is one plain invocation → allow
//   - write → ask (allow when the user opted into auto-approved writes)
//   - destructive, or anything the table cannot classify → ask, always
//   - not a wafflebase command → no output, the user's own rules apply
//
// Dependency-free on purpose: it runs from the plugin cache, which has no
// node_modules.

const RANK = { 'read-only': 0, write: 1, destructive: 2 };
const HELP_FLAGS = new Set(['--help', '-h', '--version', '-V']);

/**
 * Split a Bash command into top-level segments, the way the shell would
 * before running each one. Quotes are honored; anything the guard cannot
 * reason about (substitution, redirection, subshells) is reported rather
 * than parsed, so the caller can refuse to auto-allow it.
 *
 * @returns {{ segments: string[][], complex: boolean }}
 *   `complex` is true when the command is anything other than a single
 *   plain invocation: more than one segment, a pipe, a redirect, a
 *   substitution, or an environment prefix.
 */
export function splitCommand(command) {
  const segments = [];
  let words = [];
  let word = null;
  let complex = false;
  let quote = null;

  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else word += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && i + 1 < command.length) word += command[++i];
      else {
        // `$` and backticks still expand inside double quotes.
        if (c === '$' || c === '`') complex = true;
        word += c;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      word ??= '';
      continue;
    }
    if (c === '\\' && i + 1 < command.length) {
      const next = command[++i];
      if (next !== '\n') word = (word ?? '') + next;
      continue;
    }
    if (c === ' ' || c === '\t') {
      endWord();
      continue;
    }
    if (c === ';' || c === '&' || c === '|' || c === '\n') {
      complex = true;
      endSegment();
      continue;
    }
    if ('<>()`$'.includes(c)) complex = true;
    word = (word ?? '') + c;
  }
  endSegment();
  // An unterminated quote is a parse we cannot trust.
  if (quote !== null) complex = true;
  if (segments.length !== 1) complex = true;
  return { segments, complex };
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** True when `word` names the wafflebase binary (bare or by path). */
function isWafflebase(word) {
  return word === 'wafflebase' || word.endsWith('/wafflebase');
}

/**
 * Find the wafflebase invocation in one segment's words, past any
 * `VAR=value` prefix.
 *
 * @returns {{ args: string[], plain: boolean } | null}
 *   `plain` is false when an environment prefix or a path could make this
 *   run something other than the installed CLI (`PATH=… wafflebase`,
 *   `./wafflebase`). Such a call is still classified, never auto-allowed.
 */
export function wafflebaseArgs(words) {
  let i = 0;
  while (i < words.length && ENV_ASSIGNMENT.test(words[i])) i++;
  if (i >= words.length || !isWafflebase(words[i])) return null;
  return { args: words.slice(i + 1), plain: i === 0 && words[i] === 'wafflebase' };
}

function findChild(node, name) {
  if (!node.children) return null;
  if (Object.hasOwn(node.children, name)) return node.children[name];
  for (const child of Object.values(node.children)) {
    if (child.aliases?.includes(name)) return child;
  }
  return null;
}

/**
 * Classify the arguments that follow `wafflebase`.
 *
 * @returns {{
 *   known: boolean, path: string, level?: string, description?: string,
 *   notes: string[], localWrites?: string[]
 * }}
 */
export function classify(args, table) {
  let node = table.root;
  const path = [];
  const valueOptions = new Set(node.valueOptions ?? []);
  const optionalValueOptions = new Set(node.optionalValueOptions ?? []);
  const flags = new Map();
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (HELP_FLAGS.has(arg)) {
      return { known: true, path: path.join(' '), level: 'read-only', notes: [] };
    }
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const eq = arg.indexOf('=');
      const name = eq >= 0 ? arg.slice(0, eq) : arg;
      let value = eq >= 0 ? arg.slice(eq + 1) : true;
      if (eq < 0 && valueOptions.has(name)) {
        value = args[++i];
      } else if (
        eq < 0 &&
        optionalValueOptions.has(name) &&
        i + 1 < args.length &&
        !args[i + 1].startsWith('-')
      ) {
        value = args[++i];
      }
      flags.set(name, value);
      continue;
    }
    // A word while the node still has subcommands names the next one.
    if (node.children && positionals.length === 0) {
      const child = findChild(node, arg);
      if (child) {
        node = child;
        path.push(arg);
        for (const o of node.valueOptions ?? []) valueOptions.add(o);
        for (const o of node.optionalValueOptions ?? []) {
          optionalValueOptions.add(o);
        }
        continue;
      }
      // Commander's implicit `help` subcommand prints and exits.
      if (arg === 'help') {
        return { known: true, path: path.join(' '), level: 'read-only', notes: [] };
      }
      if (!node.safety) {
        return { known: false, path: [...path, arg].join(' '), notes: [] };
      }
    }
    positionals.push(arg);
  }

  // `wafflebase` or `wafflebase docs` alone prints usage.
  if (!node.safety) {
    if (node.children) {
      return { known: true, path: path.join(' '), level: 'read-only', notes: [] };
    }
    return { known: false, path: path.join(' '), notes: [] };
  }

  let level = node.safety;
  const notes = [];
  for (const [flag, safety] of Object.entries(node.flagSafety ?? {})) {
    if (flags.has(flag) && RANK[safety] > RANK[level]) {
      level = safety;
      notes.push(`${flag} makes it ${safety}`);
    }
  }
  // Decided by the payload, which is not on the command line: assume it.
  for (const c of node.conditional ?? []) {
    if (RANK[c.safety] > RANK[level]) {
      level = c.safety;
      notes.push(`${c.safety} when ${c.when}`);
    }
  }
  // A read on the server can still write this machine's disk.
  const localWrites = [];
  if (level === 'read-only') {
    const outputs = [];
    if (node.localOutputArg !== undefined) {
      outputs.push(positionals[node.localOutputArg]);
    }
    for (const o of node.localOutputOptions ?? []) {
      if (flags.has(o)) outputs.push(flags.get(o));
    }
    for (const v of outputs) {
      if (v === '-') continue;
      // A missing optional output path means "the default filename".
      localWrites.push(typeof v === 'string' ? v : 'a default filename');
    }
  }
  return {
    known: true,
    path: path.join(' '),
    level,
    description: node.description,
    notes,
    localWrites,
  };
}

function commandName(c) {
  return ['wafflebase', c.path].filter(Boolean).join(' ');
}

function describe(c) {
  const what = c.description ? ` — ${c.description}` : '';
  const notes = c.notes.length > 0 ? ` (${c.notes.join('; ')})` : '';
  return `\`${commandName(c)}\` is ${c.level}${what}${notes}`;
}

/**
 * Decide on one Bash command.
 *
 * @param {string} command
 * @param {object} table   parsed command-safety.json
 * @param {{ autoApproveWrites?: boolean }} [options]
 * @returns {{ decision: 'allow' | 'ask', reason: string } | null}
 *   null means "not ours": print nothing and let the user's rules decide.
 */
export function decide(command, table, options = {}) {
  const { segments, complex } = splitCommand(command);
  const found = [];
  let plain = true;
  for (const words of segments) {
    const hit = wafflebaseArgs(words);
    if (hit) {
      found.push(classify(hit.args, table));
      plain &&= hit.plain;
    }
  }

  if (found.length === 0) {
    // A wafflebase call hidden in a substitution or a subshell is one the
    // guard cannot classify, so it must not slip past unprompted.
    if (complex && /(^|[^\w/-])wafflebase(?![\w-])/.test(command)) {
      return {
        decision: 'ask',
        reason:
          'This command runs wafflebase in a form the Wafflebase plugin cannot classify (substitution or subshell).',
      };
    }
    return null;
  }

  const unknown = found.filter((c) => !c.known);
  if (unknown.length > 0) {
    return {
      decision: 'ask',
      reason: `\`${commandName(unknown[0])}\` is not in the Wafflebase plugin's command table (generated for CLI ${table.cliVersion}); review it before it runs.`,
    };
  }

  const worst = found.reduce((a, b) => (RANK[b.level] > RANK[a.level] ? b : a));
  if (worst.level === 'destructive') {
    return {
      decision: 'ask',
      reason: `${describe(worst)}. Wafflebase cannot undo this over the API.`,
    };
  }
  // Writing a local file is outside what "auto-approve writes" opted into
  // (Wafflebase edits), so it always asks — as Claude Code does for a file
  // write of its own.
  const local = found.find((c) => c.localWrites?.length > 0);
  if (local) {
    return {
      decision: 'ask',
      reason: `${describe(local)}. It writes ${local.localWrites.join(', ')} on this machine.`,
    };
  }
  if (worst.level === 'write') {
    if (options.autoApproveWrites && !complex && plain) {
      return { decision: 'allow', reason: `${describe(worst)}; writes are auto-approved.` };
    }
    return { decision: 'ask', reason: `${describe(worst)}.` };
  }
  // Read-only. Only a single plain invocation is auto-allowed: anything
  // composed with it is the user's normal prompt to answer.
  if (complex || !plain) return null;
  return { decision: 'allow', reason: `${describe(worst)}.` };
}
