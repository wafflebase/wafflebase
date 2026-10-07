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
const CONNECTION_OPTIONS = ['--server', '--api-key', '--profile'];
/** Shells that run their `-c` string, and `eval`, which runs its words. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/**
 * Characters that mean exactly themselves outside quotes. Anything else
 * unquoted — `#` (comment), `{ } * ? [ ] ~` (expansion), `\`, `!`, `$`,
 * operators, non-ASCII — is something the shell may rewrite before the CLI
 * sees it. The guard never auto-allows a command containing one: an
 * allow-list is the only shape of this check that a shell feature nobody
 * thought of cannot get past.
 */
const LITERAL = /^[A-Za-z0-9_\-.,:/=@+%]$/;
/** Unquoted characters after which the word the shell passes is unknown. */
const EXPANDS = new Set(['{', '}', '*', '?', '[', ']', '~', '$', '`']);

/**
 * @typedef {{ text: string, exact: boolean }} Word
 *   `exact` is false when the shell may expand the word into something
 *   other than `text` (brace, glob, tilde, parameter or command expansion).
 */

/**
 * Split a Bash command into top-level segments of words, the way the shell
 * would before running each one.
 *
 * @returns {{ segments: Word[][], complex: boolean, opaque: boolean }}
 *   `complex` is true unless the command is a single invocation made only
 *   of literal characters and quoted strings: more than one segment, a
 *   pipe, a redirect, a comment, any expansion, an escape or an
 *   unterminated quote all set it.
 */
export function splitCommand(command) {
  const segments = [];
  let words = [];
  let word = null;
  let complex = false;
  // A substitution, subshell or group runs words this split cannot see as
  // a program call: `$(…)`, backticks, `( … )`, `{ …; }`.
  let opaque = false;
  let quote = null;

  const append = (text, exact = true) => {
    word ??= { text: '', exact: true };
    word.text += text;
    if (!exact) word.exact = false;
  };
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
      else append(c);
      continue;
    }
    if (quote === '"') {
      if (c === '"') {
        quote = null;
      } else if (c === '\\') {
        // Inside double quotes a backslash escapes only these; before
        // anything else it is a literal backslash, exactly as bash/zsh.
        complex = true;
        const next = command[i + 1];
        if (next !== undefined && '$`"\\\n'.includes(next)) {
          i++;
          if (next !== '\n') append(next);
        } else {
          append(c);
        }
      } else if (c === '$' || c === '`') {
        complex = true;
        if (c === '`' || command[i + 1] === '(') opaque = true;
        append(c, false);
      } else {
        append(c);
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      append('');
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
    if (c === '<' || c === '>') {
      // A redirect ends the word before it (`wafflebase>/dev/null`) and is
      // never an argument: it becomes its own word, marked as a redirect.
      complex = true;
      // `2>file`: the digits name a descriptor, not an argument.
      if (word !== null && word.exact && /^\d+$/.test(word.text)) word = null;
      endWord();
      let op = c;
      while (command[i + 1] === '>' || command[i + 1] === '<') op += command[++i];
      // `2>&1`, `>&-`: duplicating a descriptor names no file.
      if (command[i + 1] === '&' && /[0-9-]/.test(command[i + 2] ?? '')) {
        i += 2;
        words.push({ text: `${op}&${command[i]}`, exact: true, redirect: true, dup: true });
        continue;
      }
      words.push({ text: op, exact: true, redirect: true });
      continue;
    }
    if (c === '#' && word === null) {
      // A comment runs to the end of the line; the shell never passes it.
      complex = true;
      while (i + 1 < command.length && command[i + 1] !== '\n') i++;
      continue;
    }
    if (c === '\\') {
      complex = true;
      const next = command[++i];
      if (next !== undefined && next !== '\n') append(next);
      continue;
    }
    if (!LITERAL.test(c)) complex = true;
    // `{` opens a group only as a word of its own (`{ cmd; }`); inside a
    // word it is brace expansion, which the word's inexactness covers.
    const group = c === '{' && word === null && /\s/.test(command[i + 1] ?? '');
    if (c === '(' || c === '`' || group || (c === '$' && command[i + 1] === '(')) {
      opaque = true;
    }
    append(c, !EXPANDS.has(c));
  }
  endSegment();
  // An unterminated quote is a parse we cannot trust.
  if (quote !== null) complex = true;
  if (segments.length !== 1) complex = true;
  return { segments, complex, opaque };
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Commands that run the next word as a program. A wrapped `wafflebase` is
 * still classified — so a delete behind `time` or `xargs` still asks — but
 * never auto-allowed.
 */
const WRAPPERS = new Set([
  'time', 'command', 'builtin', 'exec', 'nice', 'nohup', 'sudo', 'doas',
  'env', 'xargs', 'timeout', 'npx', 'bunx', 'pnpx',
  // Shell keywords that start a command position: `if true; then wafflebase …`.
  'if', 'then', 'else', 'elif', 'do', 'while', 'until', '!',
]);
/** Two-word launchers: `pnpm exec wafflebase`, `npm exec …`, `pnpm dlx …`. */
const LAUNCHERS = new Set(['pnpm exec', 'pnpm dlx', 'npm exec', 'yarn dlx', 'yarn exec']);

/**
 * Index of the first word past `VAR=value` prefixes, wrappers (with their
 * options and option values) and two-word launchers. A non-option word is
 * consumed only right after an option (its value) or when it is a number
 * (`timeout 30`), so `xargs grep wafflebase f` stops at `grep` rather than
 * mistaking the data for the program.
 *
 * @param {string[]} texts
 */
function skipPrefix(texts) {
  let i = 0;
  while (i < texts.length) {
    const w = texts[i];
    if (ENV_ASSIGNMENT.test(w)) {
      i++;
    } else if (WRAPPERS.has(w)) {
      i++;
      while (i < texts.length) {
        const t = texts[i];
        const afterOption = texts[i - 1].startsWith('-');
        if (
          t.startsWith('-') ||
          /^\d+[a-z]?$/.test(t) ||
          (afterOption && !isWafflebase(t) && !ENV_ASSIGNMENT.test(t) &&
            !WRAPPERS.has(t) && !SHELLS.has(t))
        ) {
          i++;
        } else {
          break;
        }
      }
    } else if (i + 1 < texts.length && LAUNCHERS.has(`${w} ${texts[i + 1]}`)) {
      i += 2;
    } else {
      break;
    }
  }
  return i;
}

/** True when `word` names the wafflebase binary (bare, by path, or its npm package). */
function isWafflebase(word) {
  return (
    word === 'wafflebase' ||
    word.endsWith('/wafflebase') ||
    /^@wafflebase\/cli(@[^/\s]*)?$/.test(word)
  );
}

/**
 * Find the wafflebase invocation in one segment's words, past any
 * `VAR=value` prefix and wrapper commands.
 *
 * @param {Word[]} words
 * @returns {{ args: Word[], plain: boolean } | null}
 *   `plain` is true only for a bare `wafflebase` with no prefix or
 *   wrapper: a path, `PATH=…` or a launcher could run some other program.
 */
export function wafflebaseArgs(words) {
  const texts = words.map((w) => w.text);
  const i = skipPrefix(texts);
  if (i >= words.length || !isWafflebase(texts[i])) return null;
  // Every `VAR=` before the call. Any of them can change what runs or
  // where it connects (`PATH=`, `NODE_OPTIONS=`, `LD_PRELOAD=`,
  // `WAFFLEBASE_SERVER=`), so each one makes the call ask.
  const env = texts
    .slice(0, i)
    .filter((t) => ENV_ASSIGNMENT.test(t))
    .map((t) => t.slice(0, t.indexOf('=')));
  return {
    args: words.slice(i + 1),
    plain: i === 0 && texts[i] === 'wafflebase' && words[i].exact,
    env,
  };
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
 * Root options that choose the server or credential, wherever they appear
 * (commander accepts global options after the subcommand too). Scanned on
 * their own so that every outcome — help, usage, unknown — carries them.
 */
function connectionOptions(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const t = words[i].text;
    const eq = t.indexOf('=');
    const name = eq >= 0 ? t.slice(0, eq) : t;
    if (!CONNECTION_OPTIONS.includes(name)) continue;
    const value = eq >= 0 ? t.slice(eq + 1) : words[i + 1]?.text;
    // Name the server, never echo a key or profile into the transcript.
    out.push(name === '--server' && value ? `${name} ${value}` : name);
  }
  return out;
}

/**
 * Classify the arguments that follow `wafflebase`.
 *
 * @param {Word[]} words
 */
export function classify(allWords, table) {
  // Redirects are the shell's, not the CLI's: take them and their targets
  // out of the arguments, and remember what they read and write locally —
  // on every outcome, help and usage included.
  const redirectWrites = [];
  const redirectReads = [];
  const words = [];
  for (let i = 0; i < allWords.length; i++) {
    const w = allWords[i];
    if (!w.redirect) {
      words.push(w);
      continue;
    }
    if (w.dup) continue;
    const target = allWords[i + 1];
    if (target && !target.redirect) i++;
    const where = target && !target.redirect ? target.text : 'a file';
    if (/^\/dev\/(null|stdout|stderr)$/.test(where)) continue;
    if (w.text.includes('<')) redirectReads.push(where);
    else redirectWrites.push(where);
  }
  const result = classifyPath(words, table);
  result.connection = connectionOptions(words);
  result.localWrites = [...redirectWrites, ...(result.localWrites ?? [])];
  result.localReads = [...redirectReads, ...(result.localReads ?? [])];
  return result;
}

/**
 * The command-path walk behind `classify`.
 *
 * There is deliberately no shortcut for `--help` / `--version`: a help flag
 * the guard sees may be one the shell never passes (`delete x # --help`),
 * so a command is judged by its path, never by a flag claiming it is
 * harmless. `wafflebase docs delete --help` asks; that is the price.
 *
 * @param {Word[]} words
 * @returns {{
 *   known: boolean, path: string, why?: string, level?: string,
 *   description?: string, notes: string[], localWrites?: string[]
 * }}
 */
function classifyPath(words, table) {
  const inexact = words.find((w) => !w.exact);
  if (inexact) {
    // The path only: an argument list may carry `--api-key <secret>`.
    return {
      known: false,
      path: '…',
      why: 'the shell expands part of it before the CLI sees it',
      notes: [],
    };
  }
  const args = words.map((w) => w.text);
  let node = table.root;
  const path = [];
  const valueOptions = new Set(node.valueOptions ?? []);
  const optionalValueOptions = new Set(node.optionalValueOptions ?? []);
  const flags = new Map();
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      // Commander still dispatches a subcommand named after `--`
      // (`wafflebase -- docs delete x` runs the delete), so at a node that
      // has subcommands the rest cannot be read as plain positionals.
      if (node.children && positionals.length === 0) {
        return {
          known: false,
          path: [...path, '--', '…'].join(' '),
          why: 'commander still dispatches a subcommand named after `--`',
          notes: [],
        };
      }
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
        return {
          known: true,
          path: [...path, 'help'].join(' '),
          level: 'read-only',
          description: 'prints help',
          notes: [],
        };
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
      return {
        known: true,
        path: path.join(' '),
        level: 'read-only',
        description: 'prints usage',
        notes: [],
      };
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
  // Decided by the payload. An inline `--data` the guard can parse is
  // checked; a payload from stdin is not on the command line, so the
  // variant is assumed to apply.
  for (const c of node.conditional ?? []) {
    if (RANK[c.safety] <= RANK[level]) continue;
    if (!payloadRuledOut(c.when, flags.get('--data'))) {
      level = c.safety;
      notes.push(`${c.safety} when ${c.when}`);
    }
  }
  // A write that reads a local file sends it to the server.
  const localReads = [];
  if (node.localInputArg !== undefined) {
    const v = positionals[node.localInputArg];
    if (typeof v === 'string' && v !== '-') localReads.push(v);
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
    localReads,
    neverAutoApprove: Boolean(node.neverAutoApprove),
  };
}

/**
 * The name anywhere it could be a program word, quoted or not, bare or by
 * path (`/usr/local/bin/wafflebase`) — but not a directory inside a path
 * (`…/wafflebase/waffledocs`).
 */
const MENTION = /(?:^|[^\w.-])wafflebase(?![\w/-])/;

/** True when an inline JSON payload proves a null-condition false. */
function payloadRuledOut(when, data) {
  if (typeof data !== 'string') return false;
  if (when !== 'a value is null' && when !== 'payload is null') return false;
  let value;
  try {
    value = JSON.parse(data);
  } catch {
    return false;
  }
  // "payload is null" means the whole payload; "a value is null" means
  // any entry, at any depth.
  if (when === 'payload is null') return value !== null;
  const hasNull = (v) =>
    v === null ||
    (typeof v === 'object' && Object.values(v).some((x) => hasNull(x)));
  return !hasNull(value);
}

/**
 * Text that came from the command line, made fit for the prompt the user
 * reads to approve it: no control or bidi characters (no forged new lines
 * or reordered text), and short.
 */
function safe(text) {
  const clean = String(text)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '?');
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}

function commandName(c) {
  return safe(['wafflebase', c.path].filter(Boolean).join(' '));
}

function describe(c) {
  const what = c.description ? ` — ${c.description}` : '';
  const notes = c.notes.length > 0 ? ` (${c.notes.join('; ')})` : '';
  return `\`${commandName(c)}\` is ${c.level}${what}${notes}`;
}

/**
 * The command string a segment hands to another shell, or null.
 *
 * @param {Word[]} words
 * @returns {string | null}
 */
function innerCommand(words) {
  let texts = words.map((w) => w.text);
  // `env -S '…'` / `env --split-string …` hands its own string to a shell.
  const split = texts.findIndex((t) => t === '-S' || t === '--split-string');
  if (texts.some((t) => t === 'env') && split >= 0 && split + 1 < texts.length) {
    return texts.slice(split + 1).join(' ');
  }
  // Past `VAR=value` prefixes and wrappers with their options and values
  // (`FOO=1 sh -c …`, `env -u X sh -c …`, `nice -n 5 bash -c …`).
  texts = texts.slice(skipPrefix(texts));
  const head = texts[0]?.split('/').pop();
  if (head === 'eval') return texts.slice(1).join(' ');
  if (SHELLS.has(head)) {
    // `-c` alone or inside a cluster (`-lc`, `-ec`, `-xc`); the string is
    // the first operand after the options.
    const c = texts.findIndex((t, j) => j > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(t));
    if (c < 0) return null;
    const rest = texts.slice(c + 1).filter((t) => !t.startsWith('-'));
    return rest.length > 0 ? rest[0] : null;
  }
  return null;
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
  const { segments, complex: topComplex, opaque: topOpaque } = splitCommand(command);
  let complex = topComplex;
  let opaque = topOpaque;
  let tooDeep = false;
  const found = [];
  let plain = true;
  const visit = (segs, depth) => {
    for (const words of segs) {
      const inner = innerCommand(words);
      if (inner !== null) {
        // `sh -c '…'`, `env -S '…'`, `eval …` run a string the shell has
        // not split yet: split it the same way and never auto-allow it.
        complex = true;
        if (depth >= 3) {
          tooDeep = true;
          continue;
        }
        const split = splitCommand(inner);
        opaque ||= split.opaque;
        visit(split.segments, depth + 1);
        continue;
      }
      const hit = wafflebaseArgs(words);
      if (hit) {
        const c = classify(hit.args, table);
        c.env = hit.env;
        found.push(c);
        plain &&= hit.plain;
      }
    }
  };
  visit(segments, 0);

  // A wafflebase call inside a substitution, subshell or group is one the
  // segment walk cannot place. When the command has one of those and names
  // wafflebase anywhere, ask — rather than count occurrences, which one
  // spelling can always offset with another.
  if ((opaque || tooDeep) && MENTION.test(command)) {
    return {
      decision: 'ask',
      reason:
        'This command runs wafflebase in a form the Wafflebase plugin cannot classify (a substitution, subshell, group or deeply nested shell).',
    };
  }
  if (found.length === 0) return null;

  const unknown = found.find((c) => !c.known);
  if (unknown) {
    return {
      decision: 'ask',
      reason: unknown.why
        ? `\`${commandName(unknown)}\`: ${unknown.why}; review it before it runs.`
        : `\`${commandName(unknown)}\` is not in the Wafflebase plugin's command table (generated for CLI ${table.cliVersion}); review it before it runs.`,
    };
  }

  const prefixed = found.find((c) => c.env?.length > 0);
  if (prefixed) {
    return {
      decision: 'ask',
      reason: `${describe(prefixed)}. It runs with ${prefixed.env.map((n) => `${safe(n)}=…`).join(', ')} set, which can change what runs or where your Wafflebase credentials go.`,
    };
  }
  const redirected = found.find((c) => c.connection?.length > 0);
  if (redirected) {
    return {
      decision: 'ask',
      reason: `${describe(redirected)}. It is run with ${redirected.connection.map(safe).join(', ')}, which choose the server and credential it connects with — check it sends your Wafflebase credentials only where you trust.`,
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
      reason: `${describe(local)}. It writes ${local.localWrites.map(safe).join(', ')} on this machine.`,
    };
  }
  // Uploading a local file is outside the opt-in for the same reason:
  // it is the user's disk, and the destination may be shared.
  const upload = found.find((c) => c.localReads?.length > 0);
  if (upload) {
    return {
      decision: 'ask',
      reason: `${describe(upload)}. It reads ${upload.localReads.map(safe).join(', ')} from this machine.`,
    };
  }
  if (worst.level === 'write') {
    const sensitive = found.find((c) => c.neverAutoApprove);
    if (sensitive) {
      return {
        decision: 'ask',
        reason: `${describe(sensitive)}. It changes credentials, sign-in or sharing, which auto-approve never covers.`,
      };
    }
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
